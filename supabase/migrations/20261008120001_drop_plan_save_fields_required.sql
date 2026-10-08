-- REVERSE of 20261008120000_plan_save_fields_required.sql.
-- UNEXECUTED. Manual rollback only. Do not supabase db push / migration up.
-- Do not apply together with the forward file or in a sequential migration run.
-- Restores migration C's exact body, signature, defaults, owner and grants.
-- Endpoint d6ca94f can remain deployed: this restores only the RPC's legacy
-- acceptance, not the endpoint's required-field checks. No data changes.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  rpc_oid oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text)');
  n integer;
  fn record;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'migration D precondition failed: expected one eleven-argument RPC';
  END IF;
  SELECT p.*, l.lanname INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;
  IF fn.pronargs <> 11 OR fn.pronargdefaults <> 3
     OR NOT fn.prosecdef OR fn.provolatile <> 'v' OR fn.lanname <> 'plpgsql'
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole
     OR pg_get_function_result(rpc_oid) IS DISTINCT FROM
        'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)'
     OR md5(fn.prosrc) NOT IN ('8a558cb77f1e686e1018f0f66dabd1ea', '7632a294335351a5159c935d19d4032b') THEN
    RAISE EXCEPTION 'migration D precondition failed: RPC differs from migration C or D';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.replace_user_plans_atomic(
  p_user_id uuid,
  p_client_attempt_id uuid,
  p_workout_coach_id text,
  p_workout_plan_type text,
  p_workout_week_start date,
  p_workout_week_number integer,
  p_workout_activate_on date,
  p_workout_plan_data jsonb,
  p_nutrition_plan_data jsonb DEFAULT NULL,
  p_expected_safety_fingerprint text DEFAULT NULL,
  p_operation text DEFAULT NULL)
RETURNS TABLE (workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fnbody$
DECLARE
  v_workout_found   uuid;
  v_nutrition_found uuid;
  v_workout_new     uuid;
  v_nutrition_new   uuid;
  v_profile_safety_fingerprint text;
  v_plan_safety_fingerprint    text;
  v_first_plan_at              timestamptz;
  v_last_plan_adjustment_at    timestamptz;
  v_next_available_at          timestamptz;
  v_has_plan_rows              boolean;
  v_safety_status              text;
  v_safety_plan_id             uuid;
BEGIN
  -- The only two validations that live in the database. Shape validation is the
  -- endpoint's, before any call is made.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'plan_owner_id_required' USING ERRCODE = '22004';
  END IF;

  IF p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'plan_attempt_id_required' USING ERRCODE = '22004';
  END IF;

  -- The declared operation is the client's intent only; the gate below proves
  -- it. TEMPORARY legacy compatibility: NULL (app builds that do not send one)
  -- skips the gate. Close this path (operation mandatory) after the new app
  -- build ships and the minimum version is enforced.
  IF p_operation IS NOT NULL
     AND p_operation NOT IN ('initial_setup', 'feedback_adjustment', 'safety_regeneration') THEN
    RAISE EXCEPTION 'plan_operation_unknown' USING ERRCODE = '22023';
  END IF;

  -- Per-user lock on auth.users, not profiles. The owner id reaches this
  -- function only from a verified token, so the row is guaranteed present by
  -- the authentication path. Reachable only because the definer is postgres:
  -- service_role has no SELECT on auth.users.
  PERFORM 1 FROM auth.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_owner_not_found' USING ERRCODE = '45404';
  END IF;

  -- Read BOTH tables only after the lock is held.
  SELECT w.id INTO v_workout_found
    FROM public.workout_plans w
   WHERE w.user_id = p_user_id
     AND w.client_attempt_id = p_client_attempt_id;

  SELECT n.id INTO v_nutrition_found
    FROM public.nutrition_plans n
   WHERE n.user_id = p_user_id
     AND n.client_attempt_id = p_client_attempt_id;

  -- Impossible pairing: this function always writes workout first, so a
  -- nutrition row without one means the attempt id was used outside this path.
  IF v_workout_found IS NULL AND v_nutrition_found IS NOT NULL THEN
    RAISE EXCEPTION 'plan_attempt_orphan_nutrition' USING ERRCODE = '45410';
  END IF;

  IF v_workout_found IS NOT NULL THEN
    -- Shape must match the original execution, in both directions.
    IF (v_nutrition_found IS NOT NULL) <> (p_nutrition_plan_data IS NOT NULL) THEN
      RAISE EXCEPTION 'plan_attempt_shape_conflict' USING ERRCODE = '45409';
    END IF;

    -- Replay: a pure read. No archive, no insert.
    RETURN QUERY SELECT v_workout_found, v_nutrition_found, true;
    RETURN;
  END IF;

  -- Fresh only, under the auth.users lock, before any write. The replay path
  -- above never reads the fingerprint or the token.
  SELECT p.safety_fingerprint INTO v_profile_safety_fingerprint
    FROM public.profiles p
   WHERE p.id = p_user_id;

  IF v_profile_safety_fingerprint IS NULL THEN
    RAISE EXCEPTION 'plan_owner_safety_fingerprint_missing' USING ERRCODE = '45412';
  END IF;

  -- Optimistic concurrency token: the fingerprint of the profile the plan was
  -- generated from. A mismatch means the safety fields changed since; nothing
  -- has been written yet, so raising here leaves both plan tables untouched.
  IF p_expected_safety_fingerprint IS NOT NULL
     AND p_expected_safety_fingerprint IS DISTINCT FROM v_profile_safety_fingerprint THEN
    RAISE EXCEPTION 'plan_safety_profile_changed' USING ERRCODE = '45413';
  END IF;

  -- The plan stores the value READ from profiles, never the parameter.
  -- TEMPORARY legacy compatibility: a NULL token (app builds that do not send
  -- one) saves the plan with a NULL fingerprint, i.e. unverified. Close this
  -- path (token mandatory) after the new app build ships.
  IF p_expected_safety_fingerprint IS NULL THEN
    v_plan_safety_fingerprint := NULL;
  ELSE
    v_plan_safety_fingerprint := v_profile_safety_fingerprint;
  END IF;

  -- Operation gate. Fresh path only, under the lock, after 45412/45413 and
  -- before any write: a refusal raises with nothing written, so it never
  -- consumes the allowance. Server clock: now() is the transaction start.
  IF p_operation IS NOT NULL THEN
    SELECT p.first_plan_at, p.last_plan_adjustment_at
      INTO v_first_plan_at, v_last_plan_adjustment_at
      FROM public.profiles p
     WHERE p.id = p_user_id;

    v_has_plan_rows := EXISTS (
      SELECT 1 FROM public.workout_plans w WHERE w.user_id = p_user_id);

    IF p_operation = 'initial_setup' THEN
      IF v_first_plan_at IS NOT NULL OR v_has_plan_rows THEN
        RAISE EXCEPTION 'plan_operation_not_allowed' USING ERRCODE = '45415';
      END IF;

    ELSIF p_operation = 'feedback_adjustment' THEN
      IF v_first_plan_at IS NULL AND NOT v_has_plan_rows THEN
        RAISE EXCEPTION 'plan_operation_not_allowed' USING ERRCODE = '45415';
      END IF;

      IF v_last_plan_adjustment_at IS NOT NULL
         AND v_last_plan_adjustment_at > now() - interval '7 days' THEN
        -- Rounded UP to the millisecond, so a retry at the reported time is
        -- never early.
        v_next_available_at := v_last_plan_adjustment_at + interval '7 days';
        IF v_next_available_at > date_trunc('milliseconds', v_next_available_at) THEN
          v_next_available_at := date_trunc('milliseconds', v_next_available_at)
                                 + interval '1 millisecond';
        END IF;
        RAISE EXCEPTION 'plan_adjustment_cooldown' USING
          ERRCODE = '45414',
          DETAIL = to_char(v_next_available_at AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
      END IF;

    ELSIF p_operation = 'safety_regeneration' THEN
      -- Without a token the new plan would be saved unverified, which would
      -- authorize another regeneration: refuse instead.
      IF p_expected_safety_fingerprint IS NULL THEN
        RAISE EXCEPTION 'plan_operation_not_allowed' USING ERRCODE = '45415';
      END IF;

      -- A COPY of get_active_plan_safety_status()'s query, keyed on the
      -- verified owner id. That function reads auth.uid(), which is NULL
      -- here (service_role), so it cannot be called. Only the caller CTE
      -- differs; the rest must stay identical to the gate function.
      WITH caller AS (
        SELECT p_user_id AS uid
      ),
      profile AS (
        SELECT p.safety_fingerprint
          FROM public.profiles p
          JOIN caller c ON p.id = c.uid
      ),
      active AS (
        SELECT w.id, w.safety_fingerprint
          FROM public.workout_plans w
          JOIN caller c ON w.user_id = c.uid
         WHERE w.is_active IS TRUE
      ),
      summary AS (
        SELECT (SELECT pr.safety_fingerprint FROM profile pr) AS profile_fp,
               (SELECT count(*) FROM active) AS n_active
      )
      SELECT
        CASE
          WHEN s.profile_fp IS NULL THEN 'profile_unavailable'
          WHEN s.n_active = 0 THEN 'no_active_plan'
          WHEN s.n_active > 1 THEN 'invalid_multiple_active_plans'
          WHEN a.safety_fingerprint IS NULL THEN 'unverified'
          WHEN a.safety_fingerprint IS DISTINCT FROM s.profile_fp THEN 'stale'
          ELSE 'valid'
        END AS status,
        CASE
          WHEN s.profile_fp IS NOT NULL AND s.n_active = 1 THEN a.id
        END AS plan_id
        FROM summary s
        LEFT JOIN active a ON s.n_active = 1
        INTO v_safety_status, v_safety_plan_id;

      IF v_safety_status IS NULL
         OR v_safety_status NOT IN ('stale', 'unverified', 'no_active_plan',
                                    'invalid_multiple_active_plans') THEN
        RAISE EXCEPTION 'plan_operation_not_allowed' USING ERRCODE = '45415';
      END IF;
    END IF;
  END IF;

  -- Fresh. Workout first, always. Only rows that are actually active are
  -- archived: false and NULL are left exactly as they are.
  UPDATE public.workout_plans
     SET is_active = false
   WHERE user_id = p_user_id
     AND is_active IS TRUE;

  INSERT INTO public.workout_plans
    (user_id, coach_id, plan_type, week_start, week_number, activate_on,
     plan_data, is_active, client_attempt_id, safety_fingerprint, operation)
  VALUES
    (p_user_id, p_workout_coach_id, p_workout_plan_type, p_workout_week_start,
     p_workout_week_number, p_workout_activate_on, p_workout_plan_data, true,
     p_client_attempt_id, v_plan_safety_fingerprint, p_operation)
  RETURNING id INTO v_workout_new;

  -- Absent nutrition is SQL NULL, and it leaves nutrition_plans untouched.
  IF p_nutrition_plan_data IS NOT NULL THEN
    UPDATE public.nutrition_plans
       SET is_active = false
     WHERE user_id = p_user_id
       AND is_active IS TRUE;

    INSERT INTO public.nutrition_plans
      (user_id, plan_data, is_active, client_attempt_id)
    VALUES
      (p_user_id, p_nutrition_plan_data, true, p_client_attempt_id)
    RETURNING id INTO v_nutrition_new;
  END IF;

  -- Anchors, on every fresh write, after both plan writes. first_plan_at is
  -- set once and never moved. Only a feedback_adjustment consumes the 7-day
  -- allowance; initial_setup, safety_regeneration and legacy (NULL) saves
  -- never do.
  UPDATE public.profiles
     SET first_plan_at = COALESCE(first_plan_at, now()),
         last_plan_adjustment_at = CASE
           WHEN p_operation = 'feedback_adjustment' THEN now()
           ELSE last_plan_adjustment_at
         END
   WHERE id = p_user_id;

  RETURN QUERY SELECT v_workout_new, v_nutrition_new, false;
END;
$fnbody$;

ALTER FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text) TO service_role;

DO $check$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(
      'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text)'))
      IS DISTINCT FROM '8a558cb77f1e686e1018f0f66dabd1ea' THEN
    RAISE EXCEPTION 'migration D body postcondition failed';
  END IF;
END
$check$;

COMMIT;

