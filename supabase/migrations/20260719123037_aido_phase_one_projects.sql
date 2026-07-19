-- =============================================================================
-- Migration: AidoFor.me Phase 1 projects, documents, policy, and activity
-- Date: 2026-07-19
--
-- Scope
--   - Aido-owned project records and ownership membership
--   - private assignment-document metadata
--   - append-only project activity
--   - a private, size- and MIME-limited Storage bucket
--   - atomic security-invoker RPCs for project setup
--
-- This migration does not modify TutorPakar-owned tables, triggers, or buckets.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Domain enums
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aido_project_status') THEN
    CREATE TYPE public.aido_project_status AS ENUM ('setup', 'active', 'archived');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aido_integrity_mode') THEN
    CREATE TYPE public.aido_integrity_mode AS ENUM (
      'unknown',
      'no_ai',
      'planning_only',
      'assistive_writing',
      'open_required_ai'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aido_project_member_role') THEN
    CREATE TYPE public.aido_project_member_role AS ENUM ('owner', 'editor', 'viewer');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aido_document_kind') THEN
    CREATE TYPE public.aido_document_kind AS ENUM (
      'brief',
      'rubric',
      'policy',
      'template',
      'source',
      'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aido_document_status') THEN
    CREATE TYPE public.aido_document_status AS ENUM (
      'uploaded',
      'processing',
      'ready',
      'failed'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Projects
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aido_writing_projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  course_name       text,
  assignment_type   text NOT NULL,
  deadline          date,
  target_word_count integer,
  citation_style    text NOT NULL DEFAULT 'APA 7',
  integrity_mode    public.aido_integrity_mode NOT NULL DEFAULT 'unknown',
  policy_text       text,
  status            public.aido_project_status NOT NULL DEFAULT 'setup',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_writing_projects_title_length
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT aido_writing_projects_course_length
    CHECK (course_name IS NULL OR char_length(course_name) <= 160),
  CONSTRAINT aido_writing_projects_assignment_type_length
    CHECK (char_length(btrim(assignment_type)) BETWEEN 1 AND 80),
  CONSTRAINT aido_writing_projects_word_count_range
    CHECK (target_word_count IS NULL OR target_word_count BETWEEN 100 AND 100000),
  CONSTRAINT aido_writing_projects_citation_style_length
    CHECK (char_length(btrim(citation_style)) BETWEEN 1 AND 64),
  CONSTRAINT aido_writing_projects_policy_length
    CHECK (policy_text IS NULL OR char_length(policy_text) <= 20000)
);

CREATE INDEX IF NOT EXISTS idx_aido_writing_projects_owner_status_updated
  ON public.aido_writing_projects (owner_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS aido_set_projects_updated_at
  ON public.aido_writing_projects;
CREATE TRIGGER aido_set_projects_updated_at
  BEFORE UPDATE ON public.aido_writing_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.aido_set_updated_at();

-- ----------------------------------------------------------------------------
-- Project membership (owner-only in Phase 1; editor/viewer are future-ready)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aido_project_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.aido_writing_projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.aido_project_member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_project_members_project_user_unique UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_aido_project_members_user_project
  ON public.aido_project_members (user_id, project_id);

-- ----------------------------------------------------------------------------
-- Assignment-document metadata
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aido_assignment_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.aido_writing_projects(id) ON DELETE CASCADE,
  uploaded_by       uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind              public.aido_document_kind NOT NULL,
  original_filename text NOT NULL,
  storage_bucket    text NOT NULL DEFAULT 'aido-assignment-files',
  storage_path      text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL,
  content_hash      text,
  status            public.aido_document_status NOT NULL DEFAULT 'uploaded',
  failure_code      text,
  failure_message   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_assignment_documents_storage_path_unique UNIQUE (storage_bucket, storage_path),
  CONSTRAINT aido_assignment_documents_filename_length
    CHECK (char_length(btrim(original_filename)) BETWEEN 1 AND 255),
  CONSTRAINT aido_assignment_documents_bucket
    CHECK (storage_bucket = 'aido-assignment-files'),
  CONSTRAINT aido_assignment_documents_path_length
    CHECK (char_length(storage_path) BETWEEN 5 AND 1024),
  CONSTRAINT aido_assignment_documents_mime_length
    CHECK (char_length(mime_type) BETWEEN 1 AND 160),
  CONSTRAINT aido_assignment_documents_size
    CHECK (size_bytes BETWEEN 1 AND 26214400),
  CONSTRAINT aido_assignment_documents_hash_length
    CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT aido_assignment_documents_failure_consistency
    CHECK (
      (status <> 'failed' AND failure_code IS NULL AND failure_message IS NULL)
      OR status = 'failed'
    )
);

CREATE INDEX IF NOT EXISTS idx_aido_assignment_documents_project_kind_created
  ON public.aido_assignment_documents (project_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aido_assignment_documents_uploaded_by
  ON public.aido_assignment_documents (uploaded_by);

DROP TRIGGER IF EXISTS aido_set_documents_updated_at
  ON public.aido_assignment_documents;
CREATE TRIGGER aido_set_documents_updated_at
  BEFORE UPDATE ON public.aido_assignment_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.aido_set_updated_at();

-- ----------------------------------------------------------------------------
-- Append-only project activity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aido_project_activity (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.aido_writing_projects(id) ON DELETE CASCADE,
  actor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_project_activity_event_type_length
    CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 80),
  CONSTRAINT aido_project_activity_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_aido_project_activity_project_created
  ON public.aido_project_activity (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aido_project_activity_actor
  ON public.aido_project_activity (actor_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE public.aido_writing_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_assignment_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aido_project_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Aido owners read projects" ON public.aido_writing_projects;
DROP POLICY IF EXISTS "Aido owners insert projects" ON public.aido_writing_projects;
DROP POLICY IF EXISTS "Aido owners update projects" ON public.aido_writing_projects;
DROP POLICY IF EXISTS "Aido owners delete projects" ON public.aido_writing_projects;

CREATE POLICY "Aido owners read projects"
  ON public.aido_writing_projects FOR SELECT TO authenticated
  USING ((select auth.uid()) = owner_id);
CREATE POLICY "Aido owners insert projects"
  ON public.aido_writing_projects FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY "Aido owners update projects"
  ON public.aido_writing_projects FOR UPDATE TO authenticated
  USING ((select auth.uid()) = owner_id)
  WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY "Aido owners delete projects"
  ON public.aido_writing_projects FOR DELETE TO authenticated
  USING ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Aido owners read project members" ON public.aido_project_members;
DROP POLICY IF EXISTS "Aido owners insert own owner membership" ON public.aido_project_members;
DROP POLICY IF EXISTS "Aido owners update project members" ON public.aido_project_members;
DROP POLICY IF EXISTS "Aido owners delete project members" ON public.aido_project_members;

CREATE POLICY "Aido owners read project members"
  ON public.aido_project_members FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id = project_id AND p.owner_id = (select auth.uid())
    )
  );
CREATE POLICY "Aido owners insert own owner membership"
  ON public.aido_project_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id = project_id AND p.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Aido owners read assignment documents" ON public.aido_assignment_documents;
DROP POLICY IF EXISTS "Aido owners insert assignment documents" ON public.aido_assignment_documents;
DROP POLICY IF EXISTS "Aido owners update assignment documents" ON public.aido_assignment_documents;
DROP POLICY IF EXISTS "Aido owners delete assignment documents" ON public.aido_assignment_documents;

CREATE POLICY "Aido owners read assignment documents"
  ON public.aido_assignment_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id = project_id AND p.owner_id = (select auth.uid())
    )
  );
CREATE POLICY "Aido owners insert assignment documents"
  ON public.aido_assignment_documents FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id = project_id AND p.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Aido owners read project activity" ON public.aido_project_activity;
DROP POLICY IF EXISTS "Aido owners append project activity" ON public.aido_project_activity;

CREATE POLICY "Aido owners read project activity"
  ON public.aido_project_activity FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id = project_id AND p.owner_id = (select auth.uid())
    )
  );
CREATE POLICY "Aido owners append project activity"
  ON public.aido_project_activity FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id = project_id AND p.owner_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Explicit Data API grants. RLS remains the row-level authorization boundary.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.aido_writing_projects FROM anon;
REVOKE ALL ON public.aido_project_members FROM anon;
REVOKE ALL ON public.aido_assignment_documents FROM anon;
REVOKE ALL ON public.aido_project_activity FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aido_writing_projects TO authenticated;
REVOKE UPDATE, DELETE ON public.aido_project_members FROM authenticated;
REVOKE UPDATE, DELETE ON public.aido_assignment_documents FROM authenticated;
GRANT SELECT, INSERT ON public.aido_project_members TO authenticated;
GRANT SELECT, INSERT ON public.aido_assignment_documents TO authenticated;
GRANT SELECT, INSERT ON public.aido_project_activity TO authenticated;

GRANT ALL ON public.aido_writing_projects TO service_role;
GRANT ALL ON public.aido_project_members TO service_role;
GRANT ALL ON public.aido_assignment_documents TO service_role;
GRANT ALL ON public.aido_project_activity TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aido_project_activity_id_seq TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Private Storage bucket and owner/project scoped object policies.
-- Path format: <auth-user-id>/<project-id>/<random-id>-<safe-filename>
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'aido-assignment-files',
  'aido-assignment-files',
  false,
  26214400,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'text/plain'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Aido owners read assignment files" ON storage.objects;
DROP POLICY IF EXISTS "Aido owners upload assignment files" ON storage.objects;
DROP POLICY IF EXISTS "Aido owners update assignment files" ON storage.objects;
DROP POLICY IF EXISTS "Aido owners delete assignment files" ON storage.objects;

CREATE POLICY "Aido owners read assignment files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'aido-assignment-files'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.owner_id = (select auth.uid())
    )
  );

CREATE POLICY "Aido owners upload assignment files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'aido-assignment-files'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.owner_id = (select auth.uid())
    )
  );

CREATE POLICY "Aido owners delete assignment files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'aido-assignment-files'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.owner_id = (select auth.uid())
    )
  );

-- Keep project state and document metadata valid even if an authenticated
-- user calls the Data API directly instead of using the application UI.
CREATE OR REPLACE FUNCTION public.aido_validate_project_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active')
    AND NOT EXISTS (
      SELECT 1
      FROM public.aido_assignment_documents document
      WHERE document.project_id = NEW.id
        AND document.kind = 'brief'
    )
  THEN
    RAISE EXCEPTION 'Assignment brief required before activation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aido_validate_project_status
  ON public.aido_writing_projects;
CREATE TRIGGER aido_validate_project_status
  BEFORE INSERT OR UPDATE OF status ON public.aido_writing_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.aido_validate_project_status();

CREATE OR REPLACE FUNCTION public.aido_validate_assignment_document()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
BEGIN
  IF NEW.uploaded_by <> (select auth.uid()) THEN
    RAISE EXCEPTION 'Uploader must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.storage_path NOT LIKE
    NEW.uploaded_by::text || '/' || NEW.project_id::text || '/%'
  THEN
    RAISE EXCEPTION 'Invalid assignment file path'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects object
    WHERE object.bucket_id = 'aido-assignment-files'
      AND object.name = NEW.storage_path
      AND COALESCE((object.metadata->>'size')::bigint, -1) = NEW.size_bytes
      AND COALESCE(object.metadata->>'mimetype', '') = NEW.mime_type
  ) THEN
    RAISE EXCEPTION 'Assignment file metadata does not match stored object'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aido_validate_assignment_document
  ON public.aido_assignment_documents;
CREATE TRIGGER aido_validate_assignment_document
  BEFORE INSERT ON public.aido_assignment_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.aido_validate_assignment_document();

REVOKE ALL ON FUNCTION public.aido_validate_project_status()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_validate_assignment_document()
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Atomic setup RPCs. They are SECURITY INVOKER (the default), so table RLS and
-- grants continue to enforce ownership. Public/anon cannot execute them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aido_create_project(
  p_title text,
  p_course_name text,
  p_assignment_type text,
  p_deadline date,
  p_target_word_count integer,
  p_citation_style text,
  p_integrity_mode public.aido_integrity_mode,
  p_policy_text text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (select auth.uid());
  v_project_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.aido_product_memberships membership
    WHERE membership.user_id = v_user_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active Aido membership required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.aido_writing_projects (
    owner_id,
    title,
    course_name,
    assignment_type,
    deadline,
    target_word_count,
    citation_style,
    integrity_mode,
    policy_text
  )
  VALUES (
    v_user_id,
    btrim(p_title),
    NULLIF(btrim(p_course_name), ''),
    btrim(p_assignment_type),
    p_deadline,
    p_target_word_count,
    btrim(p_citation_style),
    p_integrity_mode,
    NULLIF(btrim(p_policy_text), '')
  )
  RETURNING id INTO v_project_id;

  INSERT INTO public.aido_project_members (project_id, user_id, role)
  VALUES (v_project_id, v_user_id, 'owner');

  INSERT INTO public.aido_project_activity (project_id, actor_id, event_type, metadata)
  VALUES (
    v_project_id,
    v_user_id,
    'project.created',
    jsonb_build_object('integrity_mode', p_integrity_mode::text)
  );

  RETURN v_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_register_assignment_document(
  p_project_id uuid,
  p_kind public.aido_document_kind,
  p_original_filename text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (select auth.uid());
  v_document_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Retrying after a network interruption must not create a second metadata
  -- row or a duplicate activity event for the same immutable object path.
  SELECT document.id
  INTO v_document_id
  FROM public.aido_assignment_documents document
  WHERE document.project_id = p_project_id
    AND document.storage_bucket = 'aido-assignment-files'
    AND document.storage_path = p_storage_path;

  IF v_document_id IS NOT NULL THEN
    RETURN v_document_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects object
    WHERE object.bucket_id = 'aido-assignment-files'
      AND object.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'Uploaded object not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.aido_assignment_documents (
    project_id,
    uploaded_by,
    kind,
    original_filename,
    storage_path,
    mime_type,
    size_bytes,
    content_hash
  )
  VALUES (
    p_project_id,
    v_user_id,
    p_kind,
    btrim(p_original_filename),
    p_storage_path,
    p_mime_type,
    p_size_bytes,
    p_content_hash
  )
  RETURNING id INTO v_document_id;

  INSERT INTO public.aido_project_activity (project_id, actor_id, event_type, metadata)
  VALUES (
    p_project_id,
    v_user_id,
    'document.uploaded',
    jsonb_build_object(
      'document_id', v_document_id,
      'kind', p_kind::text,
      'filename', btrim(p_original_filename)
    )
  );

  RETURN v_document_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aido_complete_project_setup(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (select auth.uid());
  v_status public.aido_project_status;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project.status
  INTO v_status
  FROM public.aido_writing_projects project
  WHERE project.id = p_project_id
    AND project.owner_id = v_user_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002';
  END IF;

  -- Repeated completion calls are safe and do not create duplicate history.
  IF v_status = 'active' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.aido_assignment_documents document
    WHERE document.project_id = p_project_id
      AND document.kind = 'brief'
  ) THEN
    RAISE EXCEPTION 'Assignment brief required' USING ERRCODE = '23514';
  END IF;

  UPDATE public.aido_writing_projects
  SET status = 'active'
  WHERE id = p_project_id
    AND owner_id = v_user_id
    AND status = 'setup';

  INSERT INTO public.aido_project_activity (project_id, actor_id, event_type)
  VALUES (p_project_id, v_user_id, 'project.setup_completed');
END;
$$;

REVOKE ALL ON FUNCTION public.aido_create_project(
  text, text, text, date, integer, text, public.aido_integrity_mode, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aido_register_assignment_document(
  uuid, public.aido_document_kind, text, text, text, bigint, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aido_complete_project_setup(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.aido_create_project(
  text, text, text, date, integer, text, public.aido_integrity_mode, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aido_register_assignment_document(
  uuid, public.aido_document_kind, text, text, text, bigint, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aido_complete_project_setup(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
