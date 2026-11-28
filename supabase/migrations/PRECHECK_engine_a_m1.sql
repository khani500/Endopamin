-- NOT A MIGRATION. Read-only pre-apply check for
-- 20261127120000_engine_a_m1_tables.sql (Codex condition 1). One SELECT,
-- no writes. Run in the SQL Editor BEFORE the forward file, as the same
-- role that will run it. Every row must show PASS; the forward file's own
-- precondition guard repeats the blocking checks.
SELECT item, detail, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM (VALUES
  (1, 'PostgreSQL major version >= 15', current_setting('server_version'),
      current_setting('server_version_num')::int >= 150000),
  (2, 'SQL Editor role', current_user || ' (session ' || session_user || ')',
      current_user = 'postgres'),
  (3, 'auth.users.id is uuid',
      coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute
                 WHERE attrelid = to_regclass('auth.users') AND attname = 'id'), 'missing'),
      (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
        WHERE attrelid = to_regclass('auth.users') AND attname = 'id') = 'uuid'),
  (4, 'REFERENCES on auth.users for current role', current_user,
      coalesce(has_table_privilege(current_user, 'auth.users', 'REFERENCES'), false)),
  (5, 'auth.uid() exists and authenticated can call it', 'auth.uid()',
      to_regprocedure('auth.uid()') IS NOT NULL
      AND has_schema_privilege('authenticated', 'auth', 'USAGE')
      AND has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE')),
  (6, 'service_role bypasses RLS', 'service_role',
      coalesce((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'), false)),
  (7, 'no M1 object exists yet', 'engine_a_* / exercise_personal_records',
      NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
                   AND (relname LIKE 'engine\_a\_%' OR relname = 'exercise_personal_records'))
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                       AND proname LIKE 'engine\_a\_%')
      AND to_regtype('public.engine_a_code') IS NULL),
  (8, 'workout_plans.id is uuid (needed by M2 foreign keys)',
      coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute
                 WHERE attrelid = to_regclass('public.workout_plans') AND attname = 'id'), 'missing'),
      (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
        WHERE attrelid = to_regclass('public.workout_plans') AND attname = 'id') = 'uuid')
) v(n, item, detail, ok) ORDER BY n;
