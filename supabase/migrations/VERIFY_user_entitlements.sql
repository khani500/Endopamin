-- NOT A MIGRATION. Read-only verification. Do not apply with
-- supabase db push / migration up. The filename has no timestamp on purpose.
--
-- Run only AFTER 20261001120000_user_entitlements.sql has been applied.
-- One SELECT, no writes, nothing to roll back. It is a single statement so
-- the SQL Editor shows every row in one result.
--
-- What it prints, one row per fact:
--   table       the table exists
--   rls         row level security flag
--   column      each column: type, nullability, default
--   constraint  primary key, foreign key and CHECK definitions
--   policy      each policy: command, roles, USING expression
--   grant       each privilege held by anon / authenticated / service_role
--
-- Expected: 13 columns; rls enabled = true; one policy
-- user_entitlements_select_own (SELECT, {authenticated}); no grant row for
-- anon; exactly one grant row for authenticated (SELECT).

SELECT section, item, detail
  FROM (
    SELECT 1 AS ord, 0 AS pos, 'table' AS section,
           'public.user_entitlements' AS item,
           CASE WHEN to_regclass('public.user_entitlements') IS NULL
                THEN 'MISSING' ELSE 'exists' END AS detail

    UNION ALL
    SELECT 2, 0, 'rls', c.relname::text,
           'enabled = ' || c.relrowsecurity::text || ', forced = ' || c.relforcerowsecurity::text
      FROM pg_class c
     WHERE c.oid = to_regclass('public.user_entitlements')

    UNION ALL
    SELECT 3, a.attnum::int, 'column', a.attname::text,
           format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END
           || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = to_regclass('public.user_entitlements')
       AND a.attnum > 0
       AND NOT a.attisdropped

    UNION ALL
    SELECT 4, 0, 'constraint', con.conname::text, pg_get_constraintdef(con.oid)
      FROM pg_constraint con
     WHERE con.conrelid = to_regclass('public.user_entitlements')

    UNION ALL
    SELECT 5, 0, 'policy', p.policyname::text,
           p.cmd || ' TO ' || p.roles::text || ' USING ' || coalesce(p.qual, '(none)')
           || ' WITH CHECK ' || coalesce(p.with_check, '(none)')
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = 'user_entitlements'

    UNION ALL
    SELECT 6, 0, 'grant', g.grantee::text, g.privilege_type::text
      FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public'
       AND g.table_name = 'user_entitlements'
       AND g.grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
  ) AS report
 ORDER BY ord, pos, item, detail;
