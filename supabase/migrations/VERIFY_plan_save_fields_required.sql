-- NOT A MIGRATION. Scratch verification only; manual execution after migration D.
-- Do not apply with supabase db push / migration up. UNEXECUTED by this task.
-- Before running, replace verify.uid below with the UUID of test@endopamin.com.
-- Never use a real athlete. The script detaches that user's plans, clears
-- anchors, inserts a plan and changes injuries inside this transaction only.
-- Every failure raises VERIFY FAIL; each successful check prints VERIFY PASS.
-- Always run the whole script through its final ROLLBACK.

BEGIN;
SET LOCAL lock_timeout = '5s';

SELECT set_config(
  'verify.uid',
  '00000000-0000-0000-0000-000000000000',
  true
);

DO $verify$
DECLARE
  uid uuid := current_setting('verify.uid')::uuid;
BEGIN
  IF uid = '00000000-0000-0000-0000-000000000000'
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid AND lower(email) = 'test@endopamin.com')
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid) THEN
    RAISE EXCEPTION 'VERIFY FAIL: verify.uid must be the UUID of test@endopamin.com with a profile';
  END IF;
  PERFORM 1 FROM auth.users WHERE id = uid FOR UPDATE;
  RAISE NOTICE 'VERIFY PASS: sacrificial user confirmed and locked';
END
$verify$;

DO $verify$
DECLARE
  rpc_oid oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text)');
  n integer;
  fn record;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL a: expected exactly one eleven-argument RPC, found %', n;
  END IF;
  SELECT p.*, l.lanname INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = rpc_oid;
  IF fn.pronargs <> 11 OR fn.pronargdefaults <> 3
     OR NOT fn.prosecdef OR fn.provolatile <> 'v' OR fn.lanname <> 'plpgsql'
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole
     OR md5(fn.prosrc) IS DISTINCT FROM 'f00f384319e83de791594d3e91547e1f' THEN
    RAISE EXCEPTION 'VERIFY FAIL a: RPC contract or migration D body differs';
  END IF;
  RAISE NOTICE 'VERIFY PASS a: one eleven-argument RPC, migration D body and contract';

  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid AND a.grantee = 0;
  IF n <> 0
     OR has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAIL b: PUBLIC/anon/authenticated must not execute; service_role must execute';
  END IF;
  RAISE NOTICE 'VERIFY PASS b: PUBLIC/anon/authenticated=false; service_role=true';
END
$verify$;

-- Same sacrificial-user isolation as migration C; no deletion.
UPDATE public.workout_plans SET user_id = NULL
 WHERE user_id = current_setting('verify.uid')::uuid;
UPDATE public.profiles SET first_plan_at = NULL, last_plan_adjustment_at = NULL
 WHERE id = current_setting('verify.uid')::uuid;

CREATE FUNCTION pg_temp.verify_d_call(
  p_op text, p_token text, p_attempt uuid,
  OUT o_state text, OUT o_message text,
  OUT o_workout uuid, OUT o_nutrition uuid, OUT o_replayed boolean)
LANGUAGE plpgsql
AS $helper$
BEGIN
  BEGIN
    SELECT r.workout_plan_id, r.nutrition_plan_id, r.replayed
      INTO STRICT o_workout, o_nutrition, o_replayed
      FROM public.replace_user_plans_atomic(
        p_user_id := current_setting('verify.uid')::uuid,
        p_client_attempt_id := p_attempt,
        p_workout_coach_id := 'aria',
        p_workout_plan_type := 'weekly',
        p_workout_week_start := date '2026-10-05',
        p_workout_week_number := 1,
        p_workout_activate_on := NULL,
        p_workout_plan_data := jsonb_build_object('verify', 'migration D', 'days', '[]'::jsonb),
        p_nutrition_plan_data := NULL,
        p_expected_safety_fingerprint := p_token,
        p_operation := p_op
      ) r;
    o_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS o_state = RETURNED_SQLSTATE, o_message = MESSAGE_TEXT;
  END;
END
$helper$;

DO $verify$
DECLARE
  spec record;
  result record;
  token text;
  new_token text;
  attempt uuid := gen_random_uuid();
  saved_workout uuid;
  saved_nutrition uuid;
  saved_rows jsonb;
  current_rows jsonb;
  saved_first timestamptz;
  saved_last timestamptz;
BEGIN
  SELECT safety_fingerprint INTO STRICT token FROM public.profiles
   WHERE id = current_setting('verify.uid')::uuid;
  IF token IS NULL OR token !~ '^v1:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'VERIFY FAIL: sacrificial profile has no valid safety fingerprint';
  END IF;

  FOR spec IN SELECT * FROM (VALUES
    ('c NULL operation', NULL::text, token, '22023', 'plan_operation_unknown'),
    ('d NULL fingerprint', 'initial_setup', NULL::text, '45416', 'plan_safety_fingerprint_invalid'),
    ('d malformed fingerprint', 'initial_setup', 'v1:nothex', '45416', 'plan_safety_fingerprint_invalid'),
    ('e both NULL', NULL::text, NULL::text, '22023', 'plan_operation_unknown')
  ) AS cases(label, op, fp, state, message)
  LOOP
    SELECT * INTO STRICT result FROM pg_temp.verify_d_call(spec.op, spec.fp, gen_random_uuid());
    IF result.o_state IS DISTINCT FROM spec.state OR result.o_message IS DISTINCT FROM spec.message THEN
      RAISE EXCEPTION 'VERIFY FAIL %: got %/%, expected %/%',
        spec.label, result.o_state, result.o_message, spec.state, spec.message;
    END IF;
    RAISE NOTICE 'VERIFY PASS %: %', spec.label, spec.state;
  END LOOP;

  SELECT * INTO STRICT result FROM pg_temp.verify_d_call('initial_setup', token, attempt);
  IF result.o_state IS DISTINCT FROM 'ok' OR result.o_replayed IS DISTINCT FROM false
     OR result.o_workout IS NULL OR result.o_nutrition IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL f fresh save: state=% replayed=%', result.o_state, result.o_replayed;
  END IF;
  saved_workout := result.o_workout;
  saved_nutrition := result.o_nutrition;
  IF NOT EXISTS (SELECT 1 FROM public.workout_plans
                 WHERE id = saved_workout AND user_id = current_setting('verify.uid')::uuid
                   AND client_attempt_id = attempt AND operation = 'initial_setup'
                   AND safety_fingerprint = token AND is_active IS TRUE) THEN
    RAISE EXCEPTION 'VERIFY FAIL f fresh save: stored plan differs';
  END IF;
  RAISE NOTICE 'VERIFY PASS f fresh save: stored plan %', saved_workout;

  -- Make the original token genuinely stale using the existing profile trigger.
  UPDATE public.profiles
     SET injuries = COALESCE(injuries, '') || ' migration D VERIFY only'
   WHERE id = current_setting('verify.uid')::uuid;
  SELECT safety_fingerprint, first_plan_at, last_plan_adjustment_at
    INTO STRICT new_token, saved_first, saved_last FROM public.profiles
   WHERE id = current_setting('verify.uid')::uuid;
  IF new_token IS NULL OR new_token !~ '^v1:[0-9a-f]{64}$' OR new_token = token THEN
    RAISE EXCEPTION 'VERIFY FAIL f: injury change did not produce a new valid fingerprint';
  END IF;
  SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) INTO saved_rows FROM public.workout_plans w
   WHERE w.user_id = current_setting('verify.uid')::uuid;

  -- initial_setup would be ineligible for a fresh write now; replay bypasses
  -- both the stale-token comparison and the operation eligibility check.
  SELECT * INTO STRICT result FROM pg_temp.verify_d_call('initial_setup', token, attempt);
  IF result.o_state IS DISTINCT FROM 'ok' OR result.o_replayed IS DISTINCT FROM true
     OR result.o_workout IS DISTINCT FROM saved_workout
     OR result.o_nutrition IS DISTINCT FROM saved_nutrition THEN
    RAISE EXCEPTION 'VERIFY FAIL f replay: stored result was not returned';
  END IF;
  RAISE NOTICE 'VERIFY PASS f replay: stale well-formed token returns the stored result';

  SELECT * INTO STRICT result FROM pg_temp.verify_d_call('initial_setup', NULL, attempt);
  IF result.o_state IS DISTINCT FROM '45416'
     OR result.o_message IS DISTINCT FROM 'plan_safety_fingerprint_invalid' THEN
    RAISE EXCEPTION 'VERIFY FAIL g: NULL replay token got %/%', result.o_state, result.o_message;
  END IF;
  RAISE NOTICE 'VERIFY PASS g: NULL replay fingerprint rejected with 45416';

  SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) INTO current_rows FROM public.workout_plans w
   WHERE w.user_id = current_setting('verify.uid')::uuid;
  IF current_rows IS DISTINCT FROM saved_rows OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = current_setting('verify.uid')::uuid
      AND first_plan_at IS NOT DISTINCT FROM saved_first
      AND last_plan_adjustment_at IS NOT DISTINCT FROM saved_last
  ) THEN
    RAISE EXCEPTION 'VERIFY FAIL: replay or refused replay changed plans or anchors';
  END IF;
  RAISE NOTICE 'VERIFY PASS: replays leave stored plans and anchors unchanged';
END
$verify$;

ROLLBACK;
