-- =============================================================================
-- Migration: aido_product_memberships
-- Date: 2026-07-19
--
-- Purpose
--   Create the minimum AidoForMe-scoped table needed for the initial auth
--   slice, sharing the TutorPakar project's auth.users identity without
--   touching any TutorPakar-owned table or trigger.
--
-- Why a separate table
--   - auth.users and public.profiles are owned by TutorPakar. We do not
--     modify their schema, RLS, or triggers.
--   - The existing handle_new_user() trigger only inserts a TutorPakar
--     profile row (wrapped in EXCEPTION WHEN OTHERS) and grants no TutorPakar
--     role or enrollment. So sharing auth.users is safe.
--   - We create AidoForMe's own row lazily from server actions on signup
--     and first login, and never via a second AFTER INSERT trigger on
--     auth.users. This avoids the failure mode where a profile insert
--     failure in handle_new_user() leaks into AidoForMe signups.
--
-- Schema
--   aido_product_memberships
--     - user_id   : the stable auth.users(id) shared with TutorPakar
--     - status    : active | invited | suspended
--     - role      : student (initial only); reviewer / support are reserved
--                   future roles and not granted automatically
--     - timestamps
--
-- Security
--   - Row Level Security is enabled.
--   - SELECT / INSERT / UPDATE / DELETE policies restrict rows to their
--     owner via (select auth.uid()) = user_id.
--   - UPDATE policies include both USING and WITH CHECK so a row cannot
--     be "moved" to another user.
--   - No SECURITY DEFINER escape hatches; auth.uid() is the only authority.
--
-- Important
--   This migration is written to be applied to the linked Supabase project
--   manually after the user reviews docs/shared-auth-setup.md. The repo's
--   build/lint/typecheck pipelines do not run it.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Enum types
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aido_membership_status') THEN
    CREATE TYPE public.aido_membership_status AS ENUM ('active', 'invited', 'suspended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aido_membership_role') THEN
    CREATE TYPE public.aido_membership_role AS ENUM ('student', 'reviewer', 'support');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aido_product_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      public.aido_membership_status NOT NULL DEFAULT 'active',
  role        public.aido_membership_role NOT NULL DEFAULT 'student',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_product_memberships_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_aido_product_memberships_user
  ON public.aido_product_memberships (user_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger (re-uses public.set_updated_at() if present, else
-- creates a local one). Keeping the function local avoids touching any
-- TutorPakar-owned function definitions.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aido_set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aido_set_memberships_updated_at
  ON public.aido_product_memberships;
CREATE TRIGGER aido_set_memberships_updated_at
  BEFORE UPDATE ON public.aido_product_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.aido_set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE public.aido_product_memberships ENABLE ROW LEVEL SECURITY;

-- Replace any pre-existing policies to keep this migration idempotent.
DROP POLICY IF EXISTS "Aido members read own row"   ON public.aido_product_memberships;
DROP POLICY IF EXISTS "Aido members insert own row" ON public.aido_product_memberships;
DROP POLICY IF EXISTS "Aido members update own row" ON public.aido_product_memberships;
DROP POLICY IF EXISTS "Aido members delete own row" ON public.aido_product_memberships;

CREATE POLICY "Aido members read own row"
  ON public.aido_product_memberships
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Aido members insert own row"
  ON public.aido_product_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Aido members update own row"
  ON public.aido_product_memberships
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Aido members delete own row"
  ON public.aido_product_memberships
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- Grants — anon has no access; authenticated gets what RLS already
-- permits; service_role is unrestricted by RLS so admin tooling can
-- still read every row.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.aido_product_memberships FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.aido_product_memberships TO authenticated;
GRANT ALL ON public.aido_product_memberships TO service_role;

NOTIFY pgrst, 'reload schema';