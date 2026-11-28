-- 20261127130001_drop_engine_a_m2_columns.sql
-- Draft v3 (Codex reviews of v1 and v2 applied).
-- Run ONLY to undo 20261127130000_engine_a_m2_columns.sql. Manual rollback
-- only; never part of a sequential migration run.
-- Prerequisite: M3 (and anything later) is rolled back and its ledger row is
-- 'dropped'; the Server deployment no longer calls any Engine A path.
--
-- Locks: the ledger first (the only lock this file waits for), then, with
-- NOWAIT, profiles, workout_plans, workout_logs, engine_a_schedule_revisions
-- and engine_a_releases in ACCESS EXCLUSIVE mode (every table whose foreign
-- key or column this file drops, so no later statement needs a stronger
-- lock), and engine_a_attempts, engine_a_control and
-- exercise_personal_records in SHARE ROW EXCLUSIVE mode, all held until
-- COMMIT. If any is busy the file fails at once with
-- "could not obtain lock" and changes nothing; run it again.
-- Refuses unless all of these hold, with every relevant writer fenced:
--   - ledger (replayed by its insert trigger): the latest M2 row is
--     'applied' and no later step is applied;
--   - Engine A control is off with admission disabled;
--   - the plan-writing routines match the M1 baseline (M3 fully reverted);
--   - 0 Engine A plans, 0 Engine A logs, 0 schedule revisions, 0 v2 PRs;
--   - 0 open attempts (state 'admitted' or 'in_progress_unknown');
--   - 0 workout_plans rows with operation 'setup_change' (the original
--     3-value CHECK could not be restored over them).
-- The counts are recorded in the ledger row ('M2','dropped') inside this
-- transaction, before any identifying column is removed (M1 contract).
--
-- DATA LOSS when it proceeds: profiles' planning columns (derived values); the planning provenance of current-path plans (plan_source
-- 'current'), whose count is recorded in the ledger evidence. Those plans
-- then read as legacy plans with no recorded baseline.
--
-- Postcondition: the catalog of the five tables (profiles, workout_plans,
-- workout_logs, engine_a_schedule_revisions, engine_a_releases) equals the
-- pre-M2 catalog in the ledger in every recorded field: owner, RLS flags,
-- ACL with grantor, policies, columns with column ACLs, constraints,
-- indexes, user triggers and internal foreign-key triggers. If a later
-- reviewed migration changed any of these, its own rollback must run first.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.engine_a_migration_events IN EXCLUSIVE MODE;
LOCK TABLE public.profiles, public.workout_plans, public.workout_logs,
           public.engine_a_schedule_revisions, public.engine_a_releases
  IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.engine_a_attempts, public.engine_a_control,
           public.exercise_personal_records
  IN SHARE ROW EXCLUSIVE MODE NOWAIT;

CREATE TEMP TABLE _m2d_state ON COMMIT DROP AS
SELECT t.name,
       public.engine_a_table_catalog(('public.' || t.name)::regclass) AS cat_now
  FROM (VALUES ('profiles'), ('workout_plans'), ('workout_logs'),
               ('engine_a_schedule_revisions'), ('engine_a_releases')) t(name);

DO $guard$
DECLARE
  v_last    text;
  n_plans   bigint;
  n_logs    bigint;
  n_revs    bigint;
  n_prs     bigint;
  n_setup   bigint;
  n_current bigint;
  n_open    bigint;
BEGIN
  SELECT action INTO v_last FROM public.engine_a_migration_events
   WHERE step = 'M2' ORDER BY id DESC LIMIT 1;
  IF v_last IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'rollback refused: the ledger does not show M2 applied';
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (step) step, action
                              FROM public.engine_a_migration_events
                             WHERE step IN ('M3','M4','M5') ORDER BY step, id DESC) x
              WHERE x.action = 'applied') THEN
    RAISE EXCEPTION 'rollback refused: a later step is still applied; drop it first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.engine_a_control
                  WHERE id = 1 AND state = 'off' AND NOT admission_enabled) THEN
    RAISE EXCEPTION 'rollback refused: Engine A control is not off or admission is enabled';
  END IF;
  IF public.engine_a_routine_baseline()
     IS DISTINCT FROM (SELECT evidence -> 'routines' FROM public.engine_a_migration_events
                        WHERE step = 'M1' AND action = 'applied') THEN
    RAISE EXCEPTION 'rollback refused: plan-writing routines differ from the M1 baseline; restore them first';
  END IF;

  SELECT count(*) INTO n_plans FROM public.workout_plans WHERE plan_source = 'engine_a';
  SELECT count(*) INTO n_logs FROM public.workout_logs WHERE content_revision IS NOT NULL;
  SELECT count(*) INTO n_revs FROM public.engine_a_schedule_revisions;
  SELECT count(*) INTO n_prs FROM public.exercise_personal_records;
  SELECT count(*) INTO n_setup FROM public.workout_plans WHERE operation = 'setup_change';
  SELECT count(*) INTO n_current FROM public.workout_plans WHERE plan_source = 'current';
  SELECT count(*) INTO n_open FROM public.engine_a_attempts
   WHERE state IN ('admitted', 'in_progress_unknown');
  IF n_open <> 0 THEN
    RAISE EXCEPTION 'rollback refused: % open attempt(s) (admitted or in_progress_unknown); let them finish or expire first', n_open;
  END IF;
  IF n_plans + n_logs + n_revs + n_prs + n_setup <> 0 THEN
    RAISE EXCEPTION 'rollback refused: Engine A plans %, Engine A logs %, schedule revisions %, v2 PRs %, setup_change plans %',
      n_plans, n_logs, n_revs, n_prs, n_setup;
  END IF;

  -- Certifies the counts in this transaction, before identifiers go.
  INSERT INTO public.engine_a_migration_events (step, action, evidence)
  VALUES ('M2', 'dropped', jsonb_build_object(
            'engine_a_plans', n_plans, 'engine_a_logs', n_logs,
            'engine_a_schedule_revisions', n_revs, 'v2_personal_records', n_prs,
            'setup_change_plans', n_setup, 'current_provenance_plans', n_current));
END
$guard$;

-- engine_a_schedule_revisions
ALTER TABLE public.engine_a_schedule_revisions DROP CONSTRAINT engine_a_schedule_revisions_plan_fkey;

-- workout_logs
DROP TRIGGER engine_a_log_identity_guard ON public.workout_logs;
ALTER TABLE public.workout_logs DROP CONSTRAINT workout_logs_engine_a_identity_valid;
ALTER TABLE public.workout_logs
  DROP COLUMN content_revision,
  DROP COLUMN schedule_revision,
  DROP COLUMN session_index;

-- workout_plans
DROP TRIGGER engine_a_plan_provenance_guard ON public.workout_plans;
DROP INDEX public.workout_plans_one_active_per_user;
ALTER TABLE public.workout_plans DROP CONSTRAINT workout_plans_id_content_revision_key;
ALTER TABLE public.workout_plans DROP CONSTRAINT workout_plans_release_fkey;
ALTER TABLE public.workout_plans DROP CONSTRAINT workout_plans_provenance_valid;
ALTER TABLE public.workout_plans DROP CONSTRAINT workout_plans_operation_valid;
ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_operation_valid CHECK (
    (operation IS NULL)
    OR (operation = ANY (ARRAY['initial_setup'::text, 'feedback_adjustment'::text,
                               'safety_regeneration'::text])));
ALTER TABLE public.workout_plans
  DROP COLUMN plan_source,
  DROP COLUMN plan_schema_version,
  DROP COLUMN content_revision,
  DROP COLUMN schedule_revision,
  DROP COLUMN release_id,
  DROP COLUMN manifest_sha256,
  DROP COLUMN eligibility_id,
  DROP COLUMN planning_revision,
  DROP COLUMN planning_field_digests,
  DROP COLUMN attempt_digest;

-- profiles
DROP TRIGGER trg_zz_profile_planning_revision ON public.profiles;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_planning_fields_valid;
ALTER TABLE public.profiles
  DROP COLUMN planning_revision,
  DROP COLUMN planning_field_digests;

-- Postcondition, while the catalog function still exists.
DO $mig$
DECLARE
  before jsonb := (SELECT evidence -> 'catalog_before' FROM public.engine_a_migration_events
                    WHERE step = 'M2' AND action = 'applied' ORDER BY id DESC LIMIT 1);
  r record;
  now_cat jsonb;
  k text;
BEGIN
  FOR r IN SELECT name, cat_now FROM _m2d_state LOOP
    now_cat := public.engine_a_table_catalog(('public.' || r.name)::regclass);
    IF before -> r.name IS NULL THEN
      RAISE EXCEPTION 'postcondition failed: no pre-M2 catalog recorded for %', r.name;
    END IF;
    FOREACH k IN ARRAY ARRAY['owner','rls','force_rls','acl','policies','columns','constraints',
                             'indexes','triggers','internal_triggers'] LOOP
      IF now_cat -> k IS DISTINCT FROM before -> r.name -> k THEN
        RAISE EXCEPTION 'postcondition failed: % % differ from the pre-M2 catalog', r.name, k;
      END IF;
    END LOOP;
    FOREACH k IN ARRAY ARRAY['owner','rls','force_rls','acl','policies'] LOOP
      IF now_cat -> k IS DISTINCT FROM r.cat_now -> k THEN
        RAISE EXCEPTION 'postcondition failed: % % changed during the rollback', r.name, k;
      END IF;
    END LOOP;
  END LOOP;
END
$mig$;

DROP FUNCTION public.engine_a_m2_problems();
DROP FUNCTION public.engine_a_plan_provenance_guard();
DROP FUNCTION public.engine_a_log_identity_guard();
DROP FUNCTION public.engine_a_set_planning_revision();
DROP FUNCTION public.engine_a_valid_planning_digests(jsonb);
DROP FUNCTION public.engine_a_planning_revision_v1(jsonb);
DROP FUNCTION public.engine_a_planning_digests_v1(
  integer, text, text, text, text, integer, integer, text, text[], text, text, text);
DROP FUNCTION public.engine_a_utf8(text);
DROP FUNCTION public.engine_a_table_catalog(regclass);

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND proname IN ('engine_a_utf8','engine_a_planning_digests_v1',
                              'engine_a_planning_revision_v1','engine_a_valid_planning_digests',
                              'engine_a_plan_provenance_guard','engine_a_log_identity_guard',
                              'engine_a_table_catalog','engine_a_m2_problems',
                              'engine_a_set_planning_revision')) THEN
    RAISE EXCEPTION 'postcondition failed: an M2 function survived the rollback';
  END IF;
END
$mig$;

NOTIFY pgrst, 'reload schema';
COMMIT;
