-- UNEXECUTED. Khani applies this manually in the Supabase SQL Editor.
-- Do not run supabase db push. Apply before the generated seed and before the
-- /api/exercise-media endpoint is deployed.
-- Reverse access change only:
-- supabase/manual/rollback/20261020230001_restore_exercise_media_client_access.sql.
-- Post-apply evidence:
-- supabase/manual/verify/VERIFY_exercise_media_service_only.sql.
--
-- This makes public.exercise_media and exercise-media objects backend-only.
-- storage.objects grants are deliberately untouched because they are global and
-- the avatar bucket depends on them. Bucket isolation is enforced by RLS.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

DO $migration$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(role_name) IS NULL THEN
      RAISE EXCEPTION 'precondition failed: role % does not exist', role_name;
    END IF;
  END LOOP;
  IF NOT (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = 'service_role') THEN
    RAISE EXCEPTION 'precondition failed: service_role does not bypass RLS';
  END IF;
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'precondition failed: Supabase storage catalog is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'exercise-media') THEN
    RAISE EXCEPTION 'precondition failed: exercise-media bucket is missing';
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS public.exercise_media (
  canonical_exercise_id text,
  provider text NOT NULL,
  external_media_id text NOT NULL,
  animation_path text NOT NULL,
  thumbnail_path text NOT NULL,
  media_version integer NOT NULL DEFAULT 1 CHECK (media_version > 0),
  format text NOT NULL DEFAULT 'gif' CHECK (format = 'gif'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exercise_media
  ADD COLUMN IF NOT EXISTS canonical_exercise_id text;

CREATE UNIQUE INDEX IF NOT EXISTS exercise_media_canonical_exercise_id_key
  ON public.exercise_media (canonical_exercise_id)
  WHERE canonical_exercise_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS exercise_media_provider_external_media_id_key
  ON public.exercise_media (provider, external_media_id);

ALTER TABLE public.exercise_media ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.exercise_media FROM PUBLIC;
REVOKE ALL ON TABLE public.exercise_media FROM anon;
REVOKE ALL ON TABLE public.exercise_media FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.exercise_media TO service_role;

-- service_role bypasses RLS. No table policy is needed, and retaining a policy
-- for a client role would make a later accidental grant dangerous.
DO $migration$
DECLARE policy_name text;
BEGIN
  FOR policy_name IN
    SELECT p.policyname FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'exercise_media'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.exercise_media', policy_name);
  END LOOP;
END
$migration$;

UPDATE storage.buckets SET public = false WHERE id = 'exercise-media';
DROP POLICY IF EXISTS "authenticated read exercise media objects" ON storage.objects;

DO $migration$
DECLARE privilege_name text;
DECLARE bad_count integer;
BEGIN
  FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.exercise_media', privilege_name) THEN
      RAISE EXCEPTION 'postcondition failed: anon has % on public.exercise_media', privilege_name;
    END IF;
    IF has_table_privilege('authenticated', 'public.exercise_media', privilege_name) THEN
      RAISE EXCEPTION 'postcondition failed: authenticated has % on public.exercise_media', privilege_name;
    END IF;
  END LOOP;
  FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.exercise_media', privilege_name) THEN
      RAISE EXCEPTION 'postcondition failed: service_role lacks % on public.exercise_media', privilege_name;
    END IF;
  END LOOP;
  IF NOT (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = 'service_role') THEN
    RAISE EXCEPTION 'postcondition failed: service_role does not bypass RLS';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'exercise-media') THEN
    RAISE EXCEPTION 'postcondition failed: exercise-media bucket is public';
  END IF;
  SELECT count(*) INTO bad_count
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'exercise_media';
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: public.exercise_media still has % policies', bad_count;
  END IF;
  WITH expected(policyname, cmd, roles, qual, with_check) AS (
    VALUES
      ('Avatar public read'::text, 'SELECT'::text, '{public}'::text,
       '(bucket_id = ''avatars''::text)'::text, NULL::text),
      ('Avatar upload for authenticated users', 'INSERT', '{authenticated}',
       NULL::text,
       '((bucket_id = ''avatars''::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))'),
      ('Avatar update for owner', 'UPDATE', '{authenticated}',
       '((bucket_id = ''avatars''::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))',
       NULL::text)
  ),
  actual AS (
    SELECT p.policyname::text, p.cmd::text, p.roles::text, p.qual::text, p.with_check::text
      FROM pg_policies p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ),
  policy_diff AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO bad_count FROM policy_diff;
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: client storage.objects policies differ from the exact avatar allowlist (% differences)', bad_count;
  END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
