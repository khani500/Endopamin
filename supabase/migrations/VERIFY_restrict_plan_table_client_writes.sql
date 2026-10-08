-- NOT A MIGRATION. Manual verification only; UNEXECUTED by this task.
-- Replace verify.uid with the UUID of test@endopamin.com before running.
-- Never use a real athlete. All fixtures, plan isolation and anchor changes
-- are transaction-local and discarded by the final ROLLBACK.
-- Run the whole file; failures raise VERIFY FAIL, successes print VERIFY PASS.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT set_config('verify.uid', '00000000-0000-0000-0000-000000000000', true);

DO $verify$
BEGIN
  IF current_setting('verify.uid')::uuid = '00000000-0000-0000-0000-000000000000'
     OR NOT EXISTS (SELECT 1 FROM auth.users
       WHERE id = current_setting('verify.uid')::uuid AND lower(email) = 'test@endopamin.com')
     OR NOT EXISTS (SELECT 1 FROM public.profiles
       WHERE id = current_setting('verify.uid')::uuid
         AND safety_fingerprint ~ '^v1:[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'VERIFY FAIL: use test@endopamin.com UUID with a valid safety profile';
  END IF;
  PERFORM 1 FROM auth.users WHERE id = current_setting('verify.uid')::uuid FOR UPDATE;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'VERIFY FAIL: start this script as postgres';
  END IF;
  RAISE NOTICE 'VERIFY PASS: sacrificial identity, profile and operator';
END
$verify$;

DO $guard$
DECLARE
  t record;
  actual jsonb;
  expected jsonb;
  expected_policies text[];
BEGIN
  FOR t IN SELECT * FROM (VALUES ('workout_plans'), ('nutrition_plans')) v(name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || t.name)
        AND c.relkind = 'r' AND c.relowner = 'postgres'::regrole
        AND c.relrowsecurity AND NOT c.relforcerowsecurity
    ) OR EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || t.name) AND NOT tgisinternal
    ) OR EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t.name) AND attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration B VERIFY failed: owner/RLS/triggers/column ACLs for %', t.name;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_array(a.grantee, a.privilege_type, a.is_grantable)
                            ORDER BY a.grantee, a.privilege_type), '[]'::jsonb)
      INTO actual FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid = to_regclass('public.' || t.name);
    SELECT jsonb_agg(jsonb_build_array(r.oid, v.privilege, v.grantable)
                     ORDER BY r.oid, v.privilege)
      INTO expected FROM (VALUES
        ('workout_plans', 'authenticated', 'SELECT', false),
        ('workout_plans', 'service_role', 'DELETE', false),
        ('workout_plans', 'service_role', 'INSERT', false),
        ('workout_plans', 'service_role', 'MAINTAIN', false),
        ('workout_plans', 'service_role', 'REFERENCES', false),
        ('workout_plans', 'service_role', 'SELECT', false),
        ('workout_plans', 'service_role', 'TRIGGER', false),
        ('workout_plans', 'service_role', 'TRUNCATE', false),
        ('workout_plans', 'service_role', 'UPDATE', false),
        ('workout_plans', 'postgres', 'DELETE', false),
        ('workout_plans', 'postgres', 'INSERT', false),
        ('workout_plans', 'postgres', 'MAINTAIN', false),
        ('workout_plans', 'postgres', 'REFERENCES', false),
        ('workout_plans', 'postgres', 'SELECT', false),
        ('workout_plans', 'postgres', 'TRIGGER', false),
        ('workout_plans', 'postgres', 'TRUNCATE', false),
        ('workout_plans', 'postgres', 'UPDATE', false),
        ('nutrition_plans', 'authenticated', 'DELETE', false),
        ('nutrition_plans', 'authenticated', 'INSERT', false),
        ('nutrition_plans', 'authenticated', 'SELECT', false),
        ('nutrition_plans', 'authenticated', 'UPDATE', false),
        ('nutrition_plans', 'service_role', 'DELETE', false),
        ('nutrition_plans', 'service_role', 'INSERT', false),
        ('nutrition_plans', 'service_role', 'MAINTAIN', false),
        ('nutrition_plans', 'service_role', 'REFERENCES', false),
        ('nutrition_plans', 'service_role', 'SELECT', false),
        ('nutrition_plans', 'service_role', 'TRIGGER', false),
        ('nutrition_plans', 'service_role', 'TRUNCATE', false),
        ('nutrition_plans', 'service_role', 'UPDATE', false),
        ('nutrition_plans', 'postgres', 'DELETE', false),
        ('nutrition_plans', 'postgres', 'INSERT', false),
        ('nutrition_plans', 'postgres', 'MAINTAIN', false),
        ('nutrition_plans', 'postgres', 'REFERENCES', false),
        ('nutrition_plans', 'postgres', 'SELECT', false),
        ('nutrition_plans', 'postgres', 'TRIGGER', false),
        ('nutrition_plans', 'postgres', 'TRUNCATE', false),
        ('nutrition_plans', 'postgres', 'UPDATE', false)
      ) v(tbl, role_name, privilege, grantable)
      JOIN pg_roles r ON r.rolname = v.role_name WHERE v.tbl = t.name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'migration B VERIFY failed: exact ACL for %', t.name;
    END IF;
    expected_policies := CASE WHEN t.name = 'workout_plans'
      THEN ARRAY['Users can read own workout plans:r']
      ELSE ARRAY['Users can read own nutrition plans:r', 'Users manage own nutrition plans:*'] END;
    IF (SELECT array_agg(polname::text || ':' || polcmd::text ORDER BY polname)
        FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name))
          IS DISTINCT FROM expected_policies
       OR EXISTS (
         SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name)
           AND (NOT polpermissive OR polroles IS DISTINCT FROM ARRAY[0::oid]
                OR pg_get_expr(polqual, polrelid) IS DISTINCT FROM '(auth.uid() = user_id)'
                OR polwithcheck IS NOT NULL)
       ) THEN
      RAISE EXCEPTION 'migration B VERIFY failed: exact policies for %', t.name;
    END IF;
  END LOOP;
  RAISE NOTICE 'migration B VERIFY PASS: exact ACLs, policies, owners, RLS and empty column ACLs';
END
$guard$;

DO $verify$
DECLARE
  tbl text;
  role_name text;
  priv text;
  wanted boolean;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['workout_plans', 'nutrition_plans'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                  'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
        wanted := role_name = 'authenticated' AND
          (priv = 'SELECT' OR (tbl = 'nutrition_plans' AND priv IN ('INSERT', 'UPDATE', 'DELETE')));
        IF has_table_privilege(role_name, 'public.' || tbl, priv) IS DISTINCT FROM wanted THEN
          RAISE EXCEPTION 'VERIFY FAIL: table privilege %.% %', role_name, tbl, priv;
        END IF;
        IF priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
           AND has_any_column_privilege(role_name, 'public.' || tbl, priv) IS DISTINCT FROM wanted THEN
          RAISE EXCEPTION 'VERIFY FAIL: column privilege %.% %', role_name, tbl, priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'VERIFY PASS: exact effective anon/authenticated table and column privileges';
END
$verify$;

-- Isolate the sacrificial user's pre-existing workouts without deleting them.
UPDATE public.workout_plans SET user_id = NULL
 WHERE user_id = current_setting('verify.uid')::uuid;
SELECT set_config('verify.workout', gen_random_uuid()::text, true);
SELECT set_config('verify.hidden', gen_random_uuid()::text, true);
SELECT set_config('verify.other', gen_random_uuid()::text, true);
SELECT set_config('verify.nutrition', gen_random_uuid()::text, true);
DO $verify$
DECLARE
  other_uid uuid;
BEGIN
  SELECT id INTO other_uid FROM auth.users
   WHERE id <> current_setting('verify.uid')::uuid ORDER BY id LIMIT 1;
  IF other_uid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: another auth user is required for the foreign-row visibility fixture';
  END IF;
  INSERT INTO public.workout_plans (id, user_id, coach_id, plan_data, is_active)
  VALUES
    (current_setting('verify.workout')::uuid, current_setting('verify.uid')::uuid, 'aria', '{}'::jsonb, false),
    (current_setting('verify.hidden')::uuid, NULL, 'aria', '{}'::jsonb, false),
    (current_setting('verify.other')::uuid, other_uid, 'aria', '{}'::jsonb, false);
  INSERT INTO public.nutrition_plans (id, user_id, plan_data, is_active)
  VALUES (current_setting('verify.nutrition')::uuid, current_setting('verify.uid')::uuid, '{}'::jsonb, false);
  RAISE NOTICE 'VERIFY PASS: postgres seeded valid own, other and NULL-owner rows';
END
$verify$;

SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('verify.uid'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $verify$
DECLARE
  stmt text;
  state text;
  n integer;
  inserted uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS DISTINCT FROM current_setting('verify.uid')::uuid THEN
    RAISE EXCEPTION 'VERIFY FAIL: authenticated JWT identity not simulated';
  END IF;
  FOREACH stmt IN ARRAY ARRAY[
    'INSERT INTO public.workout_plans (user_id, coach_id, plan_data) VALUES '
      || '(current_setting(''verify.uid'')::uuid, ''aria'', ''{}''::jsonb)',
    'UPDATE public.workout_plans SET coach_id = ''kane'' WHERE id = current_setting(''verify.workout'')::uuid',
    'DELETE FROM public.workout_plans WHERE id = current_setting(''verify.workout'')::uuid',
    'TRUNCATE public.nutrition_plans'
  ] LOOP
    state := NULL;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE;
    END;
    IF state IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'VERIFY FAIL: refused write got % instead of 42501: %', COALESCE(state, 'success'), stmt;
    END IF;
    RAISE NOTICE 'VERIFY PASS: 42501 for %', stmt;
  END LOOP;
  SELECT count(*) INTO n FROM public.workout_plans
   WHERE id = current_setting('verify.workout')::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAIL: own workout not visible'; END IF;
  SELECT count(*) INTO n FROM public.workout_plans
   WHERE id IN (current_setting('verify.hidden')::uuid, current_setting('verify.other')::uuid);
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAIL: other/NULL-owner workout visible'; END IF;
  PERFORM * FROM public.get_active_plan_safety_status();
  RAISE NOTICE 'VERIFY PASS: own workout visible, other/NULL rows hidden, safety-status function runs';

  SELECT count(*) INTO n FROM public.nutrition_plans
   WHERE id = current_setting('verify.nutrition')::uuid;
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAIL: own nutrition not visible'; END IF;
  INSERT INTO public.nutrition_plans (id, user_id, plan_data, is_active)
  VALUES (inserted, current_setting('verify.uid')::uuid, '{}'::jsonb, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAIL: nutrition INSERT count %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nutrition_plans WHERE id = inserted) THEN
    RAISE EXCEPTION 'VERIFY FAIL: inserted nutrition not visible';
  END IF;
  UPDATE public.nutrition_plans SET plan_data = '{"verify":"B"}'::jsonb WHERE id = inserted;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAIL: nutrition UPDATE count %', n; END IF;
  DELETE FROM public.nutrition_plans WHERE id = inserted;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAIL: nutrition DELETE count %', n; END IF;
  RAISE NOTICE 'VERIFY PASS: nutrition own SELECT/INSERT/UPDATE/DELETE, exactly one row per write';
END
$verify$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $verify$
DECLARE
  tbl text;
  state text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['workout_plans', 'nutrition_plans'] LOOP
    state := NULL;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', tbl);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE;
    END;
    IF state IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'VERIFY FAIL: anon SELECT on % got %', tbl, COALESCE(state, 'success');
    END IF;
    RAISE NOTICE 'VERIFY PASS: anon SELECT on % refused with 42501', tbl;
  END LOOP;
END
$verify$;
RESET ROLE;

-- Remove only this transaction's own fixture before a fresh initial_setup RPC.
DELETE FROM public.workout_plans WHERE id = current_setting('verify.workout')::uuid;
UPDATE public.profiles SET first_plan_at = NULL, last_plan_adjustment_at = NULL
 WHERE id = current_setting('verify.uid')::uuid;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
DO $verify$
DECLARE
  result record;
  n integer;
BEGIN
  SELECT * INTO STRICT result FROM public.replace_user_plans_atomic(
    p_user_id := current_setting('verify.uid')::uuid,
    p_client_attempt_id := gen_random_uuid(),
    p_workout_coach_id := 'aria',
    p_workout_plan_type := 'weekly',
    p_workout_week_start := date '2026-10-05',
    p_workout_week_number := 1,
    p_workout_activate_on := NULL,
    p_workout_plan_data := '{"verify":"migration B","days":[]}'::jsonb,
    p_nutrition_plan_data := '{"verify":"migration B"}'::jsonb,
    p_expected_safety_fingerprint := (SELECT safety_fingerprint FROM public.profiles
      WHERE id = current_setting('verify.uid')::uuid),
    p_operation := 'initial_setup'
  );
  IF result.workout_plan_id IS NULL OR result.nutrition_plan_id IS NULL
     OR result.replayed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VERIFY FAIL: service_role fresh RPC did not save both plans';
  END IF;
  DELETE FROM public.workout_plans WHERE id = result.workout_plan_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAIL: service_role workout DELETE count %', n; END IF;
  DELETE FROM public.nutrition_plans WHERE id = result.nutrition_plan_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAIL: service_role nutrition DELETE count %', n; END IF;
  RAISE NOTICE 'VERIFY PASS: service_role RPC saves both plans and DELETE affects one row on each';
END
$verify$;
RESET ROLE;

DO $guard$
DECLARE
  t record;
  actual jsonb;
  expected jsonb;
  expected_policies text[];
BEGIN
  FOR t IN SELECT * FROM (VALUES ('workout_plans'), ('nutrition_plans')) v(name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || t.name)
        AND c.relkind = 'r' AND c.relowner = 'postgres'::regrole
        AND c.relrowsecurity AND NOT c.relforcerowsecurity
    ) OR EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || t.name) AND NOT tgisinternal
    ) OR EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t.name) AND attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration B VERIFY failed: owner/RLS/triggers/column ACLs for %', t.name;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_array(a.grantee, a.privilege_type, a.is_grantable)
                            ORDER BY a.grantee, a.privilege_type), '[]'::jsonb)
      INTO actual FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid = to_regclass('public.' || t.name);
    SELECT jsonb_agg(jsonb_build_array(r.oid, v.privilege, v.grantable)
                     ORDER BY r.oid, v.privilege)
      INTO expected FROM (VALUES
        ('workout_plans', 'authenticated', 'SELECT', false),
        ('workout_plans', 'service_role', 'DELETE', false),
        ('workout_plans', 'service_role', 'INSERT', false),
        ('workout_plans', 'service_role', 'MAINTAIN', false),
        ('workout_plans', 'service_role', 'REFERENCES', false),
        ('workout_plans', 'service_role', 'SELECT', false),
        ('workout_plans', 'service_role', 'TRIGGER', false),
        ('workout_plans', 'service_role', 'TRUNCATE', false),
        ('workout_plans', 'service_role', 'UPDATE', false),
        ('workout_plans', 'postgres', 'DELETE', false),
        ('workout_plans', 'postgres', 'INSERT', false),
        ('workout_plans', 'postgres', 'MAINTAIN', false),
        ('workout_plans', 'postgres', 'REFERENCES', false),
        ('workout_plans', 'postgres', 'SELECT', false),
        ('workout_plans', 'postgres', 'TRIGGER', false),
        ('workout_plans', 'postgres', 'TRUNCATE', false),
        ('workout_plans', 'postgres', 'UPDATE', false),
        ('nutrition_plans', 'authenticated', 'DELETE', false),
        ('nutrition_plans', 'authenticated', 'INSERT', false),
        ('nutrition_plans', 'authenticated', 'SELECT', false),
        ('nutrition_plans', 'authenticated', 'UPDATE', false),
        ('nutrition_plans', 'service_role', 'DELETE', false),
        ('nutrition_plans', 'service_role', 'INSERT', false),
        ('nutrition_plans', 'service_role', 'MAINTAIN', false),
        ('nutrition_plans', 'service_role', 'REFERENCES', false),
        ('nutrition_plans', 'service_role', 'SELECT', false),
        ('nutrition_plans', 'service_role', 'TRIGGER', false),
        ('nutrition_plans', 'service_role', 'TRUNCATE', false),
        ('nutrition_plans', 'service_role', 'UPDATE', false),
        ('nutrition_plans', 'postgres', 'DELETE', false),
        ('nutrition_plans', 'postgres', 'INSERT', false),
        ('nutrition_plans', 'postgres', 'MAINTAIN', false),
        ('nutrition_plans', 'postgres', 'REFERENCES', false),
        ('nutrition_plans', 'postgres', 'SELECT', false),
        ('nutrition_plans', 'postgres', 'TRIGGER', false),
        ('nutrition_plans', 'postgres', 'TRUNCATE', false),
        ('nutrition_plans', 'postgres', 'UPDATE', false)
      ) v(tbl, role_name, privilege, grantable)
      JOIN pg_roles r ON r.rolname = v.role_name WHERE v.tbl = t.name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'migration B VERIFY failed: exact ACL for %', t.name;
    END IF;
    expected_policies := CASE WHEN t.name = 'workout_plans'
      THEN ARRAY['Users can read own workout plans:r']
      ELSE ARRAY['Users can read own nutrition plans:r', 'Users manage own nutrition plans:*'] END;
    IF (SELECT array_agg(polname::text || ':' || polcmd::text ORDER BY polname)
        FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name))
          IS DISTINCT FROM expected_policies
       OR EXISTS (
         SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name)
           AND (NOT polpermissive OR polroles IS DISTINCT FROM ARRAY[0::oid]
                OR pg_get_expr(polqual, polrelid) IS DISTINCT FROM '(auth.uid() = user_id)'
                OR polwithcheck IS NOT NULL)
       ) THEN
      RAISE EXCEPTION 'migration B VERIFY failed: exact policies for %', t.name;
    END IF;
  END LOOP;
  RAISE NOTICE 'migration B VERIFY PASS: exact ACLs, policies, owners, RLS and empty column ACLs';
END
$guard$;

ROLLBACK;
