-- NOT A MIGRATION. Read-only pre-apply check for
-- 20261127130000_engine_a_m2_columns.sql. One SELECT, no writes. Run in the
-- SQL Editor BEFORE the forward file. Every row must show PASS; the forward
-- file repeats the blocking checks in its precondition guard.
-- Draft v3 (approved). Rows 9 and 10 run the projection's building blocks and its known-answer
-- test inline on this server, before any M2 function exists.
WITH enc(k, s) AS (VALUES
  ('age', 'int:30'), ('gender', 'text:male'), ('goal', 'text:muscle_gain'),
  ('experience', 'text:beginner'), ('location', 'text:gym'), ('days_per_week', 'int:4'),
  ('session_duration', 'int:60'), ('equipment', 'text:full_gym'),
  ('equipment_extras', 'arr:1:[1:3]:4:band,4:band,11:door_anchor'),
  ('injuries', E'text:left knee \\ pain ''old'' \u00fc'),
  ('health_conditions', 'text:["none"]'), ('priority_muscle', 'null')),
kat AS (
  SELECT 'v1:' || encode(sha256(replace(d::text, E'\\', E'\\\\')::bytea), 'hex') AS rev
    FROM (SELECT ('{' || string_agg('"' || k || '":"'
                    || encode(sha256(replace(s, E'\\', E'\\\\')::bytea), 'hex') || '"', ',' ORDER BY k)
                  || '}')::jsonb AS d FROM enc) x)
SELECT item, detail, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM (VALUES
  (1, 'PostgreSQL >= 15, encoding UTF8, role postgres',
      current_setting('server_version') || ' ' || current_setting('server_encoding') || ' ' || current_user,
      current_setting('server_version_num')::int >= 150000
      AND current_setting('server_encoding') = 'UTF8' AND current_user = 'postgres'),
  (2, 'ledger latest state: M1 applied first; M2-M5 not applied',
      coalesce((SELECT string_agg(step || ':' || action, ',' ORDER BY step)
                  FROM (SELECT DISTINCT ON (step) step, action FROM public.engine_a_migration_events
                         ORDER BY step, id DESC) x), 'empty'),
      (SELECT step || ':' || action FROM public.engine_a_migration_events ORDER BY id LIMIT 1) = 'M1:applied'
      AND NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (step) step, action
                                       FROM public.engine_a_migration_events ORDER BY step, id DESC) x
                       WHERE x.step <> 'M1' AND x.action = 'applied')),
  (3, 'Engine A control off, admission disabled', 'engine_a_control',
      EXISTS (SELECT 1 FROM public.engine_a_control WHERE id = 1 AND state = 'off' AND NOT admission_enabled)),
  (4, 'no M2 column, function or index exists yet', 'profiles/workout_plans/workout_logs',
      NOT EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass,
                                        'public.workout_logs'::regclass) AND NOT a.attisdropped
                     AND a.attname IN ('planning_field_digests','planning_revision','plan_source',
                       'plan_schema_version','content_revision','schedule_revision','release_id',
                       'manifest_sha256','eligibility_id','attempt_digest','session_index'))
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                       AND proname IN ('engine_a_utf8','engine_a_planning_digests_v1',
                         'engine_a_planning_revision_v1','engine_a_valid_planning_digests',
                         'engine_a_plan_provenance_guard','engine_a_log_identity_guard',
                         'engine_a_table_catalog','engine_a_m2_problems',
                         'engine_a_set_planning_revision'))
      AND to_regclass('public.workout_plans_one_active_per_user') IS NULL),
  (5, 'the 12 projection columns have the hashed types', 'public.profiles',
      NOT EXISTS (SELECT 1 FROM (VALUES ('age','integer'), ('gender','text'), ('goal','text'),
                    ('experience','text'), ('location','text'), ('days_per_week','integer'),
                    ('session_duration','integer'), ('equipment','text'), ('equipment_extras','text[]'),
                    ('injuries','text'), ('health_conditions','text'), ('priority_muscle','text')) x(col, typ)
                   LEFT JOIN pg_attribute a ON a.attrelid = 'public.profiles'::regclass
                                           AND a.attname = x.col AND NOT a.attisdropped
                  WHERE format_type(a.atttypid, a.atttypmod) IS DISTINCT FROM x.typ)),
  (6, 'workout_plans_operation_valid is the expected 3-value CHECK', 'public.workout_plans',
      (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
        WHERE c.conrelid = 'public.workout_plans'::regclass AND c.conname = 'workout_plans_operation_valid')
      = 'CHECK (((operation IS NULL) OR (operation = ANY (ARRAY[''initial_setup''::text, ''feedback_adjustment''::text, ''safety_regeneration''::text]))))'),
  (7, 'user triggers are exactly the three profiles triggers, all enabled',
      coalesce((SELECT string_agg(c.relname || '.' || tg.tgname, ', ' ORDER BY c.relname || '.' || tg.tgname COLLATE "C")
                  FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                 WHERE NOT tg.tgisinternal
                   AND tg.tgrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass,
                                      'public.workout_logs'::regclass)), 'none'),
      (SELECT string_agg(c.relname || '.' || tg.tgname, ', ' ORDER BY c.relname || '.' || tg.tgname COLLATE "C")
         FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
        WHERE NOT tg.tgisinternal
          AND tg.tgrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass,
                             'public.workout_logs'::regclass))
      = 'profiles.trg_protect_onboarding_completed_latch, profiles.trg_protect_profile_billing, profiles.trg_set_profile_safety_fingerprint'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
                       AND NOT tgisinternal AND tgenabled <> 'O')),
  (8, 'owners with more than one active plan = 0',
      (SELECT count(*) FROM (SELECT user_id FROM public.workout_plans WHERE is_active IS TRUE
                              GROUP BY user_id HAVING count(*) > 1) d)::text,
      (SELECT count(*) FROM (SELECT user_id FROM public.workout_plans WHERE is_active IS TRUE
                              GROUP BY user_id HAVING count(*) > 1) d) = 0),
  (9, 'UTF-8 byte rule equals convert_to on hard strings', 'backslash, \x, octal, unicode, emoji',
      NOT EXISTS (SELECT 1 FROM (VALUES (E'abc'), (E'left knee \\ pain ''old'' \u00fc'), (E'\\x41'),
                                        (E'\\101'), (E'\\\\'), (''), (E'emoji \U0001F4AA \u4e2d'),
                                        (E'tab\tnl\n')) v(s)
                   WHERE replace(s, E'\\', E'\\\\')::bytea IS DISTINCT FROM convert_to(s, 'UTF8'))),
  (10, 'projection known-answer test', (SELECT rev FROM kat),
      (SELECT rev FROM kat) = 'v1:da09b4b05f09fd2fb4baae423a7529e6933513e01acc14b75d5524f82c463b12'),
  (12, 'live writers use READ COMMITTED (no database or role override to REPEATABLE READ or SERIALIZABLE)',
      current_setting('default_transaction_isolation') || '; overrides: '
      || coalesce((SELECT string_agg(coalesce(r.rolname, '(all roles)') || '=' || c, ', ')
                     FROM pg_db_role_setting s
                     LEFT JOIN pg_roles r ON r.oid = s.setrole
                     CROSS JOIN unnest(s.setconfig) c
                    WHERE c LIKE 'default_transaction_isolation=%'
                      AND (s.setdatabase = 0 OR s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))), 'none'),
      current_setting('default_transaction_isolation') = 'read committed'
      AND NOT EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN unnest(s.setconfig) c
                       WHERE c ~* '^default_transaction_isolation=(repeatable read|serializable)$'
                         AND (s.setdatabase = 0 OR s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())))),
  (11, 'row counts (information)',
      'profiles=' || (SELECT count(*) FROM public.profiles)
      || ' workout_plans=' || (SELECT count(*) FROM public.workout_plans)
      || ' workout_logs=' || (SELECT count(*) FROM public.workout_logs),
      true)
) v(n, item, detail, ok) ORDER BY n;
