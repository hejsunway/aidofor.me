-- =============================================================================
-- Migration: aido_phase_one_privilege_hardening
--
-- Purpose
--   Make the Phase 1 Data API surface deterministic on both legacy Supabase
--   projects (where broad default privileges may exist) and newer projects
--   (where public objects are not exposed automatically).
--
-- Important
--   RLS controls rows, but it does not make privileges such as TRUNCATE safe.
--   Revoke every inherited/default privilege on AidoForMe-owned Phase 1
--   objects, then grant only the operations required by the application.
--   This migration deliberately does not change shared-project default
--   privileges because those defaults may be relied upon by TutorPakar.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.aido_product_memberships,
  public.aido_writing_projects,
  public.aido_project_members,
  public.aido_assignment_documents,
  public.aido_project_activity,
  public.aido_project_policies,
  public.aido_project_deletion_audit
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.aido_product_memberships
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.aido_writing_projects
  TO authenticated;

GRANT SELECT, INSERT
  ON TABLE public.aido_project_members
  TO authenticated;

-- UPDATE is used only by the immutable replacement RPC; RLS and the
-- replacement-link constraints prevent moving or rewriting another user's row.
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.aido_assignment_documents
  TO authenticated;

GRANT SELECT, INSERT
  ON TABLE public.aido_project_activity
  TO authenticated;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.aido_project_policies
  TO authenticated;

GRANT SELECT, INSERT
  ON TABLE public.aido_project_deletion_audit
  TO authenticated;

GRANT ALL ON TABLE
  public.aido_product_memberships,
  public.aido_writing_projects,
  public.aido_project_members,
  public.aido_assignment_documents,
  public.aido_project_activity,
  public.aido_project_policies,
  public.aido_project_deletion_audit
TO service_role;

-- ----------------------------------------------------------------------------
-- Identity sequences
-- ----------------------------------------------------------------------------
REVOKE ALL ON SEQUENCE
  public.aido_project_activity_id_seq,
  public.aido_project_deletion_audit_id_seq
FROM PUBLIC, anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.aido_project_activity_id_seq,
  public.aido_project_deletion_audit_id_seq
TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Trigger/internal functions. Table triggers continue to invoke these; they
-- are not part of the client-callable RPC surface.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.aido_set_updated_at()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_validate_project_status()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_validate_assignment_document()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_enforce_document_limits()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aido_set_updated_at()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_validate_project_status()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_validate_assignment_document()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.aido_enforce_document_limits()
  TO service_role;

-- ----------------------------------------------------------------------------
-- Client-callable Phase 1 RPCs
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.aido_create_project(
  text, text, text, date, integer, text, public.aido_integrity_mode, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_register_assignment_document(
  uuid, public.aido_document_kind, text, text, text, bigint, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_complete_project_setup(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_replace_assignment_document(
  uuid, uuid, public.aido_document_kind, text, text, text, bigint, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aido_delete_project(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aido_create_project(
  text, text, text, date, integer, text, public.aido_integrity_mode, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aido_register_assignment_document(
  uuid, public.aido_document_kind, text, text, text, bigint, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aido_complete_project_setup(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aido_replace_assignment_document(
  uuid, uuid, public.aido_document_kind, text, text, text, bigint, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aido_delete_project(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
