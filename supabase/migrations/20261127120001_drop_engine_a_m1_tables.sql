-- 20261127120001_drop_engine_a_m1_tables.sql
-- DRAFT v5. Run ONLY to undo 20261127120000_engine_a_m1_tables.sql.
-- Manual rollback only. Never part of a sequential migration run.
-- Prerequisite: M2, M3 and M4 are already rolled back, and the Server
-- deployment no longer calls any Engine A path.
--
-- Refuses unless all of these hold (design v2 section 5):
--   - the control singleton exists, state 'off', admission disabled;
--   - no M2 marker: no Engine A column on workout_plans, workout_logs or
--     profiles, and no FK from an M1 table to workout_plans;
--   - no M3 marker: no plan_save_gate, engine_a_save_plan or
--     finish_engine_a_workout; replace_user_plans_atomic has no
--     p_route_decision_id; no routine outside the 9 M1 functions, in any
--     non-system schema, whose body names an M1 object (PostgreSQL does not
--     record dependencies inside string-bodied routines, so DROP would not
--     catch a surviving wrapper); no policy, view or default naming them;
--   - rollback ledger, replayed here row by row under the ledger lock (the
--     insert trigger is not trusted for stored rows): the first row is the
--     only M1 row, 'applied', with a routine baseline; every later row is a
--     valid ordered transition; every M2 'dropped' row has all four counts
--     as JSON numbers equal to 0; at the end no step after M1 is applied.
--     An M1-only ledger passes;
--   - the routines baselined at M1 apply (replace_user_plans_atomic,
--     finish_strength_workout, get_active_plan_safety_status) match the
--     baseline exactly: same overloads, full-definition sha256 under a pinned
--     search_path, owner and normalized ACL;
--   - writers are fenced: workout_plans is held in SHARE mode through COMMIT,
--     so no plan can be written between the data guard and the drop;
--   - no surviving v2 data: no workout_plans row with plan_data source
--     'engine_a' or planSchemaVersion 2, no schedule revision, no v2 PR, no
--     open attempt and no committed Engine A attempt.
-- DATA LOSS when it proceeds: releases, QA accounts, de-list history,
-- control history, closed attempts and the decision log are removed.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- Lock order: ledger first (the order every ledger writer uses), then the
-- plan writer fence, then the M1 tables.
LOCK TABLE public.engine_a_migration_events IN EXCLUSIVE MODE;
LOCK TABLE public.workout_plans IN SHARE MODE;
LOCK TABLE public.engine_a_control, public.engine_a_attempts,
           public.engine_a_decisions, public.engine_a_schedule_revisions,
           public.engine_a_schedule_offers, public.exercise_personal_records
  IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
  v text;
  base jsonb;
  r record;
  st jsonb;
  steps text[] := ARRAY['M1','M2','M3','M4','M5'];
  i integer;
  cur text;
  prev text;
  nxt text;
  k text;
BEGIN
  -- Control: must exist, exactly one row, off, admission disabled.
  IF (SELECT count(*) FROM public.engine_a_control) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.engine_a_control
                     WHERE id = 1 AND state = 'off' AND NOT admission_enabled) THEN
    RAISE EXCEPTION 'rollback refused: control singleton missing, not off, or admission enabled';
  END IF;

  -- Rollback ledger replay.
  FOR r IN SELECT e.id, e.step, e.action, e.evidence
             FROM public.engine_a_migration_events e ORDER BY e.id LOOP
    IF st IS NULL THEN
      IF r.step <> 'M1' OR r.action <> 'applied'
         OR jsonb_typeof(r.evidence -> 'routines') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'rollback refused: ledger row % is not the M1 baseline', r.id;
      END IF;
      st := jsonb_build_object('M1', 'applied');
      CONTINUE;
    END IF;
    IF r.step = 'M1' THEN
      RAISE EXCEPTION 'rollback refused: ledger row % is a second M1 row', r.id;
    END IF;
    i := array_position(steps, r.step);
    cur  := st ->> r.step;
    prev := st ->> steps[i - 1];
    nxt  := CASE WHEN i < 5 THEN st ->> steps[i + 1] END;
    IF r.action = 'applied' THEN
      IF cur IS NOT DISTINCT FROM 'applied' OR prev IS DISTINCT FROM 'applied' THEN
        RAISE EXCEPTION 'rollback refused: ledger row % applies % out of order', r.id, r.step;
      END IF;
    ELSE
      IF cur IS DISTINCT FROM 'applied' OR nxt IS NOT DISTINCT FROM 'applied' THEN
        RAISE EXCEPTION 'rollback refused: ledger row % drops % out of order', r.id, r.step;
      END IF;
      IF r.step = 'M2' THEN
        FOREACH k IN ARRAY ARRAY['engine_a_plans','engine_a_logs',
                                 'engine_a_schedule_revisions','v2_personal_records'] LOOP
          IF jsonb_typeof(r.evidence -> k) IS DISTINCT FROM 'number'
             OR (r.evidence ->> k)::numeric <> 0 THEN
            RAISE EXCEPTION 'rollback refused: M2 drop evidence in ledger row % lacks % = 0', r.id, k;
          END IF;
        END LOOP;
      END IF;
    END IF;
    st := st || jsonb_build_object(r.step, r.action);
  END LOOP;
  IF st IS NULL THEN
    RAISE EXCEPTION 'rollback refused: ledger has no M1 baseline row';
  END IF;
  SELECT string_agg(key, ', ' ORDER BY key) INTO v
    FROM jsonb_each_text(st) WHERE key <> 'M1' AND value = 'applied';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'rollback refused: steps still applied per ledger (%); drop them first', v;
  END IF;

  -- Routine baseline recorded at M1 apply.
  SELECT evidence -> 'routines' INTO base FROM public.engine_a_migration_events
   WHERE step = 'M1' AND action = 'applied';
  IF public.engine_a_routine_baseline() IS DISTINCT FROM base THEN
    RAISE EXCEPTION 'rollback refused: plan-writing routines differ from the M1 baseline; restore them first';
  END IF;

  -- M2 markers.
  SELECT string_agg(a.attrelid::regclass::text || '.' || a.attname, ', ') INTO v
    FROM pg_attribute a
   WHERE a.attrelid IN (to_regclass('public.workout_plans'), to_regclass('public.workout_logs'),
                        to_regclass('public.profiles'))
     AND NOT a.attisdropped
     AND a.attname IN ('plan_source','plan_schema_version','content_revision','schedule_revision',
                       'release_id','manifest_sha256','eligibility_id','planning_revision',
                       'attempt_digest','session_index');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'rollback refused: M2 columns exist (%); drop M2 first', v;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.contype = 'f' AND c.confrelid = to_regclass('public.workout_plans')
                AND c.conrelid IN (to_regclass('public.engine_a_schedule_revisions'),
                                   to_regclass('public.engine_a_schedule_offers'))) THEN
    RAISE EXCEPTION 'rollback refused: M2 foreign keys to workout_plans exist; drop M2 first';
  END IF;

  -- M3 markers.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog','information_schema')
     AND n.nspname NOT LIKE 'pg\_%'
     AND p.oid NOT IN ('public.engine_a_valid_weekdays(smallint[])'::regprocedure,'public.engine_a_forbid_change()'::regprocedure,'public.engine_a_release_guard()'::regprocedure,'public.engine_a_control_stamp()'::regprocedure,'public.engine_a_control_log()'::regprocedure,'public.engine_a_delist_log()'::regprocedure,'public.engine_a_attempt_guard()'::regprocedure,'public.engine_a_offer_guard()'::regprocedure,'public.engine_a_purge_decisions()'::regprocedure,'public.engine_a_routine_baseline()'::regprocedure,'public.engine_a_ledger_guard()'::regprocedure)
     AND (p.proname IN ('plan_save_gate','engine_a_save_plan','finish_engine_a_workout')
          OR p.prosrc ~* '(engine_a|exercise_personal_records|plan_source|route_decision)'
          OR (p.proname = 'replace_user_plans_atomic'
              AND 'p_route_decision_id' = ANY (coalesce(p.proargnames, ARRAY[]::text[]))));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'rollback refused: M3 routines still reference Engine A (%); drop M3 first', v;
  END IF;
  SELECT string_agg(schemaname || '.' || tablename || ':' || policyname, ', ') INTO v
    FROM pg_policies
   WHERE coalesce(qual, '') || coalesce(with_check, '') ~* '(engine_a|exercise_personal_records|plan_source|route_decision)'
     AND tablename NOT IN ('exercise_personal_records');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'rollback refused: policies reference Engine A (%); drop M3 first', v;
  END IF;

  -- Surviving v2 data.
  IF EXISTS (SELECT 1 FROM public.workout_plans
              WHERE plan_data ->> 'source' = 'engine_a'
                 OR plan_data ->> 'planSchemaVersion' = '2') THEN
    RAISE EXCEPTION 'rollback refused: Engine A plans exist in workout_plans';
  END IF;
  IF EXISTS (SELECT 1 FROM public.engine_a_schedule_revisions) THEN
    RAISE EXCEPTION 'rollback refused: schedule revisions exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exercise_personal_records) THEN
    RAISE EXCEPTION 'rollback refused: v2 personal records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.engine_a_attempts
              WHERE state IN ('admitted','in_progress_unknown')
                 OR (route = 'engine_a' AND state = 'committed')) THEN
    RAISE EXCEPTION 'rollback refused: open attempts or committed Engine A attempts exist';
  END IF;
END
$guard$;

-- No CASCADE: an unexpected dependent object (view, FK, column default)
-- aborts the rollback.
DROP TABLE public.engine_a_schedule_offers;
DROP TABLE public.engine_a_schedule_revisions;
DROP TABLE public.exercise_personal_records;
DROP TABLE public.engine_a_decisions;
DROP TABLE public.engine_a_attempts;
DROP TABLE public.engine_a_delist_events;
DROP TABLE public.engine_a_delist;
DROP TABLE public.engine_a_qa_accounts;
DROP TABLE public.engine_a_control_events;
DROP TABLE public.engine_a_control;
DROP TABLE public.engine_a_releases;
DROP TABLE public.engine_a_migration_events;
DROP FUNCTION public.engine_a_valid_weekdays(smallint[]);
DROP FUNCTION public.engine_a_forbid_change();
DROP FUNCTION public.engine_a_release_guard();
DROP FUNCTION public.engine_a_control_stamp();
DROP FUNCTION public.engine_a_control_log();
DROP FUNCTION public.engine_a_delist_log();
DROP FUNCTION public.engine_a_attempt_guard();
DROP FUNCTION public.engine_a_offer_guard();
DROP FUNCTION public.engine_a_purge_decisions();
DROP FUNCTION public.engine_a_routine_baseline();
DROP FUNCTION public.engine_a_ledger_guard();
DROP DOMAIN public.engine_a_code;
DROP DOMAIN public.engine_a_disclosure_kind;

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
              AND (relname LIKE 'engine\_a\_%' OR relname = 'exercise_personal_records'))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname LIKE 'engine\_a\_%')
     OR to_regtype('public.engine_a_code') IS NOT NULL
     OR to_regtype('public.engine_a_disclosure_kind') IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: an M1 object survived the rollback';
  END IF;
END
$mig$;

NOTIFY pgrst, 'reload schema';
COMMIT;
