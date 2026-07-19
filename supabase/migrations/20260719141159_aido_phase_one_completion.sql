-- =============================================================================
-- Migration: Complete AidoFor.me Phase 1 delivery gates
-- Date: 2026-07-19
--
-- Adds the Phase 1 records and invariants that were not present in the first
-- project migration: explicit policy snapshots, bounded file counts, immutable
-- document replacement, and a deletion audit that survives project cascades.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.aido_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Project policy snapshot
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_project_policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.aido_writing_projects(id) ON DELETE CASCADE,
  confirmed_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  integrity_mode public.aido_integrity_mode NOT NULL,
  policy_text    text,
  is_confirmed   boolean NOT NULL DEFAULT false,
  confirmed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_project_policies_project_unique UNIQUE (project_id),
  CONSTRAINT aido_project_policies_text_length
    CHECK (policy_text IS NULL OR char_length(policy_text) <= 20000),
  CONSTRAINT aido_project_policies_confirmation_consistency
    CHECK (
      (is_confirmed AND integrity_mode <> 'unknown' AND confirmed_at IS NOT NULL)
      OR (NOT is_confirmed AND confirmed_at IS NULL)
    )
);

CREATE INDEX idx_aido_project_policies_confirmed_by
  ON public.aido_project_policies (confirmed_by);

CREATE TRIGGER aido_set_project_policies_updated_at
  BEFORE UPDATE ON public.aido_project_policies
  FOR EACH ROW EXECUTE FUNCTION public.aido_set_updated_at();

INSERT INTO public.aido_project_policies (
  project_id,
  confirmed_by,
  integrity_mode,
  policy_text,
  is_confirmed,
  confirmed_at,
  created_at,
  updated_at
)
SELECT
  project.id,
  project.owner_id,
  project.integrity_mode,
  project.policy_text,
  project.integrity_mode <> 'unknown',
  CASE WHEN project.integrity_mode <> 'unknown' THEN project.created_at ELSE NULL END,
  project.created_at,
  project.updated_at
FROM public.aido_writing_projects project
ON CONFLICT (project_id) DO NOTHING;

ALTER TABLE public.aido_project_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aido owners read project policies"
  ON public.aido_project_policies FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.aido_writing_projects project
      WHERE project.id = project_id
        AND project.owner_id = (select auth.uid())
    )
  );

CREATE POLICY "Aido owners insert project policies"
  ON public.aido_project_policies FOR INSERT TO authenticated
  WITH CHECK (
    confirmed_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects project
      WHERE project.id = project_id
        AND project.owner_id = (select auth.uid())
    )
  );

CREATE POLICY "Aido owners update project policies"
  ON public.aido_project_policies FOR UPDATE TO authenticated
  USING (
    confirmed_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects project
      WHERE project.id = project_id
        AND project.owner_id = (select auth.uid())
    )
  )
  WITH CHECK (
    confirmed_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects project
      WHERE project.id = project_id
        AND project.owner_id = (select auth.uid())
    )
  );

REVOKE ALL ON public.aido_project_policies FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.aido_project_policies TO authenticated;
GRANT ALL ON public.aido_project_policies TO service_role;

-- ----------------------------------------------------------------------------
-- Immutable replacement chain and bounded active document count
-- ----------------------------------------------------------------------------
ALTER TABLE public.aido_assignment_documents
  ADD COLUMN replaces_document_id uuid,
  ADD COLUMN replaced_by_document_id uuid,
  ADD COLUMN replaced_at timestamptz;

ALTER TABLE public.aido_assignment_documents
  ADD CONSTRAINT aido_assignment_documents_replaces_fkey
    FOREIGN KEY (replaces_document_id)
    REFERENCES public.aido_assignment_documents(id) ON DELETE SET NULL,
  ADD CONSTRAINT aido_assignment_documents_replaced_by_fkey
    FOREIGN KEY (replaced_by_document_id)
    REFERENCES public.aido_assignment_documents(id) ON DELETE SET NULL,
  ADD CONSTRAINT aido_assignment_documents_replacement_consistency
    CHECK (
      (replaced_by_document_id IS NOT NULL AND replaced_at IS NOT NULL)
      OR (replaced_by_document_id IS NULL AND replaced_at IS NULL)
    );

CREATE UNIQUE INDEX idx_aido_assignment_documents_replaces_once
  ON public.aido_assignment_documents (replaces_document_id)
  WHERE replaces_document_id IS NOT NULL;
CREATE INDEX idx_aido_assignment_documents_replaced_by
  ON public.aido_assignment_documents (replaced_by_document_id)
  WHERE replaced_by_document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.aido_enforce_document_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_active_count integer;
BEGIN
  SELECT count(*)
  INTO v_active_count
  FROM public.aido_assignment_documents document
  WHERE document.project_id = NEW.project_id
    AND document.replaced_at IS NULL;

  IF v_active_count >= 12 AND NEW.replaces_document_id IS NULL THEN
    RAISE EXCEPTION 'Project file limit reached' USING ERRCODE = '23514';
  END IF;

  IF NEW.replaces_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.aido_assignment_documents previous
    WHERE previous.id = NEW.replaces_document_id
      AND previous.project_id = NEW.project_id
      AND previous.kind = NEW.kind
      AND previous.replaced_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Replacement document is invalid' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER aido_enforce_document_limits
  BEFORE INSERT ON public.aido_assignment_documents
  FOR EACH ROW EXECUTE FUNCTION public.aido_enforce_document_limits();

REVOKE ALL ON FUNCTION public.aido_enforce_document_limits()
  FROM PUBLIC, anon, authenticated;

CREATE POLICY "Aido owners replace assignment documents"
  ON public.aido_assignment_documents FOR UPDATE TO authenticated
  USING (
    uploaded_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects project
      WHERE project.id = project_id
        AND project.owner_id = (select auth.uid())
    )
  )
  WITH CHECK (
    uploaded_by = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.aido_writing_projects project
      WHERE project.id = project_id
        AND project.owner_id = (select auth.uid())
    )
  );

GRANT UPDATE ON public.aido_assignment_documents TO authenticated;

CREATE OR REPLACE FUNCTION public.aido_replace_assignment_document(
  p_project_id uuid,
  p_replaces_document_id uuid,
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
  v_previous public.aido_assignment_documents%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT previous.*
  INTO v_previous
  FROM public.aido_assignment_documents previous
  JOIN public.aido_writing_projects project ON project.id = previous.project_id
  WHERE previous.id = p_replaces_document_id
    AND previous.project_id = p_project_id
    AND previous.kind = p_kind
    AND previous.replaced_at IS NULL
    AND project.owner_id = v_user_id
  FOR UPDATE OF previous;

  IF v_previous.id IS NULL THEN
    RAISE EXCEPTION 'Replacement document not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT document.id INTO v_document_id
  FROM public.aido_assignment_documents document
  WHERE document.storage_bucket = 'aido-assignment-files'
    AND document.storage_path = p_storage_path;

  IF v_document_id IS NOT NULL THEN
    RETURN v_document_id;
  END IF;

  INSERT INTO public.aido_assignment_documents (
    project_id,
    uploaded_by,
    kind,
    original_filename,
    storage_path,
    mime_type,
    size_bytes,
    content_hash,
    replaces_document_id
  ) VALUES (
    p_project_id,
    v_user_id,
    p_kind,
    btrim(p_original_filename),
    p_storage_path,
    p_mime_type,
    p_size_bytes,
    p_content_hash,
    p_replaces_document_id
  ) RETURNING id INTO v_document_id;

  UPDATE public.aido_assignment_documents
  SET replaced_by_document_id = v_document_id,
      replaced_at = now()
  WHERE id = p_replaces_document_id;

  INSERT INTO public.aido_project_activity (project_id, actor_id, event_type, metadata)
  VALUES (
    p_project_id,
    v_user_id,
    'document.replaced',
    jsonb_build_object(
      'document_id', v_document_id,
      'replaced_document_id', p_replaces_document_id,
      'kind', p_kind::text,
      'filename', btrim(p_original_filename)
    )
  );

  RETURN v_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aido_replace_assignment_document(
  uuid, uuid, public.aido_document_kind, text, text, text, bigint, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aido_replace_assignment_document(
  uuid, uuid, public.aido_document_kind, text, text, text, bigint, text
) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Project deletion audit. This table deliberately has no project foreign key:
-- its purpose is to retain the deletion event after project rows cascade.
-- ----------------------------------------------------------------------------
CREATE TABLE public.aido_project_deletion_audit (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deleted_project_id uuid NOT NULL,
  owner_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_title      text NOT NULL,
  storage_paths      text[] NOT NULL DEFAULT '{}',
  deleted_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aido_project_deletion_audit_project_unique UNIQUE (deleted_project_id),
  CONSTRAINT aido_project_deletion_audit_title_length
    CHECK (char_length(btrim(project_title)) BETWEEN 1 AND 160),
  CONSTRAINT aido_project_deletion_audit_path_count
    CHECK (cardinality(storage_paths) <= 1000)
);

CREATE INDEX idx_aido_project_deletion_audit_owner_deleted
  ON public.aido_project_deletion_audit (owner_id, deleted_at DESC);

ALTER TABLE public.aido_project_deletion_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aido owners read project deletion audit"
  ON public.aido_project_deletion_audit FOR SELECT TO authenticated
  USING (owner_id = (select auth.uid()));

CREATE POLICY "Aido owners append project deletion audit"
  ON public.aido_project_deletion_audit FOR INSERT TO authenticated
  WITH CHECK (owner_id = (select auth.uid()));

REVOKE ALL ON public.aido_project_deletion_audit FROM anon;
GRANT SELECT, INSERT ON public.aido_project_deletion_audit TO authenticated;
GRANT ALL ON public.aido_project_deletion_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aido_project_deletion_audit_id_seq
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aido_delete_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (select auth.uid());
  v_project_title text;
  v_storage_paths text[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT project.title
  INTO v_project_title
  FROM public.aido_writing_projects project
  WHERE project.id = p_project_id
    AND project.owner_id = v_user_id
  FOR UPDATE;

  IF v_project_title IS NULL THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(document.storage_path ORDER BY document.created_at), '{}')
  INTO v_storage_paths
  FROM public.aido_assignment_documents document
  WHERE document.project_id = p_project_id;

  INSERT INTO public.aido_project_deletion_audit (
    deleted_project_id,
    owner_id,
    project_title,
    storage_paths
  ) VALUES (
    p_project_id,
    v_user_id,
    v_project_title,
    v_storage_paths
  ) ON CONFLICT (deleted_project_id) DO NOTHING;

  DELETE FROM public.aido_writing_projects
  WHERE id = p_project_id AND owner_id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aido_delete_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aido_delete_project(uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Replace project creation so policy capture and confirmation activity are
-- part of the same transaction as the project and owner membership.
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
  v_is_confirmed boolean := p_integrity_mode <> 'unknown';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.aido_product_memberships membership
    WHERE membership.user_id = v_user_id AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active Aido membership required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.aido_writing_projects (
    owner_id, title, course_name, assignment_type, deadline,
    target_word_count, citation_style, integrity_mode, policy_text
  ) VALUES (
    v_user_id, btrim(p_title), NULLIF(btrim(p_course_name), ''),
    btrim(p_assignment_type), p_deadline, p_target_word_count,
    btrim(p_citation_style), p_integrity_mode, NULLIF(btrim(p_policy_text), '')
  ) RETURNING id INTO v_project_id;

  INSERT INTO public.aido_project_members (project_id, user_id, role)
  VALUES (v_project_id, v_user_id, 'owner');

  INSERT INTO public.aido_project_policies (
    project_id, confirmed_by, integrity_mode, policy_text,
    is_confirmed, confirmed_at
  ) VALUES (
    v_project_id, v_user_id, p_integrity_mode, NULLIF(btrim(p_policy_text), ''),
    v_is_confirmed, CASE WHEN v_is_confirmed THEN now() ELSE NULL END
  );

  INSERT INTO public.aido_project_activity (project_id, actor_id, event_type, metadata)
  VALUES (
    v_project_id,
    v_user_id,
    'project.created',
    jsonb_build_object('integrity_mode', p_integrity_mode::text)
  );

  IF v_is_confirmed THEN
    INSERT INTO public.aido_project_activity (project_id, actor_id, event_type, metadata)
    VALUES (
      v_project_id,
      v_user_id,
      'project.policy_confirmed',
      jsonb_build_object('integrity_mode', p_integrity_mode::text)
    );
  END IF;

  RETURN v_project_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
