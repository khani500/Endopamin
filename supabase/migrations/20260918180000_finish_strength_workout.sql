-- finish_strength_workout
--
-- This function is the strength-workout finish path. The mobile client will
-- call it once with the completed sets, a finish timestamp, and the athlete's
-- IANA timezone. The function counts the sets, decides XP / calories / streak
-- on the server, writes one workout_logs row, and only then updates
-- profiles and weekly_snapshots.
--
-- Once the client is migrated, this is the only intended writer of workout XP
-- for a strength finish. Narrowing the client's direct write access on
-- profiles / workout_logs is a SEPARATE later migration. This file does not
-- revoke those grants. Old builds must keep working until they update.
--
-- The workout_logs row itself is the record that XP was granted. There is no
-- new "already awarded" column. Same user + same client_attempt_id → the
-- insert is skipped, rewards are not applied again, and the caller gets
-- outcome = 'replayed' with xp_awarded = 0.
--
-- Personal records are not written here. They stay on the client.
--
-- Idempotent: CREATE OR REPLACE replaces the body; GRANT / REVOKE can be
-- repeated without changing the privilege end-state.
--
-- Latest prior file in this folder: 20260918060001_drop_onboarding_completed_latch.sql

CREATE OR REPLACE FUNCTION public.finish_strength_workout(
  p_client_attempt_id uuid,
  p_finished_at       timestamptz,
  p_timezone          text,
  p_duration_seconds  integer,
  p_sets              jsonb,
  p_plan_id           uuid DEFAULT NULL,
  p_day_index         smallint DEFAULT NULL
)
RETURNS TABLE (
  outcome           text,
  workout_log_id    uuid,
  workout_xp        integer,
  streak_xp         integer,
  xp_awarded        integer,
  sets_completed    integer,
  calories_burned   integer,
  duration_minutes  integer,
  streak_count      integer,
  last_active       date,
  dopa_xp           integer,
  dopa_level        integer,
  leveled_up        boolean,
  logged_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- Who is calling. Taken from the JWT, never from a parameter.
  v_user uuid;

  -- The athlete's calendar day in the timezone they sent, derived from
  -- p_finished_at (the workout's end), not from "right now". A later retry
  -- with the same finish timestamp therefore lands on the same local date.
  v_local_date date;
  v_week_start date;

  -- Locked profile values. FOR UPDATE means a second finish for this athlete
  -- waits until this one finishes, so two sessions cannot overwrite XP.
  v_profile public.profiles%ROWTYPE;
  v_old_xp integer;
  v_old_level integer;
  v_new_xp integer;
  v_new_level integer;
  v_new_streak integer;
  v_last_active date;
  v_leveled_up boolean;

  -- Derived from p_sets / the owned plan. Never taken from the client as
  -- numbers (no client XP, no client calorie count, no client set count).
  v_sets_completed integer;
  v_planned_total integer := 0;
  v_workout_xp integer;
  v_streak_xp integer;
  v_xp_awarded integer;
  v_calories integer;
  v_duration_minutes integer;
  v_plan_data jsonb;
  v_day jsonb;
  v_ex jsonb;
  v_sets_text text;
  v_int_match text;
  v_this_sets integer;

  -- The log row we just inserted, or the one we found on replay.
  v_log_id uuid;
  v_existing public.workout_logs%ROWTYPE;
BEGIN
  -- ------------------------------------------------------------------
  -- 1. Identity. auth.uid() reads the JWT. No JWT → not logged in.
  --    ERRCODE 22023 is PostgreSQL's "invalid_parameter_value".
  -- ------------------------------------------------------------------
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'finish_strength_workout: unauthenticated'
      USING ERRCODE = '22023';
  END IF;

  -- The attempt id is the replay key. The column is NOT NULL in the
  -- signature, but a client can still send an explicit JSON null.
  IF p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'finish_strength_workout: missing_attempt_id'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- 2. Validate the payload. Every failure uses 22023 and the same
  --    message prefix so the client can treat them as "save failed".
  -- ------------------------------------------------------------------
  IF p_sets IS NULL OR jsonb_typeof(p_sets) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'finish_strength_workout: p_sets must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  -- jsonb_array_length = how many elements are in the array.
  -- Zero sets is rejected. More than 100 sets is rejected.
  IF jsonb_array_length(p_sets) < 1 OR jsonb_array_length(p_sets) > 100 THEN
    RAISE EXCEPTION 'finish_strength_workout: p_sets length must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  IF p_finished_at IS NULL THEN
    RAISE EXCEPTION 'finish_strength_workout: p_finished_at is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_duration_seconds IS NULL OR p_duration_seconds < 0 THEN
    RAISE EXCEPTION 'finish_strength_workout: p_duration_seconds must be >= 0'
      USING ERRCODE = '22023';
  END IF;

  -- pg_timezone_names is Postgres's list of real IANA zone names
  -- (e.g. America/Los_Angeles). An invented string is rejected here so
  -- AT TIME ZONE below cannot silently do the wrong thing.
  IF p_timezone IS NULL
     OR btrim(p_timezone) = ''
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_timezone_names z
       WHERE z.name = p_timezone
     )
  THEN
    RAISE EXCEPTION 'finish_strength_workout: p_timezone is not a recognized IANA timezone'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- 3. Local date and Monday week start, from the finish timestamp.
  --
  --    timestamptz AT TIME ZONE zone → the wall-clock timestamp in that
  --    zone (no timezone attached). Casting that to date is the athlete's
  --    local calendar day.
  --
  --    date_trunc('week', ...) in PostgreSQL uses the ISO week: the week
  --    starts on Monday. Casting back to date gives that Monday.
  -- ------------------------------------------------------------------
  v_local_date := (p_finished_at AT TIME ZONE p_timezone)::date;
  v_week_start := date_trunc('week', v_local_date)::date;

  -- ------------------------------------------------------------------
  -- 4. Lock the profile row. If this athlete has no profiles row, stop.
  -- ------------------------------------------------------------------
  SELECT *
    INTO v_profile
    FROM public.profiles
   WHERE id = v_user
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finish_strength_workout: profile not found'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------
  -- 5. Compute amounts. Do not write yet.
  -- ------------------------------------------------------------------
  v_sets_completed := jsonb_array_length(p_sets);

  -- Planned total sets for the completion bonus.
  -- Mirror of EndopaminMobile mapPlanDayToSession + parseSets:
  --   keep exercises whose name is non-empty AND sets !== '-'
  --   then sum parseSets(ex.sets)
  -- parseSets (workoutUtils.js):
  --   if sets == null || sets === '-' return 1
  --   n = parseInt(String(sets), 10)
  --   return Number.isFinite(n) && n > 0 ? n : 1
  -- A workout with no plan_id is accepted but earns no plan bonus.
  -- A plan_id that is not this athlete's plan also earns no bonus.
  IF p_plan_id IS NOT NULL AND p_day_index IS NOT NULL AND p_day_index >= 0 THEN
    SELECT wp.plan_data
      INTO v_plan_data
      FROM public.workout_plans wp
     WHERE wp.id = p_plan_id
       AND wp.user_id = v_user;

    IF FOUND THEN
      -- -> with an integer is "the Nth element of a JSON array" (0-based),
      -- the same index space as plan_data.days[p_day_index].
      v_day := v_plan_data -> 'days' -> p_day_index;

      IF v_day IS NOT NULL AND jsonb_typeof(v_day -> 'exercises') = 'array' THEN
        FOR v_ex IN
          SELECT value
            FROM jsonb_array_elements(v_day -> 'exercises')
        LOOP
          -- JS: ex.name must be truthy. Empty string / missing → skip.
          IF COALESCE(v_ex->>'name', '') = '' THEN
            CONTINUE;
          END IF;

          -- JS: filter drops rows whose sets is the placeholder '-'.
          IF v_ex->>'sets' = '-' THEN
            CONTINUE;
          END IF;

          -- parseSets. Missing / JSON null → 1 (the function's default).
          IF v_ex->'sets' IS NULL OR v_ex->'sets' = 'null'::jsonb THEN
            v_this_sets := 1;
          ELSE
            -- parseInt(String(sets), 10) reads a leading signed integer
            -- and stops at the first non-digit ('10 sets' → 10).
            v_sets_text := btrim(v_ex->>'sets');
            v_int_match := (regexp_match(v_sets_text, '^[+-]?[0-9]+'))[1];
            IF v_int_match IS NULL THEN
              v_this_sets := 1;
            ELSIF v_int_match::integer > 0 THEN
              v_this_sets := v_int_match::integer;
            ELSE
              v_this_sets := 1;
            END IF;
          END IF;

          v_planned_total := v_planned_total + v_this_sets;
        END LOOP;
      END IF;
    END IF;
  END IF;

  -- calcWorkoutXp (EndopaminMobile/src/lib/workoutUtils.js):
  --   const setXp = setsCompleted * 10;
  --   const bonus = totalSets > 0 && setsCompleted >= totalSets ? 50 : 0;
  --   return setXp + bonus;
  -- The 50 is added ONLY when there is a plan_id, that plan belongs to
  -- this user (already enforced by the SELECT above), the planned total
  -- is > 0, and the submitted set count meets that total.
  v_workout_xp := v_sets_completed * 10;
  IF p_plan_id IS NOT NULL
     AND v_planned_total > 0
     AND v_sets_completed >= v_planned_total
  THEN
    v_workout_xp := v_workout_xp + 50;
  END IF;

  -- estimateCalories (EndopaminMobile/src/lib/workoutUtils.js):
  --   export function estimateCalories(sessionSeconds, setsCompleted) {
  --     const minutes = sessionSeconds / 60;
  --     return Math.round(minutes * 7 + setsCompleted * 8);
  --   }
  -- numeric ROUND on a non-negative value matches JS Math.round
  -- (half away from zero / half up). We use numeric, not float8, so
  -- 90/60*7 is exactly 10.5 and does not drift in binary float.
  v_calories := ROUND(
    (p_duration_seconds::numeric / 60) * 7
    + v_sets_completed * 8
  )::integer;

  -- What the client stores on the log today
  -- (WorkoutSessionScreen.finishWorkout):
  --   Math.max(1, Math.round(sessionSeconds / 60))
  v_duration_minutes := GREATEST(
    1,
    ROUND(p_duration_seconds::numeric / 60)
  )::integer;

  -- Streak, from the athlete's LOCAL day (v_local_date above).
  --   last_active = today      → streak unchanged, streak_xp = 0
  --   last_active = yesterday  → streak + 1
  --   anything else (gap/null) → streak = 1
  -- streak_xp = 50 + new_streak * 5 only when the streak moved.
  -- Same formula as EndopaminMobile/src/hooks/useStreak.js:
  --   const xpGained = 50 + newStreak * 5;
  v_last_active := v_profile.last_active;
  v_new_streak := COALESCE(v_profile.streak_count, 0);

  IF v_last_active IS NOT DISTINCT FROM v_local_date THEN
    v_streak_xp := 0;
  ELSIF v_last_active IS NOT DISTINCT FROM (v_local_date - 1) THEN
    v_new_streak := v_new_streak + 1;
    v_streak_xp := 50 + v_new_streak * 5;
    v_last_active := v_local_date;
  ELSE
    v_new_streak := 1;
    v_streak_xp := 50 + v_new_streak * 5;
    v_last_active := v_local_date;
  END IF;

  v_xp_awarded := v_workout_xp + v_streak_xp;

  -- calcLevel (EndopaminMobile/src/lib/workoutUtils.js):
  --   export function calcLevel(xp) {
  --     return Math.floor(xp / 500) + 1;
  --   }
  -- useStreak.js uses the same arithmetic:
  --   const newLevel = Math.floor(newXP / 500) + 1;
  -- There is no discrepancy between the two client sites.
  v_old_xp := COALESCE(v_profile.dopa_xp, 0);
  v_old_level := COALESCE(
    v_profile.dopa_level,
    (FLOOR(v_old_xp::numeric / 500) + 1)::integer
  );
  v_new_xp := v_old_xp + v_xp_awarded;
  v_new_level := (FLOOR(v_new_xp::numeric / 500) + 1)::integer;
  v_leveled_up := v_new_level > v_old_level;

  -- ------------------------------------------------------------------
  -- 6. Insert the log (the grant record). ON CONFLICT DO NOTHING is
  --    "if this attempt was already saved, do not insert a second row".
  --    The WHERE clause is required because the unique index is partial:
  --    it only applies when client_attempt_id is not null.
  -- ------------------------------------------------------------------
  v_log_id := NULL;

  INSERT INTO public.workout_logs (
    user_id,
    workout_type,
    duration_minutes,
    exercises,
    calories_burned,
    coach_feedback,
    logged_at,
    plan_id,
    day_index,
    client_attempt_id
  ) VALUES (
    v_user,
    'strength',
    v_duration_minutes,
    jsonb_build_object(
      'sets', p_sets,
      'sets_completed', v_sets_completed,
      'xp_earned', v_workout_xp,
      'streak_xp', v_streak_xp,
      'duration_seconds', p_duration_seconds,
      'planned_total_sets', v_planned_total
    ),
    v_calories,
    -- Same string the client writes today.
    '+' || v_workout_xp::text || ' ENDO SCORE',
    p_finished_at,
    p_plan_id,
    p_day_index,
    p_client_attempt_id
  )
  ON CONFLICT (user_id, client_attempt_id)
    WHERE client_attempt_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_log_id;

  -- ------------------------------------------------------------------
  -- 7. REPLAY: the insert created no row. This attempt was already saved.
  --    Return the stored result. Write nothing else. xp_awarded = 0.
  -- ------------------------------------------------------------------
  IF v_log_id IS NULL THEN
    SELECT *
      INTO STRICT v_existing
      FROM public.workout_logs
     WHERE user_id = v_user
       AND client_attempt_id = p_client_attempt_id;

    -- Re-read the locked profile so we return what is on the row now
    -- (the first-save transaction already applied rewards).
    SELECT *
      INTO v_profile
      FROM public.profiles
     WHERE id = v_user;

    outcome := 'replayed';
    workout_log_id := v_existing.id;
    workout_xp := COALESCE((v_existing.exercises->>'xp_earned')::integer, 0);
    streak_xp := COALESCE((v_existing.exercises->>'streak_xp')::integer, 0);
    xp_awarded := 0;
    sets_completed := COALESCE(
      (v_existing.exercises->>'sets_completed')::integer,
      CASE
        WHEN jsonb_typeof(v_existing.exercises -> 'sets') = 'array'
          THEN jsonb_array_length(v_existing.exercises -> 'sets')
        ELSE 0
      END
    );
    calories_burned := COALESCE(v_existing.calories_burned, 0);
    duration_minutes := COALESCE(v_existing.duration_minutes, 0);
    streak_count := COALESCE(v_profile.streak_count, 0);
    last_active := v_profile.last_active;
    dopa_xp := COALESCE(v_profile.dopa_xp, 0);
    dopa_level := COALESCE(v_profile.dopa_level, 1);
    leveled_up := false;
    logged_at := v_existing.logged_at;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ------------------------------------------------------------------
  -- 8. CREATED: the log row is the grant record. Now apply rewards.
  --    If either write fails, the whole call rolls back — including the
  --    insert — so a retry can take the first-save path again.
  -- ------------------------------------------------------------------
  UPDATE public.profiles
     SET dopa_xp = v_new_xp,
         dopa_level = v_new_level,
         streak_count = v_new_streak,
         last_active = v_last_active
   WHERE id = v_user;

  -- ADD xp_earned and workouts_completed to any existing week row.
  -- REPLACE streak_count with the post-call streak.
  -- ON CONFLICT targets weekly_snapshots_user_id_week_start_key.
  INSERT INTO public.weekly_snapshots (
    id,
    user_id,
    week_start,
    xp_earned,
    streak_count,
    workouts_completed,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_user,
    v_week_start,
    v_xp_awarded,
    v_new_streak,
    1,
    now()
  )
  ON CONFLICT (user_id, week_start)
  DO UPDATE SET
    xp_earned = COALESCE(public.weekly_snapshots.xp_earned, 0)
                + EXCLUDED.xp_earned,
    workouts_completed = COALESCE(public.weekly_snapshots.workouts_completed, 0)
                         + EXCLUDED.workouts_completed,
    streak_count = EXCLUDED.streak_count;

  outcome := 'created';
  workout_log_id := v_log_id;
  workout_xp := v_workout_xp;
  streak_xp := v_streak_xp;
  xp_awarded := v_xp_awarded;
  sets_completed := v_sets_completed;
  calories_burned := v_calories;
  duration_minutes := v_duration_minutes;
  streak_count := v_new_streak;
  last_active := v_last_active;
  dopa_xp := v_new_xp;
  dopa_level := v_new_level;
  leveled_up := v_leveled_up;
  logged_at := p_finished_at;
  RETURN NEXT;
  RETURN;
END;
$function$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default.
-- REVOKE / GRANT are safe to repeat: a second run leaves the same state.
REVOKE ALL ON FUNCTION public.finish_strength_workout(
  uuid, timestamptz, text, integer, jsonb, uuid, smallint
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.finish_strength_workout(
  uuid, timestamptz, text, integer, jsonb, uuid, smallint
) FROM anon;

GRANT EXECUTE ON FUNCTION public.finish_strength_workout(
  uuid, timestamptz, text, integer, jsonb, uuid, smallint
) TO authenticated;
