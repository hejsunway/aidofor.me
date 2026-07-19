BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(41);

SELECT has_table('public', 'aido_project_policies', 'project policies are persisted separately');
SELECT has_table('public', 'aido_project_deletion_audit', 'project deletion audit exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.aido_project_policies'::regclass),
  'project policies have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.aido_project_deletion_audit'::regclass),
  'deletion audit has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.aido_writing_projects', 'SELECT'),
  'anonymous role has no project table grant'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.aido_writing_projects', 'SELECT'),
  'authenticated role has the explicit project read grant'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.aido_assignment_documents', 'DELETE'),
  'authenticated users cannot directly delete document metadata'
);
SELECT ok(
  (
    SELECT bool_and(has_table_privilege('authenticated', object_name, privilege_name))
    FROM (VALUES
      ('public.aido_product_memberships', 'SELECT'),
      ('public.aido_product_memberships', 'INSERT'),
      ('public.aido_product_memberships', 'UPDATE'),
      ('public.aido_product_memberships', 'DELETE'),
      ('public.aido_writing_projects', 'SELECT'),
      ('public.aido_writing_projects', 'INSERT'),
      ('public.aido_writing_projects', 'UPDATE'),
      ('public.aido_writing_projects', 'DELETE'),
      ('public.aido_project_members', 'SELECT'),
      ('public.aido_project_members', 'INSERT'),
      ('public.aido_assignment_documents', 'SELECT'),
      ('public.aido_assignment_documents', 'INSERT'),
      ('public.aido_assignment_documents', 'UPDATE'),
      ('public.aido_project_activity', 'SELECT'),
      ('public.aido_project_activity', 'INSERT'),
      ('public.aido_project_policies', 'SELECT'),
      ('public.aido_project_policies', 'INSERT'),
      ('public.aido_project_policies', 'UPDATE'),
      ('public.aido_project_deletion_audit', 'SELECT'),
      ('public.aido_project_deletion_audit', 'INSERT')
    ) AS required_grant(object_name, privilege_name)
  ),
  'authenticated has every required Phase 1 table privilege'
);
SELECT ok(
  (
    SELECT bool_and(NOT has_table_privilege('authenticated', object_name, privilege_name))
    FROM (VALUES
      ('public.aido_product_memberships', 'TRUNCATE'),
      ('public.aido_product_memberships', 'REFERENCES'),
      ('public.aido_product_memberships', 'TRIGGER'),
      ('public.aido_writing_projects', 'TRUNCATE'),
      ('public.aido_writing_projects', 'REFERENCES'),
      ('public.aido_writing_projects', 'TRIGGER'),
      ('public.aido_project_members', 'UPDATE'),
      ('public.aido_project_members', 'DELETE'),
      ('public.aido_project_members', 'TRUNCATE'),
      ('public.aido_project_members', 'REFERENCES'),
      ('public.aido_project_members', 'TRIGGER'),
      ('public.aido_assignment_documents', 'DELETE'),
      ('public.aido_assignment_documents', 'TRUNCATE'),
      ('public.aido_assignment_documents', 'REFERENCES'),
      ('public.aido_assignment_documents', 'TRIGGER'),
      ('public.aido_project_activity', 'UPDATE'),
      ('public.aido_project_activity', 'DELETE'),
      ('public.aido_project_activity', 'TRUNCATE'),
      ('public.aido_project_activity', 'REFERENCES'),
      ('public.aido_project_activity', 'TRIGGER'),
      ('public.aido_project_policies', 'DELETE'),
      ('public.aido_project_policies', 'TRUNCATE'),
      ('public.aido_project_policies', 'REFERENCES'),
      ('public.aido_project_policies', 'TRIGGER'),
      ('public.aido_project_deletion_audit', 'UPDATE'),
      ('public.aido_project_deletion_audit', 'DELETE'),
      ('public.aido_project_deletion_audit', 'TRUNCATE'),
      ('public.aido_project_deletion_audit', 'REFERENCES'),
      ('public.aido_project_deletion_audit', 'TRIGGER')
    ) AS forbidden_grant(object_name, privilege_name)
  ),
  'authenticated has no unsafe or unnecessary Phase 1 table privilege'
);
SELECT ok(
  (
    SELECT bool_and(NOT has_table_privilege('anon', object_name, privilege_name))
    FROM unnest(ARRAY[
      'public.aido_product_memberships',
      'public.aido_writing_projects',
      'public.aido_project_members',
      'public.aido_assignment_documents',
      'public.aido_project_activity',
      'public.aido_project_policies',
      'public.aido_project_deletion_audit'
    ]) AS phase_one_table(object_name)
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]) AS table_privilege(privilege_name)
  ),
  'anonymous has no Phase 1 table privilege'
);
SELECT ok(
  (
    SELECT bool_and(NOT has_function_privilege('authenticated', function_name, 'EXECUTE'))
    FROM unnest(ARRAY[
      'public.aido_set_updated_at()',
      'public.aido_validate_project_status()',
      'public.aido_validate_assignment_document()',
      'public.aido_enforce_document_limits()'
    ]) AS internal_function(function_name)
  ),
  'authenticated cannot directly execute Phase 1 internal functions'
);
SELECT ok(
  (
    SELECT bool_and(NOT has_function_privilege('anon', function_name, 'EXECUTE'))
    FROM unnest(ARRAY[
      'public.aido_set_updated_at()',
      'public.aido_validate_project_status()',
      'public.aido_validate_assignment_document()',
      'public.aido_enforce_document_limits()'
    ]) AS internal_function(function_name)
  ),
  'anonymous cannot execute Phase 1 internal functions'
);
SELECT ok(
  (
    SELECT bool_and(has_function_privilege('authenticated', function_name, 'EXECUTE'))
    FROM unnest(ARRAY[
      'public.aido_create_project(text,text,text,date,integer,text,public.aido_integrity_mode,text)',
      'public.aido_register_assignment_document(uuid,public.aido_document_kind,text,text,text,bigint,text)',
      'public.aido_complete_project_setup(uuid)',
      'public.aido_replace_assignment_document(uuid,uuid,public.aido_document_kind,text,text,text,bigint,text)',
      'public.aido_delete_project(uuid)'
    ]) AS public_function(function_name)
  ),
  'authenticated can execute only the intended Phase 1 RPC surface'
);
SELECT ok(
  (
    SELECT bool_and(NOT has_function_privilege('anon', function_name, 'EXECUTE'))
    FROM unnest(ARRAY[
      'public.aido_create_project(text,text,text,date,integer,text,public.aido_integrity_mode,text)',
      'public.aido_register_assignment_document(uuid,public.aido_document_kind,text,text,text,bigint,text)',
      'public.aido_complete_project_setup(uuid)',
      'public.aido_replace_assignment_document(uuid,uuid,public.aido_document_kind,text,text,text,bigint,text)',
      'public.aido_delete_project(uuid)'
    ]) AS public_function(function_name)
  ),
  'anonymous cannot execute Phase 1 RPCs'
);
SELECT ok(
  has_sequence_privilege('authenticated', 'public.aido_project_activity_id_seq', 'USAGE')
  AND has_sequence_privilege('authenticated', 'public.aido_project_activity_id_seq', 'SELECT')
  AND NOT has_sequence_privilege('authenticated', 'public.aido_project_activity_id_seq', 'UPDATE')
  AND has_sequence_privilege('authenticated', 'public.aido_project_deletion_audit_id_seq', 'USAGE')
  AND has_sequence_privilege('authenticated', 'public.aido_project_deletion_audit_id_seq', 'SELECT')
  AND NOT has_sequence_privilege('authenticated', 'public.aido_project_deletion_audit_id_seq', 'UPDATE'),
  'authenticated identity-sequence privileges are least privilege'
);

INSERT INTO auth.users (id, email, is_sso_user, is_anonymous)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'phase1-owner@example.test', false, false),
  ('00000000-0000-4000-8000-000000000002', 'phase1-other@example.test', false, false);

INSERT INTO public.aido_product_memberships (user_id, status, role)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'active', 'student'),
  ('00000000-0000-4000-8000-000000000002', 'active', 'student');

INSERT INTO public.aido_writing_projects (
  id, owner_id, title, assignment_type, citation_style, integrity_mode, status
) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Owner project', 'Report', 'APA 7', 'planning_only', 'setup'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'Other project', 'Report', 'APA 7', 'planning_only', 'setup'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Deletion project', 'Report', 'APA 7', 'planning_only', 'setup'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'File limit project', 'Report', 'APA 7', 'planning_only', 'setup');

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
SELECT
  'aido-assignment-files',
  '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000004/file-' || number || '.txt',
  '00000000-0000-4000-8000-000000000001',
  jsonb_build_object('size', 10, 'mimetype', 'text/plain')
FROM generate_series(1, 13) AS number;

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'aido-assignment-files',
    '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/original.txt',
    '00000000-0000-4000-8000-000000000001',
    '{"size":10,"mimetype":"text/plain"}'::jsonb
  ),
  (
    'aido-assignment-files',
    '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/replacement.txt',
    '00000000-0000-4000-8000-000000000001',
    '{"size":11,"mimetype":"text/plain"}'::jsonb
  ),
  (
    'aido-assignment-files',
    '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000003/delete-me.txt',
    '00000000-0000-4000-8000-000000000001',
    '{"size":12,"mimetype":"text/plain"}'::jsonb
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*) FROM public.aido_writing_projects),
  3::bigint,
  'owner sees only their own projects'
);
SELECT is(
  (SELECT count(*) FROM public.aido_writing_projects WHERE owner_id = '00000000-0000-4000-8000-000000000002'),
  0::bigint,
  'owner cannot see another user project'
);
SELECT is(
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'aido-assignment-files'),
  16::bigint,
  'owner can list only objects in their project paths'
);

SELECT lives_ok(
  $$SELECT public.aido_create_project(
    'RPC project', '', 'Report', NULL, 1200, 'APA 7', 'planning_only', 'Exact permitted planning policy'
  )$$,
  'project creation RPC succeeds for an active member'
);
SELECT is(
  (SELECT count(*) FROM public.aido_project_policies policy
   JOIN public.aido_writing_projects project ON project.id = policy.project_id
   WHERE project.title = 'RPC project' AND policy.policy_text = 'Exact permitted planning policy'),
  1::bigint,
  'project creation stores the exact policy snapshot'
);
SELECT is(
  (SELECT count(*) FROM public.aido_project_activity activity
   JOIN public.aido_writing_projects project ON project.id = activity.project_id
   WHERE project.title = 'RPC project' AND activity.event_type = 'project.policy_confirmed'),
  1::bigint,
  'confirmed policy creates an append-only activity event'
);

SELECT lives_ok(
  $$SELECT public.aido_register_assignment_document(
    '10000000-0000-4000-8000-000000000001', 'brief', 'original.txt',
    '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/original.txt',
    'text/plain', 10, repeat('0', 64)
  )$$,
  'owner can register a verified stored object'
);
SELECT is(
  (SELECT count(*) FROM public.aido_assignment_documents
   WHERE project_id = '10000000-0000-4000-8000-000000000001' AND replaced_at IS NULL),
  1::bigint,
  'registered object has one current metadata row'
);
SELECT lives_ok(
  $$SELECT public.aido_replace_assignment_document(
    '10000000-0000-4000-8000-000000000001',
    (SELECT id FROM public.aido_assignment_documents
     WHERE project_id = '10000000-0000-4000-8000-000000000001' AND replaced_at IS NULL),
    'brief', 'replacement.txt',
    '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/replacement.txt',
    'text/plain', 11, repeat('1', 64)
  )$$,
  'owner can atomically replace a current document'
);
SELECT is(
  (SELECT count(*) FROM public.aido_assignment_documents
   WHERE project_id = '10000000-0000-4000-8000-000000000001' AND replaced_at IS NOT NULL),
  1::bigint,
  'replacement preserves the superseded metadata row'
);
SELECT is(
  (SELECT count(*) FROM public.aido_project_activity
   WHERE project_id = '10000000-0000-4000-8000-000000000001' AND event_type = 'document.replaced'),
  1::bigint,
  'replacement records one activity event'
);

SELECT lives_ok(
  $$INSERT INTO public.aido_assignment_documents (
    project_id, uploaded_by, kind, original_filename, storage_path, mime_type, size_bytes, content_hash
  )
  SELECT
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001',
    'other',
    'file-' || number || '.txt',
    '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000004/file-' || number || '.txt',
    'text/plain', 10, repeat('2', 64)
  FROM generate_series(1, 12) AS number$$,
  'the first twelve current files are accepted'
);
SELECT throws_ok(
  $$INSERT INTO public.aido_assignment_documents (
    project_id, uploaded_by, kind, original_filename, storage_path, mime_type, size_bytes, content_hash
  ) VALUES (
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001',
    'other', 'file-13.txt',
    '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000004/file-13.txt',
    'text/plain', 10, repeat('3', 64)
  )$$,
  '23514',
  'Project file limit reached',
  'the thirteenth current file is rejected by the database'
);

INSERT INTO public.aido_assignment_documents (
  project_id, uploaded_by, kind, original_filename, storage_path, mime_type, size_bytes, content_hash
) VALUES (
  '10000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000001',
  'brief', 'delete-me.txt',
  '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000003/delete-me.txt',
  'text/plain', 12, repeat('4', 64)
);
SELECT lives_ok(
  $$SELECT public.aido_delete_project('10000000-0000-4000-8000-000000000003')$$,
  'owner can delete the project after object cleanup'
);
SELECT is(
  (SELECT count(*) FROM public.aido_writing_projects WHERE id = '10000000-0000-4000-8000-000000000003'),
  0::bigint,
  'project relational row is deleted'
);
SELECT is(
  (SELECT count(*) FROM public.aido_assignment_documents WHERE project_id = '10000000-0000-4000-8000-000000000003'),
  0::bigint,
  'project document metadata cascades on deletion'
);
SELECT is(
  (SELECT count(*) FROM public.aido_project_deletion_audit WHERE deleted_project_id = '10000000-0000-4000-8000-000000000003'),
  1::bigint,
  'deletion audit survives the project cascade'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*) FROM public.aido_writing_projects),
  1::bigint,
  'unrelated authenticated user sees only their own project'
);
SELECT is(
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'aido-assignment-files'),
  0::bigint,
  'unrelated authenticated user cannot list owner objects'
);
SELECT is(
  (SELECT count(*) FROM public.aido_project_deletion_audit),
  0::bigint,
  'unrelated authenticated user cannot read owner deletion audit'
);
SELECT lives_ok(
  $$UPDATE public.aido_writing_projects SET title = 'Blocked change'
    WHERE id = '10000000-0000-4000-8000-000000000001'$$,
  'unrelated direct update is safely reduced to zero rows by RLS'
);
SELECT throws_ok(
  $$DELETE FROM storage.objects
    WHERE bucket_id = 'aido-assignment-files'
      AND name LIKE '00000000-0000-4000-8000-000000000001/%'$$,
  '42501',
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'direct object-table deletion is blocked before it can bypass the Storage API'
);

RESET ROLE;
SELECT is(
  (SELECT title FROM public.aido_writing_projects WHERE id = '10000000-0000-4000-8000-000000000001'),
  'Owner project',
  'unrelated authenticated update did not change the owner project'
);
SELECT is(
  (SELECT count(*) FROM storage.objects
   WHERE bucket_id = 'aido-assignment-files'
     AND name LIKE '00000000-0000-4000-8000-000000000001/%'),
  16::bigint,
  'unrelated authenticated deletion did not remove owner objects'
);
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT throws_ok(
  $$SELECT public.aido_create_project('No', '', 'Report', NULL, NULL, 'APA 7', 'unknown', '')$$,
  '42501',
  NULL,
  'anonymous callers cannot execute project creation'
);
SELECT throws_ok(
  $$SELECT * FROM public.aido_project_deletion_audit$$,
  '42501',
  NULL,
  'anonymous callers have no deletion-audit table grant'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
