-- NOT A MIGRATION. Scratch verification only. Do not apply with
-- supabase db push / migration up. The filename has no timestamp on
-- purpose. Do not run this from the task that authored it.
--
-- What this block shows, then undoes:
--   1. Impersonate an athlete JWT (auth.uid() = that profiles.id).
--   2. Call finish_strength_workout twice with the SAME client_attempt_id.
--   3. First call → outcome 'created', profiles.dopa_xp moves once.
--   4. Second call → outcome 'replayed', xp_awarded = 0, dopa_xp unchanged.
--   5. ROLLBACK so no production row remains.
--
-- Before running: replace the uuid in set_config('verify.uid', ...) with a
-- sacrificial public.profiles.id you control. Never use a real athlete.

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
END
$verify$;

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

-- One attempt id for both calls. Generated here so it cannot collide
-- with a log row that already exists for this user.
SELECT set_config('verify.attempt', gen_random_uuid()::text, true);

-- Function return rows only. Do not store a profiles.dopa_xp read here.
--
-- MVCC snapshot: every subquery in one SQL statement sees the same
-- snapshot, taken before that statement began. A correlated
--   (SELECT dopa_xp FROM profiles ...)
-- inside the same INSERT ... SELECT that calls finish_strength_workout
-- therefore returns the pre-call value even though the function already
-- updated the row. That produced:
--   VERIFY FAIL: profiles.dopa_xp did not move on the first call (0 -> 0)
-- while a later standalone SELECT showed 65. Measure the profile in a
-- separate statement after the call statement has completed.
CREATE TEMP TABLE verify_finish_calls (
  call_n integer PRIMARY KEY,
  outcome text,
  workout_log_id uuid,
  xp_awarded integer,
  workout_xp integer,
  streak_xp integer,
  dopa_xp integer
) ON COMMIT DROP;

CREATE TEMP TABLE verify_xp_before (
  dopa_xp integer NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE verify_xp_after (
  call_n integer PRIMARY KEY,
  dopa_xp integer NOT NULL
) ON COMMIT DROP;

-- Snapshot dopa_xp before any call. Its own statement.
INSERT INTO verify_xp_before (dopa_xp)
SELECT COALESCE(dopa_xp, 0)
  FROM public.profiles
 WHERE id = current_setting('verify.uid')::uuid;

-- First call: should create the log and move XP.
-- This statement captures only the function's returned row.
INSERT INTO verify_finish_calls (
  call_n, outcome, workout_log_id, xp_awarded, workout_xp, streak_xp, dopa_xp
)
SELECT
  1,
  r.outcome,
  r.workout_log_id,
  r.xp_awarded,
  r.workout_xp,
  r.streak_xp,
  r.dopa_xp
FROM public.finish_strength_workout(
  p_client_attempt_id := current_setting('verify.attempt')::uuid,
  p_finished_at       := timestamptz '2026-09-18 18:00:00-07',
  p_timezone          := 'America/Los_Angeles',
  p_duration_seconds  := 600,
  p_sets              := '[{"exercise":"VERIFY squat","set":1,"weight":100,"reps":5}]'::jsonb,
  p_plan_id           := NULL,
  p_day_index         := NULL
) AS r;

-- Profile read AFTER the first call statement has completed.
INSERT INTO verify_xp_after (call_n, dopa_xp)
SELECT 1, COALESCE(dopa_xp, 0)
  FROM public.profiles
 WHERE id = current_setting('verify.uid')::uuid;

-- Second call: same attempt id. Must replay and award nothing.
INSERT INTO verify_finish_calls (
  call_n, outcome, workout_log_id, xp_awarded, workout_xp, streak_xp, dopa_xp
)
SELECT
  2,
  r.outcome,
  r.workout_log_id,
  r.xp_awarded,
  r.workout_xp,
  r.streak_xp,
  r.dopa_xp
FROM public.finish_strength_workout(
  p_client_attempt_id := current_setting('verify.attempt')::uuid,
  p_finished_at       := timestamptz '2026-09-18 18:00:00-07',
  p_timezone          := 'America/Los_Angeles',
  p_duration_seconds  := 600,
  p_sets              := '[{"exercise":"VERIFY squat","set":1,"weight":100,"reps":5}]'::jsonb,
  p_plan_id           := NULL,
  p_day_index         := NULL
) AS r;

-- Profile read AFTER the second call statement has completed.
INSERT INTO verify_xp_after (call_n, dopa_xp)
SELECT 2, COALESCE(dopa_xp, 0)
  FROM public.profiles
 WHERE id = current_setting('verify.uid')::uuid;

-- The two call rows, for the operator to read.
SELECT * FROM verify_finish_calls ORDER BY call_n;

-- Profile XP moved on the first call only.
SELECT
  b.dopa_xp AS dopa_xp_before,
  a1.dopa_xp AS dopa_xp_after_first,
  a2.dopa_xp AS dopa_xp_after_second,
  a1.dopa_xp - b.dopa_xp AS dopa_xp_moved_on_first,
  a2.dopa_xp - a1.dopa_xp AS dopa_xp_moved_on_second
FROM verify_xp_before b
CROSS JOIN verify_xp_after a1
CROSS JOIN verify_xp_after a2
WHERE a1.call_n = 1
  AND a2.call_n = 2;

-- All of these must hold or the block raises. Then ROLLBACK.
DO $assert$
DECLARE
  v_first verify_finish_calls%ROWTYPE;
  v_second verify_finish_calls%ROWTYPE;
  v_xp_before integer;
  v_xp_after_first integer;
  v_xp_after_second integer;
  v_uid uuid := current_setting('verify.uid')::uuid;
  v_attempt uuid := current_setting('verify.attempt')::uuid;
  v_log_count integer;
BEGIN
  SELECT * INTO STRICT v_first  FROM verify_finish_calls WHERE call_n = 1;
  SELECT * INTO STRICT v_second FROM verify_finish_calls WHERE call_n = 2;
  SELECT dopa_xp INTO STRICT v_xp_before FROM verify_xp_before;
  SELECT dopa_xp INTO STRICT v_xp_after_first  FROM verify_xp_after WHERE call_n = 1;
  SELECT dopa_xp INTO STRICT v_xp_after_second FROM verify_xp_after WHERE call_n = 2;

  IF v_first.outcome IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'VERIFY FAIL: first outcome=% (expected created)', v_first.outcome;
  END IF;

  IF v_second.outcome IS DISTINCT FROM 'replayed' THEN
    RAISE EXCEPTION 'VERIFY FAIL: second outcome=% (expected replayed)', v_second.outcome;
  END IF;

  IF v_second.xp_awarded IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: second xp_awarded=% (expected 0)', v_second.xp_awarded;
  END IF;

  IF v_xp_after_first = v_xp_before THEN
    RAISE EXCEPTION
      'VERIFY FAIL: profiles.dopa_xp did not move on the first call (% → %)',
      v_xp_before, v_xp_after_first;
  END IF;

  IF v_xp_after_first IS DISTINCT FROM (v_xp_before + v_first.xp_awarded) THEN
    RAISE EXCEPTION
      'VERIFY FAIL: dopa_xp moved by %, but first xp_awarded was %',
      v_xp_after_first - v_xp_before,
      v_first.xp_awarded;
  END IF;

  IF v_xp_after_second IS DISTINCT FROM v_xp_after_first THEN
    RAISE EXCEPTION
      'VERIFY FAIL: profiles.dopa_xp moved again on replay (% → %)',
      v_xp_after_first, v_xp_after_second;
  END IF;

  IF v_first.workout_log_id IS DISTINCT FROM v_second.workout_log_id THEN
    RAISE EXCEPTION 'VERIFY FAIL: replay returned a different workout_log_id';
  END IF;

  IF v_first.dopa_xp IS DISTINCT FROM v_xp_after_first THEN
    RAISE EXCEPTION
      'VERIFY FAIL: first returned dopa_xp=% but profiles.dopa_xp afterwards was %',
      v_first.dopa_xp, v_xp_after_first;
  END IF;

  SELECT COUNT(*)
    INTO v_log_count
    FROM public.workout_logs
   WHERE user_id = v_uid
     AND client_attempt_id = v_attempt;

  IF v_log_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: expected 1 workout_logs row, found %', v_log_count;
  END IF;

  RAISE NOTICE 'VERIFY PASS: created then replayed; dopa_xp % → % once; second xp_awarded=0; one log row',
    v_xp_before, v_xp_after_first;
END
$assert$;

ROLLBACK;
