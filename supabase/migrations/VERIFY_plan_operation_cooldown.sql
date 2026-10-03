-- NOT A MIGRATION. Scratch verification only. Do not apply with
-- supabase db push / migration up. The filename has no timestamp on
-- purpose. Do not run this from the task that authored it.
--
-- Run only AFTER 20261002120000_plan_operation_cooldown.sql has been
-- applied. One transaction that always ends in ROLLBACK. Supersedes
-- VERIFY_profile_safety_fingerprint.sql, whose catalog step expects the
-- ten-argument RPC and fails once migration C is applied.
--
-- What this block shows, then undoes:
--   1. Catalog: replace_user_plans_atomic is the only function of that name,
--      the eleven-argument contract (migration A plus p_operation DEFAULT
--      NULL), owner and grants as migration A, migration C's body md5. The
--      three new columns, the CHECK, a plain index on workout_plans(user_id),
--      no client INSERT/UPDATE on the profiles anchors, and the three pinned
--      profiles triggers.
--   2. Stored data: anchors never in the future; an adjustment anchor never
--      without a first-plan anchor.
--   3. Unknown operation: 22023, nothing written.
--   4. Sandbox: the athlete's plans are detached (user_id = NULL) and both
--      anchors cleared, so the athlete looks like a brand-new user.
--   5. feedback_adjustment with no plan at all: 45415.
--   6. initial_setup: saved; operation stored; first_plan_at = now();
--      last_plan_adjustment_at stays NULL.
--   7. initial_setup again: 45415, nothing written.
--   8. Replay of step 6's attempt id declaring feedback_adjustment: pure read
--      (replayed, same plan), anchors unchanged.
--   9. feedback_adjustment: saved; last_plan_adjustment_at = now().
--  10. feedback_adjustment again: 45414, DETAIL = now() + 7 days (UTC
--      ISO-8601, rounded up to the millisecond), nothing written.
--  11. feedback_adjustment with a wrong token during the cooldown: 45413 (the
--      token check runs before the gate).
--  12. Legacy NULL operation and NULL token during the cooldown: saved,
--      operation NULL, anchors unchanged, plan unverified.
--  13. safety_regeneration with a NULL token: 45415.
--  14. safety_regeneration on an unverified plan during the cooldown: saved,
--      last_plan_adjustment_at unchanged.
--  15. safety_regeneration on a valid plan: 45415.
--  16. A safety field change: stale; safety_regeneration with the new token
--      is saved.
--  17. Every plan deactivated: no_active_plan; safety_regeneration is saved.
--  18. Boundary: one millisecond inside the 7 days is 45414; exactly 7 days
--      is allowed.
--  19. ROLLBACK so no production row remains.
--
-- Before running: replace the uuid in set_config('verify.uid', ...) with a
-- sacrificial public.profiles.id you control. Never use a real athlete.
-- Steps 4-18 detach that user's plans, clear and set their anchors, change
-- their injuries and insert plans inside this transaction; the ROLLBACK undoes
-- all of it. Refusals run inside a nested block, whose savepoint would undo a
-- write anyway, so each refusal is checked by its observable outcome; that
-- every RAISE precedes every write is asserted statically by
-- tests/plan-operation-migration.test.js.

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
-- 1. Catalog.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  rpc_oid  oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text)');
  fn       record;
  att      record;
  spec     record;
  r        text;
  col_name text;
  n        integer;
  trg_names text[];
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: replace_user_plans_atomic is absent, overloaded (% found), or not the eleven-argument function', n;
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
       || 'p_expected_safety_fingerprint text, p_operation text' THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC identity arguments are %', pg_get_function_identity_arguments(rpc_oid);
  END IF;
  IF pg_get_function_result(rpc_oid) IS DISTINCT FROM
       'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)' THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC result is %', pg_get_function_result(rpc_oid);
  END IF;
  IF fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' OR NOT fn.prosecdef
     OR fn.provolatile <> 'v' OR NOT fn.proretset
     OR fn.pronargs <> 11 OR fn.pronargdefaults <> 3
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC language, security, volatility, arity, search_path or owner differ from the contract';
  END IF;

  IF md5(fn.prosrc) IS DISTINCT FROM '8a558cb77f1e686e1018f0f66dabd1ea' THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC body md5 is %, expected migration C''s body', md5(fn.prosrc);
  END IF;

  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid AND a.grantee = 0;
  IF n <> 0
     OR has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAIL: RPC EXECUTE privileges differ from migration A';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid
     AND a.grantee NOT IN (fn.proowner, 'service_role'::regrole::oid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: % unexpected grantee(s) on the RPC', n;
  END IF;

  -- The three new columns.
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.profiles',      'first_plan_at',           'timestamp with time zone'),
      ('public.profiles',      'last_plan_adjustment_at', 'timestamp with time zone'),
      ('public.workout_plans', 'operation',               'text')
    ) AS v(tbl, col, typ)
  LOOP
    SELECT a.atttypid, a.attnotnull, a.atthasdef INTO att
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass(spec.tbl)
       AND a.attname = spec.col
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT FOUND OR att.atttypid <> spec.typ::regtype OR att.attnotnull OR att.atthasdef THEN
      RAISE EXCEPTION 'VERIFY FAIL: %.% is not % NULL without default', spec.tbl, spec.col, spec.typ;
    END IF;
  END LOOP;

  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.workout_plans'::regclass
         AND c.conname = 'workout_plans_operation_valid')
     IS DISTINCT FROM
     $chk$CHECK (((operation IS NULL) OR (operation = ANY (ARRAY['initial_setup'::text, 'feedback_adjustment'::text, 'safety_regeneration'::text]))))$chk$ THEN
    RAISE EXCEPTION 'VERIFY FAIL: workout_plans_operation_valid is missing or differs';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam
     WHERE i.indrelid = 'public.workout_plans'::regclass
       AND i.indnatts = 1
       AND i.indkey[0] = (SELECT a.attnum FROM pg_attribute a
                           WHERE a.attrelid = 'public.workout_plans'::regclass
                             AND a.attname = 'user_id')
       AND i.indpred IS NULL
       AND i.indexprs IS NULL
       AND i.indisvalid
       AND am.amname = 'btree') THEN
    RAISE EXCEPTION 'VERIFY FAIL: workout_plans has no plain btree index on (user_id)';
  END IF;

  -- Clients hold no INSERT or UPDATE on either anchor.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH col_name IN ARRAY ARRAY['first_plan_at', 'last_plan_adjustment_at'] LOOP
      IF has_column_privilege(r, 'public.profiles', col_name, 'INSERT')
         OR has_column_privilege(r, 'public.profiles', col_name, 'UPDATE') THEN
        RAISE EXCEPTION 'VERIFY FAIL: % can INSERT or UPDATE profiles.%', r, col_name;
      END IF;
    END LOOP;
  END LOOP;

  -- The three pinned profiles triggers, and no other.
  SELECT array_agg(g.tgname::text ORDER BY g.tgname::text COLLATE "C")
    INTO trg_names
    FROM pg_trigger g
   WHERE g.tgrelid = 'public.profiles'::regclass
     AND NOT g.tgisinternal;
  IF trg_names IS DISTINCT FROM ARRAY['trg_protect_onboarding_completed_latch',
                                      'trg_protect_profile_billing',
                                      'trg_set_profile_safety_fingerprint'] THEN
    RAISE EXCEPTION 'VERIFY FAIL: user triggers on public.profiles are %', trg_names;
  END IF;
  FOR spec IN
    SELECT * FROM (VALUES
      ('protect_onboarding_completed_latch', '2ba28d83975dd1d061e8c4ca7d35b1f4'),
      ('protect_profile_billing_columns',    '267a03753824a7c0c5e39be1bf6785e2'),
      ('set_profile_safety_fingerprint',     '038f21e089322300f22e5aa840f676d9')
    ) AS v(fname, want_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p
         WHERE p.oid = to_regprocedure('public.' || spec.fname || '()'))
       IS DISTINCT FROM spec.want_md5 THEN
      RAISE EXCEPTION 'VERIFY FAIL: public.%() body md5 differs from %', spec.fname, spec.want_md5;
    END IF;
  END LOOP;

  RAISE NOTICE 'VERIFY PASS 1: eleven-argument RPC with migration C''s body; columns, CHECK, index, client privileges and trigger pins hold';
END
$verify$;

-- ------------------------------------------------------------------
-- 2. Stored data. Firm invariants only: both anchors are written by the RPC
--    alone, at now() (first_plan_at was also backfilled from generated_at,
--    which defaults to now(); a future value there means a client wrote
--    generated_at directly), and first_plan_at is written whenever the
--    other is.
--    Counts that depend on client writes (migration B's scope) are notices.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  n_future     bigint;
  n_orphan     bigint;
  n_adjusted   bigint;
  n_no_anchor  bigint;
  n_labelled   bigint;
BEGIN
  SELECT count(*) INTO n_future
    FROM public.profiles p
   WHERE p.first_plan_at > now() OR p.last_plan_adjustment_at > now();
  IF n_future <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: % profiles carry an anchor in the future', n_future;
  END IF;

  SELECT count(*) INTO n_orphan
    FROM public.profiles p
   WHERE p.last_plan_adjustment_at IS NOT NULL AND p.first_plan_at IS NULL;
  IF n_orphan <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: % profiles have an adjustment anchor without a first-plan anchor', n_orphan;
  END IF;

  SELECT count(*) INTO n_adjusted FROM public.profiles p WHERE p.last_plan_adjustment_at IS NOT NULL;
  SELECT count(*) INTO n_no_anchor
    FROM public.profiles p
   WHERE p.first_plan_at IS NULL
     AND EXISTS (SELECT 1 FROM public.workout_plans w WHERE w.user_id = p.id);
  SELECT count(*) INTO n_labelled FROM public.workout_plans w WHERE w.operation IS NOT NULL;

  RAISE NOTICE 'VERIFY PASS 2: anchors consistent; % profiles adjusted since migration C; % with plans but no first_plan_at (NULL generated_at or a direct client insert); % labelled plans',
    n_adjusted, n_no_anchor, n_labelled;
END
$verify$;

-- ------------------------------------------------------------------
-- Helpers for steps 3-18. pg_temp: dropped with the session, and rolled
-- back with everything else. Every call runs as the migration role, as the
-- endpoint's service_role call would, keyed on verify.uid.
-- ------------------------------------------------------------------
CREATE FUNCTION pg_temp.verify_fp() RETURNS text
LANGUAGE sql
AS $helper$
  SELECT p.safety_fingerprint
    FROM public.profiles p
   WHERE p.id = current_setting('verify.uid')::uuid
$helper$;

-- The athlete's observable plan state: row count, active ids, both anchors.
CREATE FUNCTION pg_temp.verify_snapshot() RETURNS text
LANGUAGE sql
AS $helper$
  SELECT format('rows=%s active=%s first=%s last=%s',
    (SELECT count(*) FROM public.workout_plans w
      WHERE w.user_id = current_setting('verify.uid')::uuid),
    (SELECT array_agg(w.id ORDER BY w.id) FROM public.workout_plans w
      WHERE w.user_id = current_setting('verify.uid')::uuid
        AND w.is_active IS TRUE),
    (SELECT p.first_plan_at FROM public.profiles p
      WHERE p.id = current_setting('verify.uid')::uuid),
    (SELECT p.last_plan_adjustment_at FROM public.profiles p
      WHERE p.id = current_setting('verify.uid')::uuid))
$helper$;

-- One RPC call. Never raises: an error comes back as its SQLSTATE, message
-- and DETAIL, and the nested block's savepoint undoes anything it did.
CREATE FUNCTION pg_temp.verify_call(
  p_op text, p_token text, p_attempt uuid, p_tag text,
  OUT o_state text, OUT o_message text, OUT o_detail text,
  OUT o_workout_plan_id uuid, OUT o_replayed boolean)
LANGUAGE plpgsql
AS $helper$
BEGIN
  BEGIN
    SELECT r.workout_plan_id, r.replayed
      INTO STRICT o_workout_plan_id, o_replayed
      FROM public.replace_user_plans_atomic(
        p_user_id                     := current_setting('verify.uid')::uuid,
        p_client_attempt_id           := p_attempt,
        p_workout_coach_id            := 'aria',
        p_workout_plan_type           := 'weekly',
        p_workout_week_start          := date '2026-10-05',
        p_workout_week_number         := 1,
        p_workout_activate_on         := NULL,
        p_workout_plan_data           := jsonb_build_object('verify', p_tag, 'days', '[]'::jsonb),
        p_nutrition_plan_data         := NULL,
        p_expected_safety_fingerprint := p_token,
        p_operation                   := p_op
      ) AS r;
    o_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      o_state   = RETURNED_SQLSTATE,
      o_message = MESSAGE_TEXT,
      o_detail  = PG_EXCEPTION_DETAIL;
  END;
END
$helper$;

-- A call that must be refused with this SQLSTATE and message, writing
-- nothing. Returns the DETAIL.
CREATE FUNCTION pg_temp.verify_refused(
  p_step text, p_op text, p_token text, p_want_state text, p_want_message text)
RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_before text := pg_temp.verify_snapshot();
  v_after  text;
  v_res    record;
BEGIN
  SELECT * INTO STRICT v_res
    FROM pg_temp.verify_call(p_op, p_token, gen_random_uuid(), p_step);
  v_after := pg_temp.verify_snapshot();

  IF v_res.o_state IS DISTINCT FROM p_want_state
     OR v_res.o_message IS DISTINCT FROM p_want_message THEN
    RAISE EXCEPTION 'VERIFY FAIL %: got %/%, expected %/%',
      p_step, v_res.o_state, v_res.o_message, p_want_state, p_want_message;
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'VERIFY FAIL %: the refused call changed state (% -> %)', p_step, v_before, v_after;
  END IF;

  RAISE NOTICE 'VERIFY PASS %: refused with % %', p_step, p_want_state, p_want_message;
  RETURN v_res.o_detail;
END
$helper$;

-- A call that must save a fresh plan with this operation label. Returns the
-- new workout plan id.
CREATE FUNCTION pg_temp.verify_saved(
  p_step text, p_op text, p_token text, p_attempt uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_res    record;
  v_row    record;
BEGIN
  SELECT * INTO STRICT v_res
    FROM pg_temp.verify_call(p_op, p_token, p_attempt, p_step);

  IF v_res.o_state IS DISTINCT FROM 'ok'
     OR v_res.o_replayed IS DISTINCT FROM false
     OR v_res.o_workout_plan_id IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL %: got state=% message=% replayed=% plan=%, expected a fresh save',
      p_step, v_res.o_state, v_res.o_message, v_res.o_replayed, v_res.o_workout_plan_id;
  END IF;

  SELECT w.operation, w.is_active, w.client_attempt_id, w.safety_fingerprint
    INTO STRICT v_row
    FROM public.workout_plans w
   WHERE w.id = v_res.o_workout_plan_id;
  IF v_row.operation IS DISTINCT FROM p_op
     OR v_row.is_active IS NOT TRUE
     OR v_row.client_attempt_id IS DISTINCT FROM p_attempt THEN
    RAISE EXCEPTION 'VERIFY FAIL %: saved row has operation=% active=% attempt=%, expected %/true/%',
      p_step, v_row.operation, v_row.is_active, v_row.client_attempt_id, p_op, p_attempt;
  END IF;
  IF (p_token IS NULL AND v_row.safety_fingerprint IS NOT NULL)
     OR (p_token IS NOT NULL AND v_row.safety_fingerprint IS DISTINCT FROM pg_temp.verify_fp()) THEN
    RAISE EXCEPTION 'VERIFY FAIL %: saved fingerprint % does not follow the token', p_step, v_row.safety_fingerprint;
  END IF;

  RAISE NOTICE 'VERIFY PASS %: saved plan % (operation %)', p_step, v_res.o_workout_plan_id, p_op;
  RETURN v_res.o_workout_plan_id;
END
$helper$;

-- The anchors must be exactly these values.
CREATE FUNCTION pg_temp.verify_anchors(
  p_step text, p_want_first timestamptz, p_want_last timestamptz)
RETURNS void
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_first timestamptz;
  v_last  timestamptz;
BEGIN
  SELECT p.first_plan_at, p.last_plan_adjustment_at
    INTO STRICT v_first, v_last
    FROM public.profiles p
   WHERE p.id = current_setting('verify.uid')::uuid;
  IF v_first IS DISTINCT FROM p_want_first OR v_last IS DISTINCT FROM p_want_last THEN
    RAISE EXCEPTION 'VERIFY FAIL %: anchors are (%, %), expected (%, %)',
      p_step, v_first, v_last, p_want_first, p_want_last;
  END IF;
END
$helper$;

-- The expected 45414 DETAIL for an anchor: anchor + 7 days, rounded up to
-- the millisecond, UTC ISO-8601. Same formula as the RPC.
CREATE FUNCTION pg_temp.verify_next_available(p_last timestamptz) RETURNS text
LANGUAGE sql
AS $helper$
  SELECT to_char(
           CASE
             WHEN p_last + interval '7 days' > date_trunc('milliseconds', p_last + interval '7 days')
             THEN date_trunc('milliseconds', p_last + interval '7 days') + interval '1 millisecond'
             ELSE p_last + interval '7 days'
           END AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$helper$;

-- The safety status for the athlete, from the gate function itself.
CREATE FUNCTION pg_temp.verify_status() RETURNS text
LANGUAGE plpgsql
AS $helper$
DECLARE
  v_status text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('verify.uid'), true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('verify.uid'), 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  SELECT s.status INTO STRICT v_status FROM public.get_active_plan_safety_status() s;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_status;
END
$helper$;

-- ------------------------------------------------------------------
-- 3. Unknown operation: 22023 before anything else, on the real state.
-- ------------------------------------------------------------------
SELECT pg_temp.verify_refused('3 unknown operation', 'weekly_rollover', pg_temp.verify_fp(),
                              '22023', 'plan_operation_unknown');

-- ------------------------------------------------------------------
-- 4. Sandbox: detach the athlete's plans (no delete: workout_sessions
--    references workout_plans) and clear both anchors.
-- ------------------------------------------------------------------
UPDATE public.workout_plans
   SET user_id = NULL
 WHERE user_id = current_setting('verify.uid')::uuid;

UPDATE public.profiles
   SET first_plan_at = NULL,
       last_plan_adjustment_at = NULL
 WHERE id = current_setting('verify.uid')::uuid;

DO $verify$
BEGIN
  IF pg_temp.verify_snapshot() IS DISTINCT FROM 'rows=0 active= first= last=' THEN
    RAISE EXCEPTION 'VERIFY: sandbox not clean: %', pg_temp.verify_snapshot();
  END IF;
  RAISE NOTICE 'VERIFY PASS 4: sandbox has no plans and no anchors';
END
$verify$;

-- ------------------------------------------------------------------
-- 5-11.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_attempt_setup uuid := gen_random_uuid();
  v_setup_plan    uuid;
  v_res           record;
  v_before        text;
  v_detail        text;
BEGIN
  -- 5. No plan at all: an adjustment is not allowed.
  PERFORM pg_temp.verify_refused('5 feedback_adjustment without a plan', 'feedback_adjustment',
                                 pg_temp.verify_fp(), '45415', 'plan_operation_not_allowed');

  -- 6. initial_setup: saved; first_plan_at = now(); not an adjustment.
  v_setup_plan := pg_temp.verify_saved('6 initial_setup', 'initial_setup',
                                       pg_temp.verify_fp(), v_attempt_setup);
  PERFORM pg_temp.verify_anchors('6 initial_setup', now(), NULL);

  -- 7. initial_setup again: refused.
  PERFORM pg_temp.verify_refused('7 initial_setup again', 'initial_setup',
                                 pg_temp.verify_fp(), '45415', 'plan_operation_not_allowed');

  -- 8. Replay of step 6, declaring another operation: a pure read.
  v_before := pg_temp.verify_snapshot();
  SELECT * INTO STRICT v_res
    FROM pg_temp.verify_call('feedback_adjustment', pg_temp.verify_fp(), v_attempt_setup, '8 replay');
  IF v_res.o_state IS DISTINCT FROM 'ok' OR v_res.o_replayed IS DISTINCT FROM true
     OR v_res.o_workout_plan_id IS DISTINCT FROM v_setup_plan THEN
    RAISE EXCEPTION 'VERIFY FAIL 8 replay: got state=% replayed=% plan=%, expected ok/true/%',
      v_res.o_state, v_res.o_replayed, v_res.o_workout_plan_id, v_setup_plan;
  END IF;
  IF pg_temp.verify_snapshot() IS DISTINCT FROM v_before
     OR (SELECT w.operation FROM public.workout_plans w WHERE w.id = v_setup_plan)
        IS DISTINCT FROM 'initial_setup' THEN
    RAISE EXCEPTION 'VERIFY FAIL 8 replay: the replay changed state';
  END IF;
  RAISE NOTICE 'VERIFY PASS 8 replay: pure read, anchors and label unchanged';

  -- 9. feedback_adjustment: saved; consumes the allowance.
  PERFORM pg_temp.verify_saved('9 feedback_adjustment', 'feedback_adjustment',
                               pg_temp.verify_fp(), gen_random_uuid());
  PERFORM pg_temp.verify_anchors('9 feedback_adjustment', now(), now());

  -- 10. Again within 7 days: 45414 with the next available time.
  v_detail := pg_temp.verify_refused('10 feedback_adjustment in cooldown', 'feedback_adjustment',
                                     pg_temp.verify_fp(), '45414', 'plan_adjustment_cooldown');
  IF v_detail IS DISTINCT FROM pg_temp.verify_next_available(now()) THEN
    RAISE EXCEPTION 'VERIFY FAIL 10: DETAIL is %, expected %', v_detail, pg_temp.verify_next_available(now());
  END IF;
  RAISE NOTICE 'VERIFY PASS 10: DETAIL %', v_detail;

  -- 11. A wrong token wins over the cooldown: the token check runs first.
  PERFORM pg_temp.verify_refused('11 wrong token in cooldown', 'feedback_adjustment',
                                 'v1:' || repeat('f', 64), '45413', 'plan_safety_profile_changed');
END
$verify$;

-- ------------------------------------------------------------------
-- 12-15.
-- ------------------------------------------------------------------
DO $verify$
BEGIN
  -- 12. Legacy: no operation, no token, during the cooldown. Saved
  --     unverified; anchors untouched.
  PERFORM pg_temp.verify_saved('12 legacy', NULL, NULL, gen_random_uuid());
  PERFORM pg_temp.verify_anchors('12 legacy', now(), now());
  IF pg_temp.verify_status() IS DISTINCT FROM 'unverified' THEN
    RAISE EXCEPTION 'VERIFY FAIL 12: status is %, expected unverified', pg_temp.verify_status();
  END IF;

  -- 13. safety_regeneration without a token: refused.
  PERFORM pg_temp.verify_refused('13 safety_regeneration without a token', 'safety_regeneration',
                                 NULL, '45415', 'plan_operation_not_allowed');

  -- 14. safety_regeneration on an unverified plan, during the cooldown:
  --     saved, and the allowance is untouched.
  PERFORM pg_temp.verify_saved('14 safety_regeneration unverified', 'safety_regeneration',
                               pg_temp.verify_fp(), gen_random_uuid());
  PERFORM pg_temp.verify_anchors('14 safety_regeneration unverified', now(), now());
  IF pg_temp.verify_status() IS DISTINCT FROM 'valid' THEN
    RAISE EXCEPTION 'VERIFY FAIL 14: status is %, expected valid', pg_temp.verify_status();
  END IF;

  -- 15. safety_regeneration on a valid plan: refused.
  PERFORM pg_temp.verify_refused('15 safety_regeneration valid', 'safety_regeneration',
                                 pg_temp.verify_fp(), '45415', 'plan_operation_not_allowed');
END
$verify$;

-- ------------------------------------------------------------------
-- 16. Safety field change (migration role): stale, regeneration allowed.
-- ------------------------------------------------------------------
UPDATE public.profiles
   SET injuries = coalesce(injuries, '') || ' [verify C]'
 WHERE id = current_setting('verify.uid')::uuid;

DO $verify$
BEGIN
  IF pg_temp.verify_status() IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'VERIFY FAIL 16: status is %, expected stale', pg_temp.verify_status();
  END IF;
  PERFORM pg_temp.verify_saved('16 safety_regeneration stale', 'safety_regeneration',
                               pg_temp.verify_fp(), gen_random_uuid());
  PERFORM pg_temp.verify_anchors('16 safety_regeneration stale', now(), now());
END
$verify$;

-- ------------------------------------------------------------------
-- 17. Every plan deactivated (migration role): no_active_plan.
-- ------------------------------------------------------------------
UPDATE public.workout_plans
   SET is_active = false
 WHERE user_id = current_setting('verify.uid')::uuid
   AND is_active IS TRUE;

DO $verify$
BEGIN
  IF pg_temp.verify_status() IS DISTINCT FROM 'no_active_plan' THEN
    RAISE EXCEPTION 'VERIFY FAIL 17: status is %, expected no_active_plan', pg_temp.verify_status();
  END IF;
  PERFORM pg_temp.verify_saved('17 safety_regeneration no_active_plan', 'safety_regeneration',
                               pg_temp.verify_fp(), gen_random_uuid());
  PERFORM pg_temp.verify_anchors('17 safety_regeneration no_active_plan', now(), now());
END
$verify$;

-- ------------------------------------------------------------------
-- 18. Boundary of the rolling 7 days (anchor moved by the migration role).
-- ------------------------------------------------------------------
UPDATE public.profiles
   SET last_plan_adjustment_at = now() - interval '7 days' + interval '1 millisecond'
 WHERE id = current_setting('verify.uid')::uuid;

DO $verify$
DECLARE
  v_detail text;
BEGIN
  v_detail := pg_temp.verify_refused('18a one millisecond inside', 'feedback_adjustment',
                                     pg_temp.verify_fp(), '45414', 'plan_adjustment_cooldown');
  IF v_detail IS DISTINCT FROM
       pg_temp.verify_next_available(now() - interval '7 days' + interval '1 millisecond') THEN
    RAISE EXCEPTION 'VERIFY FAIL 18a: DETAIL is %', v_detail;
  END IF;
END
$verify$;

UPDATE public.profiles
   SET last_plan_adjustment_at = now() - interval '7 days'
 WHERE id = current_setting('verify.uid')::uuid;

DO $verify$
BEGIN
  PERFORM pg_temp.verify_saved('18b exactly 7 days', 'feedback_adjustment',
                               pg_temp.verify_fp(), gen_random_uuid());
  PERFORM pg_temp.verify_anchors('18b exactly 7 days', now(), now());
  RAISE NOTICE 'VERIFY PASS 3-18: every gate branch behaves as specified';
END
$verify$;

ROLLBACK;

-- Nothing persisted. The ROLLBACK above undid the detach of the athlete's
-- plans, every anchor change, the injuries change, every plan inserted, the
-- archiving and deactivation of plans, the temp functions, and every setting
-- of this block.
