-- SUPERSEDED after 20261002120000_plan_operation_cooldown.sql (migration C)
-- is applied: use VERIFY_plan_operation_cooldown.sql instead. Step 3 below
-- expects the ten-argument RPC with migration A's body and fails against
-- migration C's eleven-argument function. Steps 6-9 call the RPC without
-- p_operation (legacy path), which migration C still accepts.
--
-- NOT A MIGRATION. Scratch verification only. Do not apply with
-- supabase db push / migration up. The filename has no timestamp on
-- purpose. Do not run this from the task that authored it.
--
-- Run only AFTER 20260928140000_profile_safety_fingerprint.sql has been
-- applied. One transaction that always ends in ROLLBACK.
--
-- What this block shows, then undoes:
--   1. profile_safety_fingerprint on literals only (no reads, no writes):
--      extras order and duplicates do not matter; NULL extras differ from an
--      empty array; NULL injuries differ from ''; each of the five inputs
--      alone changes the result; the format is ^v1:[0-9a-f]{64}$.
--   2. Every profile has a valid fingerprint equal to its recomputation.
--      Plans saved before the migration are still NULL.
--   3. replace_user_plans_atomic: the only function of that name, the
--      ten-argument contract (M4 plus p_expected_safety_fingerprint DEFAULT
--      NULL), owner and grants as M4, this migration's body.
--      get_active_plan_safety_status: contract and grants.
--   4. As the sacrificial athlete (authenticated JWT), an UPDATE of
--      last_feedback_week succeeds and leaves safety_fingerprint unchanged.
--   5. As the migration role, changing one safety field changes the
--      fingerprint, and a forged valid-looking value is overwritten.
--   6. RPC with a token equal to the profile fingerprint: the new plan
--      carries that fingerprint; the athlete's gate says valid.
--   7. RPC with a different valid-format token: error 45413, and no
--      workout_plans row inserted or archived.
--   8. A safety field change makes the athlete's gate say stale.
--   9. RPC with a NULL token: the new plan has a NULL fingerprint; the gate
--      says unverified.
--  10. A second active row (inserted as the migration role): the gate says
--      invalid_multiple_active_plans.
--  11. All rows deactivated (as the migration role): the gate says
--      no_active_plan.
--  12. No JWT: the gate says profile_unavailable. anon cannot execute it.
--  13. ROLLBACK so no production row remains.
--
-- Before running: replace the uuid in set_config('verify.uid', ...) with a
-- sacrificial public.profiles.id you control. Never use a real athlete.
-- Steps 6-11 archive that user's active workout plans and insert plans
-- inside this transaction; the ROLLBACK undoes all of it.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------------
-- Operator input. This is the only line you should edit.
-- ------------------------------------------------------------------
SELECT set_config(
  'verify.uid',
  '00000000-0000-0000-0000-000000000000',
  true
);

-- Fail closed if the placeholder was left in place or the row is missing.
DO $verify$
DECLARE
  v_uid uuid := current_setting('verify.uid')::uuid;
BEGIN
  IF v_uid = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION
      'VERIFY: replace verify.uid with a sacrificial profiles.id you control';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION
      'VERIFY: no public.profiles row for %', v_uid;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    RAISE EXCEPTION
      'VERIFY: no auth.users row for %', v_uid;
  END IF;
END
$verify$;

-- ------------------------------------------------------------------
-- 1. Pure function, literals only.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  fmt  CONSTANT text := '^v1:[0-9a-f]{64}$';
  base text := public.profile_safety_fingerprint(
    'home', ARRAY['bands', 'pullup_bar'], 'beginner', '["asthma"]', 'knee');
BEGIN
  IF base !~ fmt THEN
    RAISE EXCEPTION 'VERIFY FAIL: base fingerprint % does not match %', base, fmt;
  END IF;

  IF public.profile_safety_fingerprint(NULL, NULL, NULL, NULL, NULL) !~ fmt THEN
    RAISE EXCEPTION 'VERIFY FAIL: all-NULL fingerprint does not match %', fmt;
  END IF;

  IF base IS DISTINCT FROM public.profile_safety_fingerprint(
       'home', ARRAY['bands', 'pullup_bar'], 'beginner', '["asthma"]', 'knee') THEN
    RAISE EXCEPTION 'VERIFY FAIL: same inputs gave two different fingerprints';
  END IF;

  -- Extras: order and duplicates do not matter.
  IF base IS DISTINCT FROM public.profile_safety_fingerprint(
       'home', ARRAY['pullup_bar', 'bands', 'pullup_bar', 'bands'], 'beginner', '["asthma"]', 'knee') THEN
    RAISE EXCEPTION 'VERIFY FAIL: extras in another order or with duplicates changed the fingerprint';
  END IF;

  -- Extras: NULL is not the empty array.
  IF public.profile_safety_fingerprint('home', NULL, 'beginner', '["asthma"]', 'knee')
     = public.profile_safety_fingerprint('home', '{}'::text[], 'beginner', '["asthma"]', 'knee') THEN
    RAISE EXCEPTION 'VERIFY FAIL: NULL extras and an empty extras array gave the same fingerprint';
  END IF;

  -- Injuries: NULL is not ''.
  IF public.profile_safety_fingerprint('home', ARRAY['bands'], 'beginner', '["asthma"]', NULL)
     = public.profile_safety_fingerprint('home', ARRAY['bands'], 'beginner', '["asthma"]', '') THEN
    RAISE EXCEPTION 'VERIFY FAIL: NULL injuries and empty injuries gave the same fingerprint';
  END IF;

  -- No trim.
  IF base = public.profile_safety_fingerprint(
       'home', ARRAY['bands', 'pullup_bar'], 'beginner', '["asthma"]', 'knee ') THEN
    RAISE EXCEPTION 'VERIFY FAIL: a trailing space in injuries did not change the fingerprint';
  END IF;

  -- Each of the five inputs alone changes the result.
  IF base = public.profile_safety_fingerprint(
       'gym', ARRAY['bands', 'pullup_bar'], 'beginner', '["asthma"]', 'knee') THEN
    RAISE EXCEPTION 'VERIFY FAIL: changing equipment alone did not change the fingerprint';
  END IF;
  IF base = public.profile_safety_fingerprint(
       'home', ARRAY['bands'], 'beginner', '["asthma"]', 'knee') THEN
    RAISE EXCEPTION 'VERIFY FAIL: changing equipment_extras alone did not change the fingerprint';
  END IF;
  IF base = public.profile_safety_fingerprint(
       'home', ARRAY['bands', 'pullup_bar'], 'advanced', '["asthma"]', 'knee') THEN
    RAISE EXCEPTION 'VERIFY FAIL: changing experience alone did not change the fingerprint';
  END IF;
  IF base = public.profile_safety_fingerprint(
       'home', ARRAY['bands', 'pullup_bar'], 'beginner', '["asthma", "hypertension"]', 'knee') THEN
    RAISE EXCEPTION 'VERIFY FAIL: changing health_conditions alone did not change the fingerprint';
  END IF;
  IF base = public.profile_safety_fingerprint(
       'home', ARRAY['bands', 'pullup_bar'], 'beginner', '["asthma"]', 'shoulder') THEN
    RAISE EXCEPTION 'VERIFY FAIL: changing injuries alone did not change the fingerprint';
  END IF;

  RAISE NOTICE 'VERIFY PASS 1: pure-function properties hold (base %)', base;
END
$verify$;

-- ------------------------------------------------------------------
-- 2. Stored data.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  n_bad      bigint;
  n_profiles bigint;
  n_old      bigint;
  n_old_set  bigint;
  n_set      bigint;
  n_set_bad  bigint;
BEGIN
  SELECT count(*) INTO n_profiles FROM public.profiles;

  SELECT count(*) INTO n_bad
    FROM public.profiles p
   WHERE p.safety_fingerprint IS NULL
      OR p.safety_fingerprint !~ '^v1:[0-9a-f]{64}$'
      OR p.safety_fingerprint IS DISTINCT FROM public.profile_safety_fingerprint(
           p.equipment, p.equipment_extras, p.experience,
           p.health_conditions, p.injuries);
  IF n_bad <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: % of % profiles lack a valid fingerprint equal to their recomputation',
      n_bad, n_profiles;
  END IF;

  -- The apply time of the migration is not recorded anywhere, so its
  -- authored date is the cutoff: no plan saved before 2026-09-28 can carry
  -- a fingerprint. generated_at is database-owned (default now()); a NULL
  -- generated_at is legacy and is treated as before.
  SELECT count(*),
         count(*) FILTER (WHERE w.safety_fingerprint IS NOT NULL)
    INTO n_old, n_old_set
    FROM public.workout_plans w
   WHERE w.generated_at IS NULL
      OR w.generated_at < timestamptz '2026-09-28 00:00:00+00';
  IF n_old_set <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: % of % pre-migration workout_plans rows carry a fingerprint',
      n_old_set, n_old;
  END IF;

  -- Any fingerprinted plan came through the RPC, which always sets an attempt id.
  SELECT count(*),
         count(*) FILTER (WHERE w.client_attempt_id IS NULL
                             OR w.safety_fingerprint !~ '^v1:[0-9a-f]{64}$')
    INTO n_set, n_set_bad
    FROM public.workout_plans w
   WHERE w.safety_fingerprint IS NOT NULL;
  IF n_set_bad <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: % fingerprinted workout_plans rows lack an attempt id or a valid format',
      n_set_bad;
  END IF;

  RAISE NOTICE 'VERIFY PASS 2: % profiles valid; % pre-migration plans all NULL; % plans fingerprinted since',
    n_profiles, n_old, n_set;
END
$verify$;

-- ------------------------------------------------------------------
-- 3. Catalog: the RPC's ten-argument contract, and the gate.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  rpc_oid oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');
  gate_oid oid := to_regprocedure('public.get_active_plan_safety_status()');
  fn record;
  n  integer;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: replace_user_plans_atomic is absent, overloaded (% found), or not the ten-argument function', n;
  END IF;

  SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.pronargs,
         p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM
       'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
       || 'p_workout_plan_type text, p_workout_week_start date, '
       || 'p_workout_week_number integer, p_workout_activate_on date, '
       || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb, '
       || 'p_expected_safety_fingerprint text' THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC identity arguments are %', pg_get_function_identity_arguments(rpc_oid);
  END IF;
  IF pg_get_function_result(rpc_oid) IS DISTINCT FROM
       'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)' THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC result is %', pg_get_function_result(rpc_oid);
  END IF;
  IF fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' OR NOT fn.prosecdef
     OR fn.provolatile <> 'v' OR NOT fn.proretset
     OR fn.pronargs <> 10 OR fn.pronargdefaults <> 2
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC language, security, volatility, arity, search_path or owner differ from the contract';
  END IF;

  IF md5(fn.prosrc) IS DISTINCT FROM 'a88fc6c9fa02ab37fd2390ccacde264a' THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC body md5 is %, expected migration A''s body', md5(fn.prosrc);
  END IF;

  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid AND a.grantee = 0;
  IF n <> 0
     OR has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC EXECUTE privileges differ from M4';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid
     AND a.grantee NOT IN (fn.proowner, 'service_role'::regrole::oid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: % unexpected grantee(s) on the RPC', n;
  END IF;

  -- The gate.
  IF gate_oid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: get_active_plan_safety_status() is absent';
  END IF;
  SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.pronargs,
         p.proconfig, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = gate_oid;
  IF pg_get_function_result(gate_oid) IS DISTINCT FROM 'TABLE(status text, plan_id uuid)'
     OR fn.pronargs <> 0 OR fn.lanname <> 'sql' OR fn.provolatile <> 's'
     OR fn.prosecdef OR NOT fn.proretset
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'VERIFY FAIL: get_active_plan_safety_status contract differs';
  END IF;
  IF has_function_privilege('anon', gate_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', gate_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAIL: get_active_plan_safety_status grants differ (anon must not, authenticated must)';
  END IF;

  RAISE NOTICE 'VERIFY PASS 3: RPC is the single ten-argument function with migration A''s body; gate contract holds';
END
$verify$;

-- ------------------------------------------------------------------
-- 4. Client write as the sacrificial athlete.
-- ------------------------------------------------------------------
CREATE TEMP TABLE verify_profile_snap (
  step text PRIMARY KEY,
  safety_fingerprint text,
  recomputed text,
  last_feedback_week text
) ON COMMIT DROP;

-- Snapshot as the migration role, in its own statement.
INSERT INTO verify_profile_snap
SELECT 'before',
       p.safety_fingerprint,
       public.profile_safety_fingerprint(p.equipment, p.equipment_extras, p.experience,
                                         p.health_conditions, p.injuries),
       p.last_feedback_week::text
  FROM public.profiles p
 WHERE p.id = current_setting('verify.uid')::uuid;

-- Impersonate that athlete. auth.uid() reads these settings.
SELECT set_config('request.jwt.claim.sub', current_setting('verify.uid'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('verify.uid'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

-- A column the client legitimately owns. RLS and column grants apply; the
-- trigger runs with the athlete's privileges. Temp tables are not touched
-- under this role; the row count travels through a setting.
DO $verify$
DECLARE
  n integer;
BEGIN
  UPDATE public.profiles
     SET last_feedback_week = '2099-01-05'
   WHERE id = current_setting('verify.uid')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('verify.client_rows', n::text, true);
END
$verify$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO verify_profile_snap
SELECT 'after_client',
       p.safety_fingerprint,
       public.profile_safety_fingerprint(p.equipment, p.equipment_extras, p.experience,
                                         p.health_conditions, p.injuries),
       p.last_feedback_week::text
  FROM public.profiles p
 WHERE p.id = current_setting('verify.uid')::uuid;

DO $verify$
DECLARE
  b verify_profile_snap%ROWTYPE;
  a verify_profile_snap%ROWTYPE;
BEGIN
  SELECT * INTO STRICT b FROM verify_profile_snap WHERE step = 'before';
  SELECT * INTO STRICT a FROM verify_profile_snap WHERE step = 'after_client';

  IF current_setting('verify.client_rows') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'VERIFY FAIL: athlete UPDATE of last_feedback_week touched % rows, expected 1',
      current_setting('verify.client_rows');
  END IF;
  IF a.last_feedback_week IS DISTINCT FROM '2099-01-05' THEN
    RAISE EXCEPTION 'VERIFY FAIL: last_feedback_week is %, expected 2099-01-05', a.last_feedback_week;
  END IF;
  IF a.safety_fingerprint IS DISTINCT FROM b.safety_fingerprint THEN
    RAISE EXCEPTION 'VERIFY FAIL: a non-safety client update changed safety_fingerprint (% -> %)',
      b.safety_fingerprint, a.safety_fingerprint;
  END IF;
  IF a.safety_fingerprint IS DISTINCT FROM a.recomputed THEN
    RAISE EXCEPTION 'VERIFY FAIL: after the client update the fingerprint is not its recomputation';
  END IF;

  RAISE NOTICE 'VERIFY PASS 4: athlete updated last_feedback_week; fingerprint unchanged';
END
$verify$;

-- ------------------------------------------------------------------
-- 5. As the migration role: a safety field change moves the fingerprint;
--    a forged value is overwritten by the trigger.
-- ------------------------------------------------------------------
UPDATE public.profiles
   SET injuries = coalesce(injuries, '') || ' [verify]'
 WHERE id = current_setting('verify.uid')::uuid;

INSERT INTO verify_profile_snap
SELECT 'after_safety_change',
       p.safety_fingerprint,
       public.profile_safety_fingerprint(p.equipment, p.equipment_extras, p.experience,
                                         p.health_conditions, p.injuries),
       p.last_feedback_week::text
  FROM public.profiles p
 WHERE p.id = current_setting('verify.uid')::uuid;

UPDATE public.profiles
   SET safety_fingerprint = 'v1:' || repeat('0', 64)
 WHERE id = current_setting('verify.uid')::uuid;

INSERT INTO verify_profile_snap
SELECT 'after_forge',
       p.safety_fingerprint,
       public.profile_safety_fingerprint(p.equipment, p.equipment_extras, p.experience,
                                         p.health_conditions, p.injuries),
       p.last_feedback_week::text
  FROM public.profiles p
 WHERE p.id = current_setting('verify.uid')::uuid;

DO $verify$
DECLARE
  c verify_profile_snap%ROWTYPE;
  s verify_profile_snap%ROWTYPE;
  f verify_profile_snap%ROWTYPE;
BEGIN
  SELECT * INTO STRICT c FROM verify_profile_snap WHERE step = 'after_client';
  SELECT * INTO STRICT s FROM verify_profile_snap WHERE step = 'after_safety_change';
  SELECT * INTO STRICT f FROM verify_profile_snap WHERE step = 'after_forge';

  IF s.safety_fingerprint = c.safety_fingerprint THEN
    RAISE EXCEPTION 'VERIFY FAIL: changing injuries did not change the fingerprint';
  END IF;
  IF s.safety_fingerprint IS DISTINCT FROM s.recomputed THEN
    RAISE EXCEPTION 'VERIFY FAIL: after the injuries change the fingerprint is not its recomputation';
  END IF;

  IF f.safety_fingerprint = 'v1:' || repeat('0', 64) THEN
    RAISE EXCEPTION 'VERIFY FAIL: a forged fingerprint was stored';
  END IF;
  IF f.safety_fingerprint IS DISTINCT FROM s.safety_fingerprint
     OR f.safety_fingerprint IS DISTINCT FROM f.recomputed THEN
    RAISE EXCEPTION 'VERIFY FAIL: after the forge attempt the fingerprint is %, expected %',
      f.safety_fingerprint, s.safety_fingerprint;
  END IF;

  RAISE NOTICE 'VERIFY PASS 5: safety change moved the fingerprint; forged value overwritten';
END
$verify$;

-- ------------------------------------------------------------------
-- Helpers for steps 6-12.
-- verify_status_as_athlete() calls the gate as the sacrificial athlete
-- (authenticated role, JWT claims) and returns its one row, then restores
-- the migration role and clears the claims. pg_temp: dropped with the
-- session, and rolled back with everything else.
-- ------------------------------------------------------------------
CREATE FUNCTION pg_temp.verify_status_as_athlete(OUT o_status text, OUT o_plan_id uuid)
LANGUAGE plpgsql
AS $helper$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('verify.uid'), true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('verify.uid'), 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  SELECT s.status, s.plan_id
    INTO STRICT o_status, o_plan_id
    FROM public.get_active_plan_safety_status() s;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$helper$;

CREATE TEMP TABLE verify_rpc_calls (
  step text PRIMARY KEY,
  workout_plan_id uuid,
  nutrition_plan_id uuid,
  replayed boolean
) ON COMMIT DROP;

CREATE TEMP TABLE verify_gate (
  step text PRIMARY KEY,
  status text,
  plan_id uuid
) ON COMMIT DROP;

-- ------------------------------------------------------------------
-- 6. Matching token: the plan stores the profile's fingerprint.
-- ------------------------------------------------------------------
SELECT set_config('verify.fp_matching', p.safety_fingerprint, true)
  FROM public.profiles p
 WHERE p.id = current_setting('verify.uid')::uuid;

INSERT INTO verify_rpc_calls (step, workout_plan_id, nutrition_plan_id, replayed)
SELECT 'matching', r.workout_plan_id, r.nutrition_plan_id, r.replayed
  FROM public.replace_user_plans_atomic(
    p_user_id                    := current_setting('verify.uid')::uuid,
    p_client_attempt_id          := gen_random_uuid(),
    p_workout_coach_id           := 'aria',
    p_workout_plan_type          := 'weekly',
    p_workout_week_start         := date '2026-09-28',
    p_workout_week_number        := 1,
    p_workout_activate_on        := NULL,
    p_workout_plan_data          := '{"verify": "matching", "days": []}'::jsonb,
    p_nutrition_plan_data        := NULL,
    p_expected_safety_fingerprint := current_setting('verify.fp_matching')
  ) AS r;

INSERT INTO verify_gate (step, status, plan_id)
SELECT 'after_matching', g.o_status, g.o_plan_id
  FROM pg_temp.verify_status_as_athlete() g;

DO $verify$
DECLARE
  v_call  verify_rpc_calls%ROWTYPE;
  v_gate  verify_gate%ROWTYPE;
  plan_fp text;
BEGIN
  SELECT * INTO STRICT v_call FROM verify_rpc_calls WHERE step = 'matching';
  SELECT * INTO STRICT v_gate FROM verify_gate WHERE step = 'after_matching';

  IF v_call.replayed IS DISTINCT FROM false OR v_call.workout_plan_id IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: matching-token call returned replayed=% workout_plan_id=%',
      v_call.replayed, v_call.workout_plan_id;
  END IF;

  SELECT w.safety_fingerprint INTO STRICT plan_fp
    FROM public.workout_plans w
   WHERE w.id = v_call.workout_plan_id;

  IF plan_fp IS DISTINCT FROM current_setting('verify.fp_matching') THEN
    RAISE EXCEPTION 'VERIFY FAIL: plan fingerprint % differs from the profile fingerprint %',
      plan_fp, current_setting('verify.fp_matching');
  END IF;

  IF v_gate.status IS DISTINCT FROM 'valid' OR v_gate.plan_id IS DISTINCT FROM v_call.workout_plan_id THEN
    RAISE EXCEPTION 'VERIFY FAIL: gate after the matching save returned (%, %), expected (valid, %)',
      v_gate.status, v_gate.plan_id, v_call.workout_plan_id;
  END IF;

  RAISE NOTICE 'VERIFY PASS 6: matching token saved plan % with the profile fingerprint; gate valid',
    v_call.workout_plan_id;
END
$verify$;

-- ------------------------------------------------------------------
-- 7. Different valid-format token: 45413, nothing inserted or archived.
--    The call runs in a nested block so the script continues. The block's
--    savepoint would undo a write anyway, so the before/after comparison
--    below confirms the observable outcome; that the RAISE precedes every
--    write is asserted statically by the migration contract test.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_uid          uuid := current_setting('verify.uid')::uuid;
  v_token        CONSTANT text := 'v1:' || repeat('f', 64);
  v_state        text;
  v_message      text;
  n_before       bigint;
  n_after        bigint;
  active_before  uuid[];
  active_after   uuid[];
BEGIN
  IF v_token = current_setting('verify.fp_matching') THEN
    RAISE EXCEPTION 'VERIFY: the test token equals the profile fingerprint; pick another';
  END IF;

  SELECT count(*), array_agg(w.id ORDER BY w.id) FILTER (WHERE w.is_active IS TRUE)
    INTO n_before, active_before
    FROM public.workout_plans w
   WHERE w.user_id = v_uid;

  BEGIN
    PERFORM 1
      FROM public.replace_user_plans_atomic(
        p_user_id                    := v_uid,
        p_client_attempt_id          := gen_random_uuid(),
        p_workout_coach_id           := 'aria',
        p_workout_plan_type          := 'weekly',
        p_workout_week_start         := date '2026-09-28',
        p_workout_week_number        := 1,
        p_workout_activate_on        := NULL,
        p_workout_plan_data          := '{"verify": "mismatch", "days": []}'::jsonb,
        p_nutrition_plan_data        := NULL,
        p_expected_safety_fingerprint := v_token
      );
    v_state := 'no error';
  EXCEPTION WHEN SQLSTATE '45413' THEN
    v_state := '45413';
    v_message := SQLERRM;
  END;

  SELECT count(*), array_agg(w.id ORDER BY w.id) FILTER (WHERE w.is_active IS TRUE)
    INTO n_after, active_after
    FROM public.workout_plans w
   WHERE w.user_id = v_uid;

  IF v_state IS DISTINCT FROM '45413' OR v_message IS DISTINCT FROM 'plan_safety_profile_changed' THEN
    RAISE EXCEPTION 'VERIFY FAIL: mismatched token gave %/%, expected 45413/plan_safety_profile_changed',
      v_state, v_message;
  END IF;
  IF n_after IS DISTINCT FROM n_before OR active_after IS DISTINCT FROM active_before THEN
    RAISE EXCEPTION 'VERIFY FAIL: the rejected call changed workout_plans (rows % -> %, active % -> %)',
      n_before, n_after, active_before, active_after;
  END IF;

  RAISE NOTICE 'VERIFY PASS 7: mismatched token rejected with 45413; % rows and active set unchanged', n_after;
END
$verify$;

-- ------------------------------------------------------------------
-- 8. A safety field change (migration role) makes the active plan stale.
-- ------------------------------------------------------------------
UPDATE public.profiles
   SET injuries = coalesce(injuries, '') || ' [verify stale]'
 WHERE id = current_setting('verify.uid')::uuid;

INSERT INTO verify_gate (step, status, plan_id)
SELECT 'after_safety_change', g.o_status, g.o_plan_id
  FROM pg_temp.verify_status_as_athlete() g;

-- ------------------------------------------------------------------
-- 9. NULL token (legacy path): the plan is saved unverified.
-- ------------------------------------------------------------------
INSERT INTO verify_rpc_calls (step, workout_plan_id, nutrition_plan_id, replayed)
SELECT 'null_token', r.workout_plan_id, r.nutrition_plan_id, r.replayed
  FROM public.replace_user_plans_atomic(
    p_user_id                    := current_setting('verify.uid')::uuid,
    p_client_attempt_id          := gen_random_uuid(),
    p_workout_coach_id           := 'aria',
    p_workout_plan_type          := 'weekly',
    p_workout_week_start         := date '2026-09-28',
    p_workout_week_number        := 1,
    p_workout_activate_on        := NULL,
    p_workout_plan_data          := '{"verify": "null_token", "days": []}'::jsonb,
    p_nutrition_plan_data        := NULL,
    p_expected_safety_fingerprint := NULL
  ) AS r;

INSERT INTO verify_gate (step, status, plan_id)
SELECT 'after_null_token', g.o_status, g.o_plan_id
  FROM pg_temp.verify_status_as_athlete() g;

-- ------------------------------------------------------------------
-- 10. A second active row, inserted as the migration role. If a unique
--     index forbids two active plans per user, the state is unreachable and
--     the check is reported as skipped instead of failing.
-- ------------------------------------------------------------------
DO $verify$
BEGIN
  BEGIN
    INSERT INTO public.workout_plans
      (user_id, coach_id, plan_type, week_start, week_number, plan_data, is_active)
    VALUES
      (current_setting('verify.uid')::uuid, 'aria', 'weekly', date '2026-09-28', 1,
       '{"verify": "second_active", "days": []}'::jsonb, true);
    PERFORM set_config('verify.second_active', 'inserted', true);
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('verify.second_active', 'blocked_by_unique_index', true);
  END;
END
$verify$;

INSERT INTO verify_gate (step, status, plan_id)
SELECT 'after_second_active', g.o_status, g.o_plan_id
  FROM pg_temp.verify_status_as_athlete() g;

-- ------------------------------------------------------------------
-- 11. Every row deactivated, as the migration role.
-- ------------------------------------------------------------------
UPDATE public.workout_plans
   SET is_active = false
 WHERE user_id = current_setting('verify.uid')::uuid
   AND is_active IS TRUE;

INSERT INTO verify_gate (step, status, plan_id)
SELECT 'after_deactivate_all', g.o_status, g.o_plan_id
  FROM pg_temp.verify_status_as_athlete() g;

-- ------------------------------------------------------------------
-- 12. No JWT (migration role, claims cleared): profile_unavailable.
--     anon: no EXECUTE.
-- ------------------------------------------------------------------
INSERT INTO verify_gate (step, status, plan_id)
SELECT 'no_jwt', s.status, s.plan_id
  FROM public.get_active_plan_safety_status() s;

SET LOCAL ROLE anon;

DO $verify$
BEGIN
  BEGIN
    PERFORM 1 FROM public.get_active_plan_safety_status();
    PERFORM set_config('verify.anon_gate', 'executed', true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('verify.anon_gate', 'denied', true);
  END;
END
$verify$;

RESET ROLE;

-- ------------------------------------------------------------------
-- Assertions for steps 8-12.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_matching  verify_rpc_calls%ROWTYPE;
  v_null      verify_rpc_calls%ROWTYPE;
  g           verify_gate%ROWTYPE;
  plan_fp     text;
BEGIN
  SELECT * INTO STRICT v_matching FROM verify_rpc_calls WHERE step = 'matching';
  SELECT * INTO STRICT v_null     FROM verify_rpc_calls WHERE step = 'null_token';

  -- 8. stale
  SELECT * INTO STRICT g FROM verify_gate WHERE step = 'after_safety_change';
  IF g.status IS DISTINCT FROM 'stale' OR g.plan_id IS DISTINCT FROM v_matching.workout_plan_id THEN
    RAISE EXCEPTION 'VERIFY FAIL: gate after a safety change returned (%, %), expected (stale, %)',
      g.status, g.plan_id, v_matching.workout_plan_id;
  END IF;

  -- 9. NULL token -> NULL plan fingerprint -> unverified; the matching plan was archived.
  IF v_null.replayed IS DISTINCT FROM false OR v_null.workout_plan_id IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: NULL-token call returned replayed=% workout_plan_id=%',
      v_null.replayed, v_null.workout_plan_id;
  END IF;
  SELECT w.safety_fingerprint INTO plan_fp
    FROM public.workout_plans w WHERE w.id = v_null.workout_plan_id;
  IF plan_fp IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: NULL-token plan stored fingerprint %, expected NULL', plan_fp;
  END IF;
  SELECT * INTO STRICT g FROM verify_gate WHERE step = 'after_null_token';
  IF g.status IS DISTINCT FROM 'unverified' OR g.plan_id IS DISTINCT FROM v_null.workout_plan_id THEN
    RAISE EXCEPTION 'VERIFY FAIL: gate after the NULL-token save returned (%, %), expected (unverified, %)',
      g.status, g.plan_id, v_null.workout_plan_id;
  END IF;

  -- 10. two active rows
  SELECT * INTO STRICT g FROM verify_gate WHERE step = 'after_second_active';
  IF current_setting('verify.second_active') = 'inserted' THEN
    IF g.status IS DISTINCT FROM 'invalid_multiple_active_plans' OR g.plan_id IS NOT NULL THEN
      RAISE EXCEPTION 'VERIFY FAIL: gate with two active plans returned (%, %), expected (invalid_multiple_active_plans, NULL)',
        g.status, g.plan_id;
    END IF;
  ELSE
    RAISE NOTICE 'VERIFY SKIP 10: a unique index forbids a second active plan; invalid_multiple_active_plans is unreachable';
  END IF;

  -- 11. none active
  SELECT * INTO STRICT g FROM verify_gate WHERE step = 'after_deactivate_all';
  IF g.status IS DISTINCT FROM 'no_active_plan' OR g.plan_id IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: gate with no active plan returned (%, %), expected (no_active_plan, NULL)',
      g.status, g.plan_id;
  END IF;

  -- 12. no JWT; anon
  SELECT * INTO STRICT g FROM verify_gate WHERE step = 'no_jwt';
  IF g.status IS DISTINCT FROM 'profile_unavailable' OR g.plan_id IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: gate without a JWT returned (%, %), expected (profile_unavailable, NULL)',
      g.status, g.plan_id;
  END IF;
  IF current_setting('verify.anon_gate') IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'VERIFY FAIL: anon calling get_active_plan_safety_status was %, expected denied',
      current_setting('verify.anon_gate');
  END IF;

  RAISE NOTICE 'VERIFY PASS 8-12: stale, unverified, %, no_active_plan, profile_unavailable; anon denied',
    CASE WHEN current_setting('verify.second_active') = 'inserted'
         THEN 'invalid_multiple_active_plans' ELSE 'invalid_multiple_active_plans skipped' END;
END
$verify$;

ROLLBACK;

-- Nothing persisted. The ROLLBACK above undid the last_feedback_week and
-- injuries updates, the forge attempt, every workout plan inserted, the
-- archiving and deactivation of the athlete's plans, the temp function, and
-- every temp table and setting of this block.
