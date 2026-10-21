-- READ-ONLY VERIFICATION. Run after the D3 migration and generated seed.
-- Expected highlights: bucket private; table RLS enabled; anon/authenticated
-- have no table privileges; service_role has SELECT/INSERT/UPDATE/DELETE;
-- service_role has rolbypassrls; no exercise_media table policies; the exact
-- client-facing storage policy set is the three known avatar policies;
-- 220 active rows, canonical IDs and vendor IDs all distinct, zero bad paths.
-- This catalog verification is not a substitute for the runbook's service-role
-- table CRUD and private-storage list/sign/download API smoke tests.

SELECT section, item, detail
  FROM (
    SELECT 1 AS ord, 'bucket'::text AS section, b.id::text AS item,
           'public=' || b.public::text AS detail
      FROM storage.buckets b WHERE b.id = 'exercise-media'

    UNION ALL
    SELECT 2, 'rls', 'public.exercise_media',
           'enabled=' || c.relrowsecurity::text || ', forced=' || c.relforcerowsecurity::text
      FROM pg_class c WHERE c.oid = to_regclass('public.exercise_media')

    UNION ALL
    SELECT 3, 'service_role', 'rolbypassrls', r.rolbypassrls::text
      FROM pg_roles r WHERE r.rolname = 'service_role'

    UNION ALL
    SELECT 4, 'grant', g.grantee::text, g.privilege_type::text
      FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public' AND g.table_name = 'exercise_media'
       AND g.grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')

    UNION ALL
    SELECT 5, 'table_policy', p.policyname::text,
           p.cmd || ' TO ' || p.roles::text || ' USING ' || coalesce(p.qual, '(none)')
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'exercise_media'

    UNION ALL
    SELECT 6, 'storage_policy', p.policyname::text,
           p.cmd || ' TO ' || p.roles::text || ' USING ' || coalesce(p.qual, '(none)')
           || ' WITH CHECK ' || coalesce(p.with_check, '(none)')
      FROM pg_policies p
     WHERE p.schemaname = 'storage' AND p.tablename = 'objects'

    UNION ALL
    SELECT 7, 'storage_policy_closure', 'exact_avatar_allowlist', count(*)::text
      FROM (
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
        )
        (SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      ) policy_diff

    UNION ALL
    SELECT 8, 'row_count', metric, value::text
      FROM (
        SELECT 'active'::text AS metric, count(*)::bigint AS value FROM public.exercise_media WHERE active
        UNION ALL SELECT 'active_distinct_canonical', count(DISTINCT canonical_exercise_id) FROM public.exercise_media WHERE active
        UNION ALL SELECT 'active_distinct_external', count(DISTINCT (provider, external_media_id)) FROM public.exercise_media WHERE active
        UNION ALL SELECT 'active_null_canonical', count(*) FROM public.exercise_media WHERE active AND canonical_exercise_id IS NULL
        UNION ALL SELECT 'bad_path', count(*) FROM public.exercise_media
          WHERE active AND (animation_path <> 'V1/' || provider || '/' || external_media_id || '/' || external_media_id || '-360.gif'
                         OR thumbnail_path <> 'V1/' || provider || '/' || external_media_id || '/' || external_media_id || '-180.gif')
      ) counts

    UNION ALL
    SELECT 9, 'client_access', role_name || ':' || privilege_name,
           has_table_privilege(role_name, 'public.exercise_media', privilege_name)::text
      FROM unnest(ARRAY['anon', 'authenticated']) role_name
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name

    UNION ALL
    SELECT 10, 'service_role_table_capability', privilege_name,
           has_table_privilege('service_role', 'public.exercise_media', privilege_name)::text
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name

    UNION ALL
    SELECT 11, 'service_role_storage_capability', privilege_name,
           has_table_privilege('service_role', 'storage.objects', privilege_name)::text
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name
  ) evidence
 ORDER BY ord, section, item, detail;
