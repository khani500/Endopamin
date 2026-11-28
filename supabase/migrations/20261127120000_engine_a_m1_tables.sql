-- 20261127120000_engine_a_m1_tables.sql
-- DRAFT for Codex review. UNEXECUTED. Do not supabase db push.
-- Apply by hand in the SQL Editor only after review and owner approval.
-- Reverse: 20261127120001_drop_engine_a_m1_tables.sql (manual only).
-- Post-apply check: VERIFY_engine_a_m1.sql (read-only).
--
-- Revision: v5 (Codex reviews of v1 to v4: CHANGES_REQUIRED; every
-- finding applied, see README_M1.md).
-- Design: SIGNOFF2_1D_DB_DESIGN_v2.md, step M1 (inert tables).
-- Nothing reads or writes these objects yet. Engine A stays off:
-- engine_a_control starts with state 'off', admission_enabled false and
-- no active release. No existing column, grant, policy or row is changed.
-- The only rows written are the engine_a_control singleton, its event row,
-- and one engine_a_migration_events row ('M1','applied') holding the
-- routine baseline: for every overload of public replace_user_plans_atomic,
-- finish_strength_workout and get_active_plan_safety_status, the sha256 of
-- its full definition (pg_get_functiondef under a pinned search_path: body,
-- argument names and defaults, return type, language, volatility, SECURITY
-- DEFINER, SET clauses), its owner and its normalized ACL. The M1 rollback
-- requires these routines to be back in exactly that state.
--
-- EXPLICIT EXCEPTION TO INERTNESS: foreign keys to auth.users(id).
-- engine_a_qa_accounts, engine_a_attempts, engine_a_decisions,
-- engine_a_schedule_offers and exercise_personal_records reference
-- auth.users ON DELETE CASCADE, so account deletion removes their rows
-- (the decision log holds user ids). PostgreSQL installs internal
-- referential-integrity triggers on auth.users and takes a SHARE ROW
-- EXCLUSIVE lock on auth.users. lock_timeout 5s bounds only the wait to
-- acquire that lock; once acquired it is held until COMMIT, so conflicting
-- Auth writes (sign-up, account deletion, user updates) wait for the rest
-- of this transaction (seconds; run at a quiet time). TRUNCATE auth.users
-- would now require these tables too. Precedent:
-- 20261001120000_user_entitlements.sql (same FK, same cascade).
-- No foreign key to public.workout_plans is added here; the schedule tables
-- get theirs in M2, which already changes workout_plans.
--
-- ATOMIC. One transaction. NOT IDEMPOTENT ON PURPOSE: if any object exists,
-- the file fails closed before changing anything.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['engine_a_releases','engine_a_control','engine_a_control_events','engine_a_qa_accounts','engine_a_delist','engine_a_delist_events','engine_a_attempts','engine_a_decisions','engine_a_schedule_revisions','engine_a_schedule_offers','exercise_personal_records','engine_a_migration_events'] LOOP
    IF to_regclass('public.' || n) IS NOT NULL THEN
      RAISE EXCEPTION 'precondition failed: public.% already exists', n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname LIKE 'engine\_a\_%') THEN
    RAISE EXCEPTION 'precondition failed: a public.engine_a_* function already exists';
  END IF;
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'precondition failed: PostgreSQL 15 or later required, found %',
      current_setting('server_version');
  END IF;
  IF to_regtype('public.engine_a_code') IS NOT NULL
     OR to_regtype('public.engine_a_disclosure_kind') IS NOT NULL THEN
    RAISE EXCEPTION 'precondition failed: an engine_a domain already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'finish_strength_workout')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                     AND proname = 'replace_user_plans_atomic') THEN
    RAISE EXCEPTION 'precondition failed: finish_strength_workout or replace_user_plans_atomic is missing';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'precondition failed: auth.users or auth.uid() is missing';
  END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
       WHERE a.attrelid = 'auth.users'::regclass AND a.attname = 'id'
         AND NOT a.attisdropped) IS DISTINCT FROM 'uuid'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c
                     WHERE c.conrelid = 'auth.users'::regclass AND c.contype IN ('p','u')
                       AND pg_get_constraintdef(c.oid) IN ('PRIMARY KEY (id)', 'UNIQUE (id)')) THEN
    RAISE EXCEPTION 'precondition failed: auth.users(id) is not a uuid key';
  END IF;
  IF NOT has_table_privilege(current_user, 'auth.users', 'REFERENCES') THEN
    RAISE EXCEPTION 'precondition failed: % lacks REFERENCES on auth.users', current_user;
  END IF;
  FOREACH n IN ARRAY ARRAY['service_role','anon','authenticated'] LOOP
    IF to_regrole(quote_ident(n)) IS NULL THEN
      RAISE EXCEPTION 'precondition failed: role % does not exist', n;
    END IF;
  END LOOP;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'precondition failed: service_role does not bypass RLS';
  END IF;
  IF NOT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE')
     OR NOT has_schema_privilege('authenticated', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'precondition failed: authenticated cannot call auth.uid()';
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. DOMAINS, HELPERS AND TRIGGER FUNCTIONS.
-- ---------------------------------------------------------------------------
-- Closed code list. Freeze v2 B.2 codes, plus the 1D additions NOT_OFFERED
-- (negative admission), SUBSCRIPTION_REQUIRED (2.14), STALE_ENTITLEMENT
-- (section 3), ROUTE_DECISION_REQUIRED (2.7) and OPERATION_REFUSED (operation
-- gate). Adding a code needs a migration.
CREATE DOMAIN public.engine_a_code AS text CHECK (VALUE IN (
  'ENGINE_REFUSED','VALIDATOR_REFUSED','PIN_MISMATCH','RELEASE_MISMATCH',
  'ADMISSION_UNAVAILABLE','DEADLINE_EXCEEDED','STALE_PROFILE','STALE_FINGERPRINT',
  'STALE_ACTIVE_PLAN','ATTEMPT_CONFLICT','OPERATION_NOT_SUPPORTED','SCHEDULE_INVALID',
  'SCHEDULE_OFFER_INVALID','NUTRITION_INVALID','PLAN_NOT_USABLE','UPDATE_REQUIRED',
  'NOT_OFFERED','SUBSCRIPTION_REQUIRED','STALE_ENTITLEMENT','ROUTE_DECISION_REQUIRED',
  'OPERATION_REFUSED'));

-- Injury and health classification only, as the adapter computes it
-- (api/_engineProfile.js kinds none, prefer_not, reported, unknown, plus
-- invalid input). Never a stored value or free text.
CREATE DOMAIN public.engine_a_disclosure_kind AS text CHECK (VALUE IN (
  'none','prefer_not','reported','unknown','invalid'));

CREATE FUNCTION public.engine_a_valid_weekdays(p smallint[])
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT p IS NOT NULL
     AND array_ndims(p) = 1
     AND cardinality(p) BETWEEN 1 AND 7
     AND array_position(p, NULL) IS NULL
     AND (SELECT count(DISTINCT d) = count(*) AND min(d) >= 0 AND max(d) <= 6
            FROM unnest(p) AS d)
$fn$;

CREATE FUNCTION public.engine_a_forbid_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'engine_a_immutable: % on %', TG_OP, TG_TABLE_NAME;
END
$fn$;

-- A release row is immutable. The only change is retiring it once.
CREATE FUNCTION public.engine_a_release_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL
     AND (to_jsonb(NEW) - 'retired_at') = (to_jsonb(OLD) - 'retired_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'engine_a_immutable: % on engine_a_releases', TG_OP;
END
$fn$;

CREATE FUNCTION public.engine_a_control_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.updated_at := clock_timestamp();
  NEW.updated_by := session_user;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION public.engine_a_control_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  INSERT INTO public.engine_a_control_events (old_row, new_row, changed_by)
  VALUES (CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW), session_user);
  RETURN NULL;
END
$fn$;

-- De-list: inserting a row writes a 'delist' event. Deleting it (restore)
-- requires a reason in the transaction setting engine_a.restore_reason.
CREATE FUNCTION public.engine_a_delist_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.engine_a_delist_events (profile_id, release_id, action, by_role, reason)
    VALUES (NEW.profile_id, NEW.release_id, 'delist', session_user, NEW.reason);
    RETURN NULL;
  END IF;
  v_reason := nullif(btrim(current_setting('engine_a.restore_reason', true)), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'engine_a_restore_reason_required';
  END IF;
  INSERT INTO public.engine_a_delist_events (profile_id, release_id, action, by_role, reason)
  VALUES (OLD.profile_id, OLD.release_id, 'restore', session_user, v_reason);
  RETURN NULL;
END
$fn$;

-- Attempt rules: binding fields never change; only an 'admitted' attempt can
-- commit; 'in_progress_unknown' can only be closed without a commit.
CREATE FUNCTION public.engine_a_attempt_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  mutable text[] := ARRAY['state','outcome_code','workout_plan_id',
                          'nutrition_plan_id','receipt','finished_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('admitted','refused') THEN
      RAISE EXCEPTION 'engine_a_attempt_initial_state: %', NEW.state;
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'engine_a_attempt_binding_immutable';
  END IF;
  IF OLD.state = 'admitted'
     AND NEW.state IN ('committed','refused','expired','in_progress_unknown') THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'in_progress_unknown' AND NEW.state IN ('refused','expired') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'engine_a_attempt_transition: % -> %', OLD.state, NEW.state;
END
$fn$;

-- An offer can only be consumed, once.
CREATE FUNCTION public.engine_a_offer_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
     AND (to_jsonb(NEW) - 'consumed_at') = (to_jsonb(OLD) - 'consumed_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'engine_a_offer_immutable';
END
$fn$;

-- Routine baseline (see header). Pinned search_path, so the result does not
-- depend on the caller. Owner SQL only (no grant).
CREATE FUNCTION public.engine_a_routine_baseline()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT coalesce(jsonb_object_agg(
           p.proname || '(' || oidvectortypes(p.proargtypes) || ')',
           jsonb_build_object(
             'definition_sha256',
               encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex'),
             'owner', p.proowner::regrole::text,
             'acl', (SELECT coalesce(jsonb_agg(x.entry ORDER BY x.entry::text), '[]'::jsonb)
                       FROM (SELECT jsonb_build_array(
                                      CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                           ELSE a.grantee::regrole::text END,
                                      a.privilege_type, a.is_grantable,
                                      a.grantor::regrole::text) AS entry
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) x))),
         '{}'::jsonb)
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('replace_user_plans_atomic', 'finish_strength_workout',
                       'get_active_plan_safety_status')
$fn$;

-- Ledger provenance. Lock order: every script that writes the ledger takes
--   LOCK TABLE public.engine_a_migration_events IN EXCLUSIVE MODE;
-- as its FIRST lock, before any other table, and before inserting. The
-- trigger refuses an insert whose transaction does not already hold that
-- lock (taking it inside the trigger would upgrade from ROW EXCLUSIVE and
-- could deadlock two inserters). Every insert must be a valid transition: M1 'applied' exactly once, first; Mx 'applied' only while
-- M(x-1) is applied and Mx is not; Mx 'dropped' only while Mx is applied and
-- M(x+1) is not (reverse order); M2 'dropped' only with all four evidence
-- counts present and exactly 0. Rows are immutable (separate trigger).
CREATE FUNCTION public.engine_a_ledger_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  steps text[] := ARRAY['M1','M2','M3','M4','M5'];
  i     integer := array_position(ARRAY['M1','M2','M3','M4','M5'], NEW.step);
  cur   text;
  prev  text;
  nxt   text;
  k     text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_locks l
     WHERE l.locktype = 'relation' AND l.pid = pg_backend_pid() AND l.granted
       AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND l.relation = 'public.engine_a_migration_events'::regclass
       AND l.mode IN ('ExclusiveLock', 'AccessExclusiveLock')) THEN
    RAISE EXCEPTION 'engine_a_ledger: take LOCK TABLE public.engine_a_migration_events IN EXCLUSIVE MODE first';
  END IF;
  IF NEW.step = 'M1' THEN
    IF NEW.action <> 'applied' OR EXISTS (SELECT 1 FROM public.engine_a_migration_events) THEN
      RAISE EXCEPTION 'engine_a_ledger: M1 is recorded once, as applied, before any other step';
    END IF;
    RETURN NEW;
  END IF;
  SELECT e.action INTO cur  FROM public.engine_a_migration_events e
   WHERE e.step = NEW.step     ORDER BY e.id DESC LIMIT 1;
  SELECT e.action INTO prev FROM public.engine_a_migration_events e
   WHERE e.step = steps[i - 1] ORDER BY e.id DESC LIMIT 1;
  IF i < 5 THEN
    SELECT e.action INTO nxt FROM public.engine_a_migration_events e
     WHERE e.step = steps[i + 1] ORDER BY e.id DESC LIMIT 1;
  END IF;
  IF NEW.action = 'applied' THEN
    IF cur IS NOT DISTINCT FROM 'applied' OR prev IS DISTINCT FROM 'applied' THEN
      RAISE EXCEPTION 'engine_a_ledger: % applied out of order', NEW.step;
    END IF;
  ELSE
    IF cur IS DISTINCT FROM 'applied' OR nxt IS NOT DISTINCT FROM 'applied' THEN
      RAISE EXCEPTION 'engine_a_ledger: % dropped out of order', NEW.step;
    END IF;
    IF NEW.step = 'M2' THEN
      FOREACH k IN ARRAY ARRAY['engine_a_plans','engine_a_logs',
                               'engine_a_schedule_revisions','v2_personal_records'] LOOP
        IF jsonb_typeof(NEW.evidence -> k) IS DISTINCT FROM 'number'
           OR (NEW.evidence ->> k)::numeric <> 0 THEN
          RAISE EXCEPTION 'engine_a_ledger: M2 drop evidence % must be present and 0', k;
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

-- Decision log retention: 90 days (owner decision O6).
CREATE FUNCTION public.engine_a_purge_decisions()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  n bigint;
BEGIN
  DELETE FROM public.engine_a_decisions
   WHERE at < clock_timestamp() - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 3. TABLES.
-- ---------------------------------------------------------------------------
CREATE TABLE public.engine_a_releases (
  release_id      text        PRIMARY KEY CHECK (release_id ~ '^ea-[0-9]{8}-[0-9]+$'),
  manifest_sha256 text        NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz NULL,
  UNIQUE (release_id, manifest_sha256)
);

CREATE TABLE public.engine_a_control (
  id                smallint    PRIMARY KEY CHECK (id = 1),
  state             text        NOT NULL DEFAULT 'off' CHECK (state IN ('off','qa','public')),
  admission_enabled boolean     NOT NULL DEFAULT false,
  active_release_id text        NULL REFERENCES public.engine_a_releases (release_id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text        NOT NULL DEFAULT session_user,
  CONSTRAINT engine_a_control_on_requires_ready CHECK (
    state = 'off' OR (admission_enabled AND active_release_id IS NOT NULL))
);

CREATE TABLE public.engine_a_control_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  old_row    jsonb       NULL,
  new_row    jsonb       NOT NULL,
  changed_by text        NOT NULL
);

CREATE TABLE public.engine_a_qa_accounts (
  user_id  uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  note     text        NULL CHECK (char_length(note) <= 200)
);

CREATE TABLE public.engine_a_delist (
  profile_id  text        NOT NULL CHECK (char_length(profile_id) BETWEEN 1 AND 300),
  release_id  text        NOT NULL REFERENCES public.engine_a_releases (release_id),
  delisted_at timestamptz NOT NULL DEFAULT now(),
  reason      text        NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  PRIMARY KEY (profile_id, release_id)
);

CREATE TABLE public.engine_a_delist_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id text        NOT NULL,
  release_id text        NOT NULL,
  action     text        NOT NULL CHECK (action IN ('delist','restore')),
  at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  by_role    text        NOT NULL,
  reason     text        NOT NULL
);

CREATE TABLE public.engine_a_attempts (
  user_id                      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  attempt_id                   uuid        NOT NULL,
  request_digest               text        NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  operation                    text        NOT NULL CHECK (operation IN (
    'initial_setup','safety_regeneration','setup_change','next_week','feedback_adjustment')),
  route                        text        NOT NULL CHECK (route IN ('engine_a','current')),
  release_id                   text        NULL,
  manifest_sha256              text        NULL,
  planning_revision            text        NOT NULL CHECK (planning_revision ~ '^v[0-9]+:[0-9a-f]{64}$'),
  safety_fingerprint           text        NOT NULL CHECK (char_length(safety_fingerprint) BETWEEN 1 AND 200),
  expected_no_active_plan      boolean     NOT NULL,
  expected_active_plan_id      uuid        NULL,
  expected_content_revision    text        NULL,
  expected_schedule_revision   integer     NULL CHECK (expected_schedule_revision >= 1),
  eligibility_id               text        NULL CHECK (char_length(eligibility_id) BETWEEN 1 AND 300),
  -- Entitlement evidence (2.14): the user_entitlements authority fields seen
  -- at admission. M3 compares all three under L5 and separately requires
  -- effective access at clock_timestamp().
  entitlement_active           boolean     NULL,
  entitlement_expires_at       timestamptz NULL,
  entitlement_synced_at        timestamptz NULL,
  continuation                 text        NULL CHECK (continuation IN ('C4','C6r')),
  continuation_changed_fields  text[]      NULL,
  continuation_negative_result public.engine_a_code NULL,
  deadline_at                  timestamptz NOT NULL,
  state                        text        NOT NULL CHECK (state IN (
    'admitted','committed','refused','expired','in_progress_unknown')),
  outcome_code                 public.engine_a_code NULL,
  workout_plan_id              uuid        NULL,
  nutrition_plan_id            uuid        NULL,
  receipt                      jsonb       NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  finished_at                  timestamptz NULL,
  PRIMARY KEY (user_id, attempt_id),
  FOREIGN KEY (release_id, manifest_sha256)
    REFERENCES public.engine_a_releases (release_id, manifest_sha256),
  CONSTRAINT engine_a_attempts_release_pair CHECK (
    (release_id IS NULL) = (manifest_sha256 IS NULL)),
  CONSTRAINT engine_a_attempts_engine_route CHECK (
    route <> 'engine_a' OR state = 'refused' OR release_id IS NOT NULL),
  -- Existing current-path plans have no revisions, so both may be null.
  CONSTRAINT engine_a_attempts_expected_plan CHECK (
    (expected_no_active_plan AND expected_active_plan_id IS NULL
       AND expected_content_revision IS NULL AND expected_schedule_revision IS NULL)
    OR (NOT expected_no_active_plan AND expected_active_plan_id IS NOT NULL
       AND (expected_content_revision IS NULL) = (expected_schedule_revision IS NULL))),
  CONSTRAINT engine_a_attempts_continuation CHECK (
    (continuation IS NULL AND continuation_changed_fields IS NULL
       AND continuation_negative_result IS NULL)
    -- A continuation implies an active Engine A (v2) plan with both revisions.
    -- Changed fields are real profile column names: C4 = fingerprint v1
    -- fields; C6r = the frozen setup-change fields of freeze v2 C.1 class 3.
    -- The branch is wrapped in coalesce so that a NULL anywhere fails the
    -- CHECK instead of passing it.
    OR coalesce(continuation IS NOT NULL AND route = 'current' AND NOT expected_no_active_plan
       AND expected_content_revision IS NOT NULL AND expected_schedule_revision IS NOT NULL
       -- Only a resolved negative admission continues (C12 bars unresolved).
       AND continuation_negative_result IS NOT NULL
       AND continuation_negative_result = 'NOT_OFFERED'
       AND continuation_changed_fields IS NOT NULL
       AND array_ndims(continuation_changed_fields) = 1
       AND cardinality(continuation_changed_fields) > 0
       AND array_position(continuation_changed_fields, NULL) IS NULL
       AND ((continuation = 'C4' AND operation = 'safety_regeneration'
             AND continuation_changed_fields <@ ARRAY['equipment','equipment_extras',
                 'experience','health_conditions','injuries']::text[])
         OR (continuation = 'C6r' AND operation = 'setup_change'
             AND continuation_changed_fields <@ ARRAY['goal','days_per_week',
                 'session_duration','priority_muscle']::text[])), false)),
  CONSTRAINT engine_a_attempts_unsupported_ops CHECK (
    operation <> 'next_week' OR state = 'refused'),
  CONSTRAINT engine_a_attempts_entitlement_evidence CHECK (
    state NOT IN ('admitted','committed','in_progress_unknown')
    OR (entitlement_active IS TRUE AND entitlement_synced_at IS NOT NULL)),
  CONSTRAINT engine_a_attempts_committed CHECK (
    (state = 'committed') = (receipt IS NOT NULL)
    AND (state = 'committed') = (workout_plan_id IS NOT NULL)
    AND (state = 'committed' OR nutrition_plan_id IS NULL)),
  CONSTRAINT engine_a_attempts_finished CHECK (
    (state IN ('committed','refused','expired')) = (finished_at IS NOT NULL)),
  CONSTRAINT engine_a_attempts_refusal_code CHECK (
    state <> 'refused' OR outcome_code IS NOT NULL)
);

-- Enum kinds and codes only. No free text, no profile values.
CREATE TABLE public.engine_a_decisions (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  user_id        uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  attempt_id     uuid        NULL,
  event          text        NOT NULL CHECK (event IN (
    'admit','route_current','refuse','unsupported','commit','replay','stale',
    'deadline','release_mismatch','delist','switch_unreadable')),
  code           public.engine_a_code NULL,
  release_id     text        NULL CHECK (release_id ~ '^ea-[0-9]{8}-[0-9]+$'),
  eligibility_id text        NULL CHECK (char_length(eligibility_id) BETWEEN 1 AND 300),
  operation      text        NULL CHECK (operation IN (
    'initial_setup','safety_regeneration','setup_change','next_week','feedback_adjustment')),
  injury_kind    public.engine_a_disclosure_kind NULL,
  health_kind    public.engine_a_disclosure_kind NULL
);
CREATE INDEX engine_a_decisions_at_idx ON public.engine_a_decisions (at);
CREATE INDEX engine_a_decisions_user_idx ON public.engine_a_decisions (user_id);

CREATE TABLE public.engine_a_schedule_revisions (
  -- FK to public.workout_plans (id) ON DELETE CASCADE is added in M2.
  workout_plan_id   uuid        NOT NULL,
  schedule_revision integer     NOT NULL CHECK (schedule_revision >= 1),
  content_revision  text        NOT NULL CHECK (content_revision ~ '^[0-9a-f]{64}$'),
  weekdays          smallint[]  NOT NULL CHECK (public.engine_a_valid_weekdays(weekdays)),
  rotation          integer     NOT NULL CHECK (rotation >= 0),
  source            text        NOT NULL CHECK (source IN ('default','user_alternative','user_kept')),
  conflicts         integer     NOT NULL CHECK (conflicts >= 0),
  minimum_conflicts integer     NOT NULL CHECK (minimum_conflicts >= 0),
  days              jsonb       NOT NULL CHECK (
    CASE WHEN jsonb_typeof(days) = 'array' THEN jsonb_array_length(days) = 7 ELSE false END),
  attempt_id        uuid        NOT NULL,
  validation_sha256 text        NULL CHECK (validation_sha256 ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workout_plan_id, schedule_revision),
  CHECK (conflicts >= minimum_conflicts)
);

CREATE TABLE public.engine_a_schedule_offers (
  offer_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  attempt_id        uuid        NOT NULL,
  -- Plan existence follows from the FK to schedule revisions (M2 adds theirs).
  workout_plan_id   uuid        NOT NULL,
  content_revision  text        NOT NULL CHECK (content_revision ~ '^[0-9a-f]{64}$'),
  schedule_revision integer     NOT NULL,
  requested         smallint[]  NOT NULL CHECK (public.engine_a_valid_weekdays(requested)),
  offered           smallint[]  NOT NULL CHECK (public.engine_a_valid_weekdays(offered)),
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz NULL,
  UNIQUE (user_id, attempt_id),
  FOREIGN KEY (workout_plan_id, schedule_revision)
    REFERENCES public.engine_a_schedule_revisions (workout_plan_id, schedule_revision)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (cardinality(requested) = cardinality(offered))
);
CREATE INDEX engine_a_schedule_offers_plan_idx
  ON public.engine_a_schedule_offers (workout_plan_id, schedule_revision);

CREATE TABLE public.exercise_personal_records (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  exercise_id   text        NOT NULL CHECK (char_length(exercise_id) BETWEEN 1 AND 100),
  measure       text        NOT NULL CHECK (measure IN ('reps','duration')),
  weight_kg     numeric     NULL CHECK (weight_kg >= 0 AND weight_kg < 'Infinity'::numeric),
  reps          integer     NULL CHECK (reps > 0),
  seconds       integer     NULL CHECK (seconds > 0),
  estimated_1rm numeric     NULL CHECK (estimated_1rm >= 0 AND estimated_1rm < 'Infinity'::numeric),
  recorded_at   date        NOT NULL,
  source_log_id uuid        NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_id, measure, recorded_at),
  CONSTRAINT exercise_personal_records_measure CHECK (
    (measure = 'reps'     AND reps IS NOT NULL    AND seconds IS NULL) OR
    (measure = 'duration' AND seconds IS NOT NULL AND reps IS NULL AND estimated_1rm IS NULL))
);

-- Rollback ledger. Each later step (M2-M5) inserts ('Mx','applied') when it
-- is installed and ('Mx','dropped', evidence) from its drop file after that
-- file's own guards pass. M2's drop evidence carries the counts of Engine A
-- plans, logs, schedule revisions and v2 PRs it found (all must be 0),
-- measured before it removes the identifying columns. Owner SQL only.
CREATE TABLE public.engine_a_migration_events (
  id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  step     text        NOT NULL CHECK (step IN ('M1','M2','M3','M4','M5')),
  action   text        NOT NULL CHECK (action IN ('applied','dropped')),
  evidence jsonb       NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  by_role  text        NOT NULL DEFAULT session_user
);

-- ---------------------------------------------------------------------------
-- 4. TRIGGERS.
-- ---------------------------------------------------------------------------
CREATE TRIGGER engine_a_releases_guard BEFORE UPDATE OR DELETE ON public.engine_a_releases
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_release_guard();
CREATE TRIGGER engine_a_control_stamp BEFORE UPDATE ON public.engine_a_control
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_control_stamp();
CREATE TRIGGER engine_a_control_log AFTER INSERT OR UPDATE ON public.engine_a_control
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_control_log();
CREATE TRIGGER engine_a_control_no_delete BEFORE DELETE ON public.engine_a_control
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_forbid_change();
CREATE TRIGGER engine_a_control_events_frozen BEFORE UPDATE OR DELETE ON public.engine_a_control_events
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_forbid_change();
CREATE TRIGGER engine_a_delist_log AFTER INSERT OR DELETE ON public.engine_a_delist
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_delist_log();
CREATE TRIGGER engine_a_delist_no_update BEFORE UPDATE ON public.engine_a_delist
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_forbid_change();
CREATE TRIGGER engine_a_delist_events_frozen BEFORE UPDATE OR DELETE ON public.engine_a_delist_events
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_forbid_change();
CREATE TRIGGER engine_a_attempts_guard BEFORE INSERT OR UPDATE ON public.engine_a_attempts
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_attempt_guard();
CREATE TRIGGER engine_a_schedule_revisions_frozen BEFORE UPDATE ON public.engine_a_schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_forbid_change();
CREATE TRIGGER engine_a_migration_events_frozen BEFORE UPDATE OR DELETE ON public.engine_a_migration_events
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_forbid_change();
CREATE TRIGGER engine_a_migration_events_order BEFORE INSERT ON public.engine_a_migration_events
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_ledger_guard();
CREATE TRIGGER engine_a_schedule_offers_guard BEFORE UPDATE ON public.engine_a_schedule_offers
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_offer_guard();

-- ---------------------------------------------------------------------------
-- 5. THE SINGLETON: OFF.
-- ---------------------------------------------------------------------------
INSERT INTO public.engine_a_control (id) VALUES (1);

-- Routine baseline, recorded once. Ledger lock first (see the guard).
LOCK TABLE public.engine_a_migration_events IN EXCLUSIVE MODE;
INSERT INTO public.engine_a_migration_events (step, action, evidence)
VALUES ('M1', 'applied', jsonb_build_object('routines', public.engine_a_routine_baseline()));

-- ---------------------------------------------------------------------------
-- 6. RLS AND PRIVILEGES. DEFAULT DENY.
-- Project default privileges may grant new objects to anon, authenticated and
-- service_role, so everything is revoked first and then granted explicitly.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  t text;
  s text;
  f regprocedure;
BEGIN
  FOREACH t IN ARRAY ARRAY['engine_a_releases','engine_a_control','engine_a_control_events','engine_a_qa_accounts','engine_a_delist','engine_a_delist_events','engine_a_attempts','engine_a_decisions','engine_a_schedule_revisions','engine_a_schedule_offers','exercise_personal_records','engine_a_migration_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    FOR s IN SELECT d.objid::regclass::text FROM pg_depend d
              JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
             WHERE d.refobjid = ('public.' || t)::regclass AND d.deptype IN ('a','i') LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', s);
    END LOOP;
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'engine\_a\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
  END LOOP;
END
$mig$;

-- Owner-SQL only for writes: releases, control, QA accounts, de-list.
GRANT SELECT ON TABLE public.engine_a_releases,
                      public.engine_a_control,
                      public.engine_a_control_events,
                      public.engine_a_qa_accounts,
                      public.engine_a_delist,
                      public.engine_a_delist_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.engine_a_attempts TO service_role;
GRANT SELECT, INSERT         ON TABLE public.engine_a_decisions TO service_role;
GRANT SELECT, INSERT         ON TABLE public.engine_a_schedule_offers TO service_role;
-- Written only by SECURITY DEFINER RPCs added in M3.
GRANT SELECT ON TABLE public.engine_a_schedule_revisions TO service_role;
GRANT SELECT ON TABLE public.exercise_personal_records TO service_role;

GRANT EXECUTE ON FUNCTION public.engine_a_purge_decisions() TO service_role;
-- CHECK constraints call this helper as the writing role.
GRANT EXECUTE ON FUNCTION public.engine_a_valid_weekdays(smallint[]) TO service_role;

-- The only client access: an owner reads their own v2 personal records.
GRANT SELECT ON TABLE public.exercise_personal_records TO authenticated;
CREATE POLICY exercise_personal_records_select_own
  ON public.exercise_personal_records
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. AFTER ASSERTIONS. The same check set as VERIFY_engine_a_m1.sql:
-- effective privileges (role membership and PUBLIC included), grant options,
-- sequences, the exact PR policy, triggers, domains, the off singleton and
-- its seed event, and empty data tables.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v text;
BEGIN
  WITH tabs(t) AS (VALUES ('engine_a_releases'),('engine_a_control'),('engine_a_control_events'),('engine_a_qa_accounts'),('engine_a_delist'),('engine_a_delist_events'),('engine_a_attempts'),('engine_a_decisions'),('engine_a_schedule_revisions'),('engine_a_schedule_offers'),('exercise_personal_records'),('engine_a_migration_events')),
rel AS (SELECT tabs.t, to_regclass('public.' || tabs.t) AS oid FROM tabs),
roles(r) AS (VALUES ('anon'), ('authenticated'), ('service_role')),
privs(p) AS (
  SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
    || CASE WHEN current_setting('server_version_num')::int >= 170000
            THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END)),
want_tab(t, r, p) AS (
  SELECT t, 'service_role', 'SELECT' FROM tabs WHERE t <> 'engine_a_migration_events'
  UNION ALL VALUES
    ('engine_a_attempts', 'service_role', 'INSERT'),
    ('engine_a_attempts', 'service_role', 'UPDATE'),
    ('engine_a_decisions', 'service_role', 'INSERT'),
    ('engine_a_schedule_offers', 'service_role', 'INSERT'),
    ('exercise_personal_records', 'authenticated', 'SELECT')),
fnlist(sig) AS (VALUES ('public.engine_a_valid_weekdays(smallint[])'),('public.engine_a_forbid_change()'),('public.engine_a_release_guard()'),('public.engine_a_control_stamp()'),('public.engine_a_control_log()'),('public.engine_a_delist_log()'),('public.engine_a_attempt_guard()'),('public.engine_a_offer_guard()'),('public.engine_a_purge_decisions()'),('public.engine_a_routine_baseline()'),('public.engine_a_ledger_guard()')),
fn AS (SELECT p.oid, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS sig, p.proacl, p.proowner, p.prosecdef, p.proconfig
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'engine\_a\_%'),
want_fn(sig, r) AS (VALUES
    ('engine_a_purge_decisions()', 'service_role'),
    ('engine_a_valid_weekdays(smallint[])', 'service_role')),
seqs AS (SELECT d.objid AS oid FROM pg_depend d JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
          WHERE d.refobjid IN (SELECT oid FROM rel WHERE oid IS NOT NULL) AND d.deptype IN ('a','i')),
problems(problem) AS (
  SELECT 'missing table ' || t FROM rel WHERE oid IS NULL
  UNION ALL
  SELECT 'RLS off on ' || rel.t FROM rel JOIN pg_class c ON c.oid = rel.oid WHERE NOT c.relrowsecurity
  UNION ALL
  SELECT 'effective table privilege ' || rel.t || ' ' || roles.r || ' ' || privs.p
         || CASE WHEN has_table_privilege(roles.r, rel.oid, privs.p) THEN ' unexpected' ELSE ' missing' END
    FROM rel, roles, privs
   WHERE rel.oid IS NOT NULL
     AND has_table_privilege(roles.r, rel.oid, privs.p)
         <> EXISTS (SELECT 1 FROM want_tab w WHERE w.t = rel.t AND w.r = roles.r AND w.p = privs.p)
  UNION ALL
  SELECT 'PUBLIC grant on ' || rel.t FROM rel JOIN pg_class c ON c.oid = rel.oid, aclexplode(c.relacl) a
   WHERE a.grantee = 0
  UNION ALL
  SELECT 'grant option on ' || rel.t || ' for ' || a.grantee::regrole::text
    FROM rel JOIN pg_class c ON c.oid = rel.oid, aclexplode(c.relacl) a
   WHERE a.is_grantable AND a.grantee <> c.relowner
  UNION ALL
  SELECT 'column ACL on ' || rel.t FROM rel JOIN pg_attribute a ON a.attrelid = rel.oid
   WHERE a.attacl IS NOT NULL
  UNION ALL
  SELECT 'missing function ' || sig FROM fnlist WHERE to_regprocedure(sig) IS NULL
  UNION ALL
  SELECT 'unexpected engine_a function count ' || count(*) FROM fn HAVING count(*) <> 11
  UNION ALL
  SELECT 'function owner or search_path ' || sig FROM fn
   WHERE fn.proowner <> 'postgres'::regrole OR fn.proconfig IS NULL
  UNION ALL
  SELECT 'SECURITY DEFINER other than purge: ' || sig FROM fn
   WHERE fn.prosecdef AND sig <> 'engine_a_purge_decisions()'
  UNION ALL
  SELECT 'purge is not SECURITY DEFINER' WHERE NOT EXISTS
    (SELECT 1 FROM fn WHERE sig = 'engine_a_purge_decisions()' AND prosecdef)
  UNION ALL
  SELECT 'effective EXECUTE ' || fn.sig || ' ' || roles.r
         || CASE WHEN has_function_privilege(roles.r, fn.oid, 'EXECUTE') THEN ' unexpected' ELSE ' missing' END
    FROM fn, roles
   WHERE has_function_privilege(roles.r, fn.oid, 'EXECUTE')
         <> EXISTS (SELECT 1 FROM want_fn w WHERE w.sig = fn.sig AND w.r = roles.r)
  UNION ALL
  SELECT 'PUBLIC or grant-option EXECUTE on ' || fn.sig
    FROM fn, aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
   WHERE a.grantee = 0 OR (a.is_grantable AND a.grantee <> fn.proowner)
  UNION ALL
  SELECT 'sequence privilege ' || s.oid::regclass::text || ' ' || roles.r
    FROM seqs s, roles
   WHERE has_sequence_privilege(roles.r, s.oid, 'USAGE')
      OR has_sequence_privilege(roles.r, s.oid, 'SELECT')
      OR has_sequence_privilege(roles.r, s.oid, 'UPDATE')
  UNION ALL
  SELECT 'PUBLIC or grant option on sequence ' || s.oid::regclass::text
    FROM seqs s JOIN pg_class c ON c.oid = s.oid, aclexplode(c.relacl) a
   WHERE a.grantee = 0 OR (a.is_grantable AND a.grantee <> c.relowner)
  UNION ALL
  SELECT 'policy set is not exactly the PR select-own policy'
   WHERE (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN (SELECT oid FROM rel)) <> 1
      OR NOT EXISTS (
        SELECT 1 FROM pg_policy p
         WHERE p.polrelid = to_regclass('public.exercise_personal_records')
           AND p.polname = 'exercise_personal_records_select_own'
           AND p.polcmd = 'r' AND p.polpermissive
           AND p.polroles = ARRAY['authenticated'::regrole::oid]
           -- Catalog identity, not deparsed text: the predicate depends on
           -- auth.uid() and on the user_id column, and its text is that
           -- comparison with or without the schema prefix (search_path).
           AND pg_get_expr(p.polqual, p.polrelid) ~ '^\((auth\.)?uid\(\) = user_id\)$'
           AND EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_policy'::regclass AND d.objid = p.oid
                          AND d.refclassid = 'pg_proc'::regclass
                          AND d.refobjid = 'auth.uid()'::regprocedure)
           AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_attribute a
                          ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                        WHERE d.classid = 'pg_policy'::regclass AND d.objid = p.oid
                          AND d.refobjid = p.polrelid AND a.attname = 'user_id')
           AND p.polwithcheck IS NULL)
  UNION ALL
  SELECT 'trigger inventory is not 13 enabled triggers'
   WHERE (SELECT count(*) FILTER (WHERE tgenabled = 'O') FROM pg_trigger
           WHERE tgrelid IN (SELECT oid FROM rel) AND NOT tgisinternal) <> 13
      OR (SELECT count(*) FROM pg_trigger
           WHERE tgrelid IN (SELECT oid FROM rel) AND NOT tgisinternal) <> 13
  UNION ALL
  SELECT 'missing domain ' || d FROM (VALUES ('engine_a_code'), ('engine_a_disclosure_kind')) v(d)
   WHERE to_regtype('public.' || d) IS NULL
  UNION ALL
  SELECT 'foreign key to public.workout_plans (belongs to M2)'
   WHERE EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.contype = 'f' AND c.conrelid IN (SELECT oid FROM rel)
                    AND c.confrelid = 'public.workout_plans'::regclass)

  UNION ALL
  SELECT 'control singleton is not off'
   WHERE (SELECT count(*) FROM public.engine_a_control) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.engine_a_control
                      WHERE id = 1 AND state = 'off' AND NOT admission_enabled
                        AND active_release_id IS NULL)
  UNION ALL
  SELECT 'seed control event missing or wrong'
   WHERE (SELECT count(*) FROM public.engine_a_control_events) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.engine_a_control_events
                      WHERE old_row IS NULL AND new_row ->> 'state' = 'off'
                        AND new_row ->> 'admission_enabled' = 'false'
                        AND new_row -> 'active_release_id' = 'null'::jsonb)
  UNION ALL
  SELECT 'data table not empty' WHERE
       EXISTS (SELECT 1 FROM public.engine_a_releases)
    OR EXISTS (SELECT 1 FROM public.engine_a_qa_accounts)
    OR EXISTS (SELECT 1 FROM public.engine_a_delist)
    OR EXISTS (SELECT 1 FROM public.engine_a_delist_events)
    OR EXISTS (SELECT 1 FROM public.engine_a_attempts)
    OR EXISTS (SELECT 1 FROM public.engine_a_decisions)
    OR EXISTS (SELECT 1 FROM public.engine_a_schedule_revisions)
    OR EXISTS (SELECT 1 FROM public.engine_a_schedule_offers)
    OR EXISTS (SELECT 1 FROM public.exercise_personal_records)
  UNION ALL
  SELECT 'migration ledger is not exactly the M1 applied row with routine baseline'
   WHERE (SELECT count(*) FROM public.engine_a_migration_events) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.engine_a_migration_events
                      WHERE step = 'M1' AND action = 'applied'
                        AND evidence -> 'routines' = public.engine_a_routine_baseline())
)
  SELECT string_agg(problem, '; ' ORDER BY problem) INTO v FROM problems;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: %', v;
  END IF;
END
$mig$;

NOTIFY pgrst, 'reload schema';

COMMIT;
