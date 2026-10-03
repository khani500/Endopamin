-- 20261002120000_plan_operation_cooldown.sql
-- UNEXECUTED. This file is in the tree for review. It has not been applied to
-- any database. Do not supabase db push. Apply in the SQL Editor after review.
-- Reverse: 20261002120001_drop_plan_operation_cooldown.sql
-- The reverse file must NEVER be executed as a sequential follow-on. This
-- repo's production migrations are applied one at a time by hand in the SQL
-- Editor. supabase db push is never run against production.
-- Post-apply check: VERIFY_plan_operation_cooldown.sql (always rolls back).
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the api/replace-plans.js
-- that sends p_operation. The migration A function has no such parameter, so
-- that endpoint cannot save against the migration A catalog. The migration A
-- endpoint, in turn, keeps working against this migration: its ten named
-- arguments still resolve, and the eleventh defaults to NULL (legacy: no gate).
--
-- Migration C. A declared plan operation, proven by the RPC under its
-- auth.users lock, and a 7-day rolling allowance for plan adjustments:
--   public.profiles.first_plan_at            timestamptz NULL, RPC-written
--   public.profiles.last_plan_adjustment_at  timestamptz NULL, RPC-written
--   public.workout_plans.operation           text NULL, CHECK on 3 values
--   public.workout_plans_user_id_idx         btree (user_id), only if no
--                                            plain user_id index exists
--   public.replace_user_plans_atomic         migration A's ten arguments plus
--                                            p_operation text DEFAULT NULL
--
-- Operations (p_operation is the client's declared intent; the RPC proves it):
--   NULL                 TEMPORARY legacy compatibility: no gate.
--   initial_setup        only when first_plan_at IS NULL and the user has no
--                        workout_plans rows; else 45415.
--   feedback_adjustment  only when the user already has a plan and no
--                        feedback_adjustment succeeded in the last 7 days
--                        (server clock, rolling); else 45414 with DETAIL =
--                        next available time (UTC ISO-8601), or 45415 when
--                        the user has no plan at all.
--   safety_regeneration  only with a token, and only when the safety status
--                        computed under the lock is stale, unverified,
--                        no_active_plan or invalid_multiple_active_plans;
--                        else 45415. Never limited by the cooldown.
--   anything else        22023.
-- Every check runs before the first write, so a refused attempt writes
-- nothing and never consumes the allowance. A replay (same attempt id) is a
-- pure read and ignores p_operation.
--
-- Client privileges: neither new profiles column is granted to anon or
-- authenticated. 20260915180000 revoked table-level INSERT/UPDATE on profiles
-- and granted back a column allow-list, so a new column is locked. This file
-- asserts that precondition and that result; it grants nothing to clients.
-- workout_plans.operation is NOT protected from client writes here: the
-- workout_plans FOR ALL policy is migration B's scope. The cooldown anchor is
-- therefore profiles.last_plan_adjustment_at, never workout_plans.operation.
--
-- Data writes: on a fresh run, profiles.first_plan_at is backfilled to
-- MIN(workout_plans.generated_at) per user who has plans with a non-NULL
-- generated_at. Every other profiles column, and every workout_plans row, is
-- left exactly as it is. last_plan_adjustment_at stays NULL for everyone: no
-- save made before this migration counts as an adjustment.
--
-- Pinned trigger functions on public.profiles (production md5(prosrc)
-- measured 2026-10-02). The RPC now updates profiles, which fires all three;
-- any other trigger, or any other body, aborts this file before a mutation:
--   trg_protect_onboarding_completed_latch  2ba28d83975dd1d061e8c4ca7d35b1f4
--   trg_protect_profile_billing             267a03753824a7c0c5e39be1bf6785e2
--   trg_set_profile_safety_fingerprint      038f21e089322300f22e5aa840f676d9
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back
-- everything this file did in the same run. The ten-argument function is
-- dropped and the eleven-argument function created inside that transaction,
-- so no other session ever sees neither, or both.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   fresh: none of the objects above exist and replace_user_plans_atomic is
--     the ten-argument migration A function (body md5
--     a88fc6c9fa02ab37fd2390ccacde264a)
--     -> install everything, backfill, assert
--   installed: every object above already exists exactly as specified here
--     and replace_user_plans_atomic is the eleven-argument function with this
--     file's body
--     -> nothing is created or replaced; privileges are re-applied; no row is
--        written; AFTER assertions still run
--   anything else (partial install, other RPC body, other types)
--     -> fail closed, no mutate

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- Both tables get a column. Taken up front, in one order (migration A's), so
-- the whole run sees one state. replace_user_plans_atomic waits on these.
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.workout_plans IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 0. CONSTANTS. The RPC body lives here exactly once. Every create and every
--    body assertion below reads it from this table.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _poc_const (
  k text PRIMARY KEY,
  v text NOT NULL
) ON COMMIT DROP;

INSERT INTO _poc_const (k, v) VALUES
  ('a_body_md5',       'a88fc6c9fa02ab37fd2390ccacde264a'),
  ('latch_md5',        '2ba28d83975dd1d061e8c4ca7d35b1f4'),
  ('billing_md5',      '267a03753824a7c0c5e39be1bf6785e2'),
  ('fingerprint_md5',  '038f21e089322300f22e5aa840f676d9'),
  ('a_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb, '
   || 'p_expected_safety_fingerprint text'),
  ('rpc_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb, '
   || 'p_expected_safety_fingerprint text, p_operation text'),
  ('rpc_result',
   'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)'),
  ('operation_check',
   $chk$CHECK (((operation IS NULL) OR (operation = ANY (ARRAY['initial_setup'::text, 'feedback_adjustment'::text, 'safety_regeneration'::text]))))$chk$),
  ('index_name',       'workout_plans_user_id_idx'),
  ('index_marker',     'created by 20261002120000_plan_operation_cooldown'),
  ('rpc_body', $fnbody$
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
$fnbody$);

CREATE TEMP TABLE _poc_state (
  installed    boolean NOT NULL,
  create_index boolean NOT NULL,
  rpc_comment  text
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Snapshot row identities and column catalogs BEFORE any change.
-- profiles: the id set detects insert/delete; the row image minus the two new
--   columns detects a change to any other column (xmin cannot, because the
--   backfill legitimately updates rows on a fresh run).
-- workout_plans: nothing may touch a row at all, so xmin/ctid must hold.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _profiles_pre ON COMMIT DROP AS
SELECT p.id,
       p.xmin AS row_xmin,
       p.ctid AS row_ctid,
       to_jsonb(p) - 'first_plan_at' - 'last_plan_adjustment_at' AS row_image
  FROM public.profiles p;

CREATE TEMP TABLE _workout_plans_pre ON COMMIT DROP AS
SELECT w.id, w.xmin AS row_xmin, w.ctid AS row_ctid
  FROM public.workout_plans w;

CREATE TEMP TABLE _attr_pre ON COMMIT DROP AS
SELECT a.attrelid::regclass::text AS tbl,
       a.attname,
       a.attnum,
       a.atttypid,
       a.atttypmod,
       a.attnotnull,
       a.atthasdef,
       pg_get_expr(d.adbin, d.adrelid) AS def
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass)
   AND a.attname NOT IN ('first_plan_at', 'last_plan_adjustment_at', 'operation')
   AND a.attnum > 0
   AND NOT a.attisdropped;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED. Decides fresh or installed; anything else
--    aborts before a single object is changed.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  t              text;
  r              text;
  rel            record;
  spec           record;
  att            record;
  fn             record;
  con            record;
  n              integer;
  trg_names      text[];
  rpc_oid        oid;
  rpc10_oid      oid;
  rpc11_oid      oid;
  is_ten         boolean;
  rpc_is_a       boolean;
  rpc_is_new     boolean;
  have_first     boolean;
  have_last      boolean;
  have_op        boolean;
  have_con       boolean;
  have_idx_name  boolean;
  idx_oid        oid;
  plain_user_idx boolean;
  is_installed   boolean;
  c_a_md5        text := (SELECT v FROM _poc_const WHERE k = 'a_body_md5');
  c_a_ident      text := (SELECT v FROM _poc_const WHERE k = 'a_ident');
  c_rpc_ident    text := (SELECT v FROM _poc_const WHERE k = 'rpc_ident');
  c_rpc_result   text := (SELECT v FROM _poc_const WHERE k = 'rpc_result');
  c_rpc_body     text := (SELECT v FROM _poc_const WHERE k = 'rpc_body');
  c_op_check     text := (SELECT v FROM _poc_const WHERE k = 'operation_check');
  c_idx_name     text := (SELECT v FROM _poc_const WHERE k = 'index_name');
  c_idx_marker   text := (SELECT v FROM _poc_const WHERE k = 'index_marker');
BEGIN
  -- Relations and roles.
  FOREACH t IN ARRAY ARRAY['public.profiles', 'public.workout_plans', 'public.nutrition_plans'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'precondition failed: relation % does not exist', t;
    END IF;
    SELECT c.relkind, c.relnamespace INTO rel FROM pg_class c WHERE c.oid = to_regclass(t);
    IF rel.relkind <> 'r' OR rel.relnamespace <> 'public'::regnamespace THEN
      RAISE EXCEPTION 'precondition failed: % is not an ordinary table in schema public', t;
    END IF;
  END LOOP;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'precondition failed: auth.users does not exist';
  END IF;

  FOREACH r IN ARRAY ARRAY['postgres', 'service_role', 'anon', 'authenticated'] LOOP
    IF to_regrole(quote_ident(r)) IS NULL THEN
      RAISE EXCEPTION 'precondition failed: role % does not exist', r;
    END IF;
  END LOOP;

  -- The columns the backfill, the gate and the RPC read, with measured types.
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.profiles',      'id',                 'uuid'),
      ('public.profiles',      'safety_fingerprint', 'text'),
      ('public.workout_plans', 'id',                 'uuid'),
      ('public.workout_plans', 'user_id',            'uuid'),
      ('public.workout_plans', 'is_active',          'boolean'),
      ('public.workout_plans', 'generated_at',       'timestamp with time zone'),
      ('public.workout_plans', 'safety_fingerprint', 'text'),
      ('public.workout_plans', 'client_attempt_id',  'uuid')
    ) AS v(tbl, col, typ)
  LOOP
    SELECT a.atttypid INTO att
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass(spec.tbl)
       AND a.attname  = spec.col
       AND a.attnum   > 0
       AND NOT a.attisdropped;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'precondition failed: %.% does not exist', spec.tbl, spec.col;
    END IF;
    IF att.atttypid <> spec.typ::regtype THEN
      RAISE EXCEPTION 'precondition failed: %.% is type %, expected %',
        spec.tbl, spec.col, format_type(att.atttypid, NULL), spec.typ;
    END IF;
  END LOOP;

  -- The column allow-list of 20260915180000 must be in place: no table-level
  -- INSERT or UPDATE on profiles for clients. Otherwise a new column would be
  -- client-writable the moment it exists.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.profiles', 'INSERT')
       OR has_table_privilege(r, 'public.profiles', 'UPDATE') THEN
      RAISE EXCEPTION 'precondition failed: % holds table-level INSERT or UPDATE on public.profiles; the 20260915180000 column allow-list is not in place', r;
    END IF;
  END LOOP;

  -- Triggers on profiles: exactly the three measured user triggers, each on
  -- its measured function, each function with its measured body. The RPC now
  -- updates profiles and fires all three.
  SELECT array_agg(g.tgname::text ORDER BY g.tgname::text COLLATE "C")
    INTO trg_names
    FROM pg_trigger g
   WHERE g.tgrelid = 'public.profiles'::regclass
     AND NOT g.tgisinternal;
  IF trg_names IS DISTINCT FROM ARRAY['trg_protect_onboarding_completed_latch',
                                      'trg_protect_profile_billing',
                                      'trg_set_profile_safety_fingerprint'] THEN
    RAISE EXCEPTION 'precondition failed: user triggers on public.profiles are %, not the measured three', trg_names;
  END IF;

  FOR spec IN
    SELECT * FROM (VALUES
      ('trg_protect_onboarding_completed_latch', 'protect_onboarding_completed_latch', 'latch_md5'),
      ('trg_protect_profile_billing',            'protect_profile_billing_columns',    'billing_md5'),
      ('trg_set_profile_safety_fingerprint',     'set_profile_safety_fingerprint',     'fingerprint_md5')
    ) AS v(tgname, fname, md5_key)
  LOOP
    SELECT count(*) INTO n FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = spec.fname;
    IF n <> 1 OR to_regprocedure('public.' || spec.fname || '()') IS NULL THEN
      RAISE EXCEPTION 'precondition failed: public.%() is absent, overloaded or has arguments', spec.fname;
    END IF;
    IF (SELECT g.tgfoid FROM pg_trigger g
         WHERE g.tgrelid = 'public.profiles'::regclass
           AND g.tgname = spec.tgname)
       IS DISTINCT FROM to_regprocedure('public.' || spec.fname || '()')::oid THEN
      RAISE EXCEPTION 'precondition failed: trigger % does not call public.%()', spec.tgname, spec.fname;
    END IF;
    IF (SELECT md5(p.prosrc) FROM pg_proc p
         WHERE p.oid = to_regprocedure('public.' || spec.fname || '()'))
       IS DISTINCT FROM (SELECT v FROM _poc_const WHERE k = spec.md5_key) THEN
      RAISE EXCEPTION 'precondition failed: public.%() body md5 is %, expected %',
        spec.fname,
        (SELECT md5(p.prosrc) FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.' || spec.fname || '()')),
        (SELECT v FROM _poc_const WHERE k = spec.md5_key);
    END IF;
  END LOOP;

  -- replace_user_plans_atomic: exactly one function, and it is either the
  -- ten-argument migration A function with migration A's body, or the
  -- eleven-argument function with this file's body.
  SELECT count(*) INTO n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 THEN
    RAISE EXCEPTION 'precondition failed: % functions named public.replace_user_plans_atomic; expected exactly one', n;
  END IF;

  rpc10_oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');
  rpc11_oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text)');

  is_ten := rpc10_oid IS NOT NULL;
  IF is_ten THEN
    rpc_oid := rpc10_oid;
  ELSIF rpc11_oid IS NOT NULL THEN
    rpc_oid := rpc11_oid;
  ELSE
    RAISE EXCEPTION 'precondition failed: public.replace_user_plans_atomic has neither the migration A signature nor this file''s signature';
  END IF;

  SELECT p.pronamespace, p.prokind, p.prosecdef, p.provolatile, p.proretset,
         p.pronargs, p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM
       (CASE WHEN is_ten THEN c_a_ident ELSE c_rpc_ident END) THEN
    RAISE EXCEPTION 'precondition failed: RPC identity arguments are %',
      pg_get_function_identity_arguments(rpc_oid);
  END IF;
  IF (is_ten AND (fn.pronargs <> 10 OR fn.pronargdefaults <> 2))
     OR (NOT is_ten AND (fn.pronargs <> 11 OR fn.pronargdefaults <> 3)) THEN
    RAISE EXCEPTION 'precondition failed: RPC has % arguments with % default(s)',
      fn.pronargs, fn.pronargdefaults;
  END IF;
  IF pg_get_function_result(rpc_oid) IS DISTINCT FROM c_rpc_result THEN
    RAISE EXCEPTION 'precondition failed: RPC result is %, expected %',
      pg_get_function_result(rpc_oid), c_rpc_result;
  END IF;
  IF fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' THEN
    RAISE EXCEPTION 'precondition failed: RPC prokind=% lanname=%, expected a plpgsql function',
      fn.prokind, fn.lanname;
  END IF;
  IF NOT fn.prosecdef THEN
    RAISE EXCEPTION 'precondition failed: RPC is not SECURITY DEFINER';
  END IF;
  IF fn.provolatile <> 'v' OR NOT fn.proretset THEN
    RAISE EXCEPTION 'precondition failed: RPC is not a VOLATILE set-returning function';
  END IF;
  IF fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'precondition failed: RPC proconfig is %, expected {"search_path=public, pg_temp"}',
      fn.proconfig;
  END IF;
  IF fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'precondition failed: RPC owner is %, expected postgres', fn.proowner::regrole;
  END IF;

  rpc_is_a   := is_ten AND md5(fn.prosrc) = c_a_md5;
  rpc_is_new := NOT is_ten AND fn.prosrc = c_rpc_body;
  IF NOT rpc_is_a AND NOT rpc_is_new THEN
    RAISE EXCEPTION 'precondition failed: RPC body md5 is %, expected migration A''s body (%) on the ten-argument function or exactly this migration''s body on the eleven-argument function; refusing to replace',
      md5(fn.prosrc), c_a_md5;
  END IF;

  -- Presence of every object this file creates.
  have_first := EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = 'public.profiles'::regclass
                           AND a.attname = 'first_plan_at'
                           AND a.attnum > 0 AND NOT a.attisdropped);
  have_last  := EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = 'public.profiles'::regclass
                           AND a.attname = 'last_plan_adjustment_at'
                           AND a.attnum > 0 AND NOT a.attisdropped);
  have_op    := EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = 'public.workout_plans'::regclass
                           AND a.attname = 'operation'
                           AND a.attnum > 0 AND NOT a.attisdropped);
  have_con   := EXISTS (SELECT 1 FROM pg_constraint c
                         WHERE c.conrelid = 'public.workout_plans'::regclass
                           AND c.conname = 'workout_plans_operation_valid');
  idx_oid       := to_regclass('public.' || c_idx_name);
  have_idx_name := idx_oid IS NOT NULL;

  -- Any valid, non-partial, non-expression btree index on (user_id) alone.
  plain_user_idx := EXISTS (
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
       AND i.indisready
       AND am.amname = 'btree');

  IF rpc_is_a AND NOT (have_first OR have_last OR have_op OR have_con) THEN
    is_installed := false;
    -- An index under this file's name must not already exist on a fresh run.
    IF have_idx_name THEN
      RAISE EXCEPTION 'precondition failed: a relation named public.% exists before a fresh install', c_idx_name;
    END IF;
  ELSIF rpc_is_new AND have_first AND have_last AND have_op AND have_con THEN
    is_installed := true;
  ELSE
    RAISE EXCEPTION 'precondition failed: partial state (rpc_is_a=% rpc_is_new=% profiles.first_plan_at=% profiles.last_plan_adjustment_at=% workout_plans.operation=% check=%); refusing to proceed',
      rpc_is_a, rpc_is_new, have_first, have_last, have_op, have_con;
  END IF;

  IF is_installed THEN
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
         AND a.attname = spec.col;
      IF att.atttypid <> spec.typ::regtype OR att.attnotnull OR att.atthasdef THEN
        RAISE EXCEPTION 'precondition failed: installed %.% is not % NULL without default',
          spec.tbl, spec.col, spec.typ;
      END IF;
    END LOOP;

    SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def INTO con
      FROM pg_constraint c
     WHERE c.conrelid = 'public.workout_plans'::regclass
       AND c.conname = 'workout_plans_operation_valid';
    IF con.contype <> 'c' OR NOT con.convalidated OR con.def IS DISTINCT FROM c_op_check THEN
      RAISE EXCEPTION 'precondition failed: installed workout_plans_operation_valid is %', con.def;
    END IF;

    IF NOT plain_user_idx THEN
      RAISE EXCEPTION 'precondition failed: installed, but workout_plans has no plain btree index on (user_id)';
    END IF;
    IF have_idx_name AND obj_description(idx_oid, 'pg_class') IS DISTINCT FROM c_idx_marker THEN
      RAISE EXCEPTION 'precondition failed: public.% exists without this file''s marker comment', c_idx_name;
    END IF;
  END IF;

  -- The RPC comment, if any, is carried over verbatim to the eleven-argument
  -- function. Migration A set none; this is read, not assumed.
  INSERT INTO _poc_state (installed, create_index, rpc_comment)
  VALUES (is_installed, NOT is_installed AND NOT plain_user_idx, obj_description(rpc_oid, 'pg_proc'));
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. profiles anchors. NULL, no default. Not granted to anon or authenticated:
--    the 20260915180000 allow-list leaves a new column locked to clients.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _poc_state) THEN
    ALTER TABLE public.profiles
      ADD COLUMN first_plan_at timestamptz,
      ADD COLUMN last_plan_adjustment_at timestamptz;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. BACKFILL first_plan_at on a fresh run only: the earliest generated_at of
--    the user's plans. Users with no plans, or only NULL generated_at, stay
--    NULL (the gates also check for plan rows). last_plan_adjustment_at stays
--    NULL for everyone. The profiles triggers fire on this UPDATE: the latch
--    and billing guards return at once (no auth.uid()), and the fingerprint
--    trigger recomputes the unchanged value.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _poc_state) THEN
    UPDATE public.profiles p
       SET first_plan_at = m.first_generated_at
      FROM (SELECT w.user_id, min(w.generated_at) AS first_generated_at
              FROM public.workout_plans w
             WHERE w.user_id IS NOT NULL
             GROUP BY w.user_id) m
     WHERE p.id = m.user_id
       AND m.first_generated_at IS NOT NULL;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 4. workout_plans.operation. NULL, no default, no backfill: every existing
--    plan stays NULL. Client writes to this column are migration B's scope.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _poc_state) THEN
    ALTER TABLE public.workout_plans
      ADD COLUMN operation text;
    ALTER TABLE public.workout_plans
      ADD CONSTRAINT workout_plans_operation_valid
      CHECK (operation IS NULL OR operation IN ('initial_setup', 'feedback_adjustment', 'safety_regeneration'));
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 5. Plain index on workout_plans(user_id), only when none exists. The
--    initial_setup gate, the archive UPDATE and the safety status all filter
--    on user_id. The marker comment lets the reverse file drop only an index
--    this file created.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF (SELECT create_index FROM _poc_state) THEN
    CREATE INDEX workout_plans_user_id_idx
      ON public.workout_plans USING btree (user_id);
    EXECUTE format('COMMENT ON INDEX public.workout_plans_user_id_idx IS %L',
                   (SELECT v FROM _poc_const WHERE k = 'index_marker'));
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 6. replace_user_plans_atomic. The ten-argument function is dropped and an
--    eleven-argument function created: the same ten parameters, defaults and
--    return type, plus p_operation text DEFAULT NULL. DROP + CREATE rather
--    than CREATE OR REPLACE: adding a parameter creates a new overload, and
--    the contract is a single function. No CASCADE: an unexpected dependent
--    object aborts the migration.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  c_comment text := (SELECT rpc_comment FROM _poc_state);
BEGIN
  IF NOT (SELECT installed FROM _poc_state) THEN
    DROP FUNCTION public.replace_user_plans_atomic(
      uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text);

    EXECUTE
      'CREATE FUNCTION public.replace_user_plans_atomic('
      || 'p_user_id uuid, '
      || 'p_client_attempt_id uuid, '
      || 'p_workout_coach_id text, '
      || 'p_workout_plan_type text, '
      || 'p_workout_week_start date, '
      || 'p_workout_week_number integer, '
      || 'p_workout_activate_on date, '
      || 'p_workout_plan_data jsonb, '
      || 'p_nutrition_plan_data jsonb DEFAULT NULL, '
      || 'p_expected_safety_fingerprint text DEFAULT NULL, '
      || 'p_operation text DEFAULT NULL) '
      || 'RETURNS TABLE (workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean) '
      || 'LANGUAGE plpgsql VOLATILE SECURITY DEFINER '
      || 'SET search_path = public, pg_temp '
      || 'AS ' || quote_literal((SELECT v FROM _poc_const WHERE k = 'rpc_body'));

    IF c_comment IS NOT NULL THEN
      EXECUTE format(
        'COMMENT ON FUNCTION public.replace_user_plans_atomic('
        || 'uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text) IS %L',
        c_comment);
    END IF;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 7. RPC OWNERSHIP AND EXECUTE PRIVILEGES, as migration A, on the new
--    signature. Idempotent. The new function starts with PUBLIC EXECUTE (and
--    whatever default privileges grant); nothing outside this transaction
--    sees that.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 8. AFTER ASSERTIONS.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  is_installed  boolean := (SELECT installed FROM _poc_state);
  did_index     boolean := (SELECT create_index FROM _poc_state);
  c_comment     text := (SELECT rpc_comment FROM _poc_state);
  c_rpc_ident   text := (SELECT v FROM _poc_const WHERE k = 'rpc_ident');
  c_rpc_result  text := (SELECT v FROM _poc_const WHERE k = 'rpc_result');
  c_rpc_body    text := (SELECT v FROM _poc_const WHERE k = 'rpc_body');
  c_a_md5       text := (SELECT v FROM _poc_const WHERE k = 'a_body_md5');
  c_op_check    text := (SELECT v FROM _poc_const WHERE k = 'operation_check');
  c_idx_name    text := (SELECT v FROM _poc_const WHERE k = 'index_name');
  c_idx_marker  text := (SELECT v FROM _poc_const WHERE k = 'index_marker');
  rpc_oid       oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text)');
  fn            record;
  att           record;
  con           record;
  spec          record;
  r             text;
  col_name      text;
  trg_names     text[];
  n             bigint;
  n_pre         bigint;
  n_post        bigint;
BEGIN
  -- profiles: no row inserted or deleted, no column other than the two new
  -- ones changed.
  SELECT count(*) INTO n_pre  FROM _profiles_pre;
  SELECT count(*) INTO n_post FROM public.profiles;
  IF n_post IS DISTINCT FROM n_pre THEN
    RAISE EXCEPTION 'postcondition failed: profiles row count changed from % to %', n_pre, n_post;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.profiles live
      FULL OUTER JOIN _profiles_pre snap ON snap.id = live.id
     WHERE snap.id IS NULL
        OR live.id IS NULL
        OR (to_jsonb(live) - 'first_plan_at' - 'last_plan_adjustment_at') IS DISTINCT FROM snap.row_image
  ) THEN
    RAISE EXCEPTION 'postcondition failed: a profiles row was inserted, deleted, or changed outside first_plan_at/last_plan_adjustment_at';
  END IF;

  IF is_installed THEN
    -- No row of profiles may have been written at all.
    IF EXISTS (
      SELECT 1
        FROM public.profiles live
        JOIN _profiles_pre snap ON snap.id = live.id
       WHERE live.xmin IS DISTINCT FROM snap.row_xmin
          OR live.ctid IS DISTINCT FROM snap.row_ctid
    ) THEN
      RAISE EXCEPTION 'postcondition failed: a profiles row was rewritten on an already-installed catalog';
    END IF;
  ELSE
    -- Backfill: first_plan_at is exactly the earliest generated_at per user;
    -- last_plan_adjustment_at is NULL everywhere.
    SELECT count(*) INTO n
      FROM public.profiles p
      LEFT JOIN (SELECT w.user_id, min(w.generated_at) AS first_generated_at
                   FROM public.workout_plans w
                  WHERE w.user_id IS NOT NULL
                  GROUP BY w.user_id) m ON m.user_id = p.id
     WHERE p.first_plan_at IS DISTINCT FROM m.first_generated_at;
    IF n <> 0 THEN
      RAISE EXCEPTION 'postcondition failed: % profiles rows have first_plan_at different from their earliest plan', n;
    END IF;

    SELECT count(*) INTO n FROM public.profiles p WHERE p.last_plan_adjustment_at IS NOT NULL;
    IF n <> 0 THEN
      RAISE EXCEPTION 'postcondition failed: % profiles rows have a last_plan_adjustment_at after a fresh install', n;
    END IF;

    SELECT count(*) INTO n FROM public.workout_plans w WHERE w.operation IS NOT NULL;
    IF n <> 0 THEN
      RAISE EXCEPTION 'postcondition failed: % workout_plans rows have an operation after a fresh install', n;
    END IF;
  END IF;

  -- workout_plans: no row touched at all.
  SELECT count(*) INTO n_pre  FROM _workout_plans_pre;
  SELECT count(*) INTO n_post FROM public.workout_plans;
  IF n_post IS DISTINCT FROM n_pre THEN
    RAISE EXCEPTION 'postcondition failed: workout_plans row count changed from % to %', n_pre, n_post;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.workout_plans live
      FULL OUTER JOIN _workout_plans_pre snap ON snap.id = live.id
     WHERE snap.id IS NULL
        OR live.id IS NULL
        OR live.xmin IS DISTINCT FROM snap.row_xmin
        OR live.ctid IS DISTINCT FROM snap.row_ctid
  ) THEN
    RAISE EXCEPTION 'postcondition failed: a workout_plans row was inserted, deleted or modified';
  END IF;

  -- Other columns of both tables unchanged.
  IF EXISTS (
    SELECT 1
      FROM (
        SELECT a.attrelid::regclass::text AS tbl, a.attname, a.attnum, a.atttypid,
               a.atttypmod, a.attnotnull, a.atthasdef, pg_get_expr(d.adbin, d.adrelid) AS def
          FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass)
           AND a.attname NOT IN ('first_plan_at', 'last_plan_adjustment_at', 'operation')
           AND a.attnum > 0
           AND NOT a.attisdropped
      ) live
      FULL OUTER JOIN _attr_pre snap
        ON snap.tbl = live.tbl AND snap.attname = live.attname
     WHERE snap.attname IS NULL
        OR live.attname IS NULL
        OR live.attnum     IS DISTINCT FROM snap.attnum
        OR live.atttypid   IS DISTINCT FROM snap.atttypid
        OR live.atttypmod  IS DISTINCT FROM snap.atttypmod
        OR live.attnotnull IS DISTINCT FROM snap.attnotnull
        OR live.atthasdef  IS DISTINCT FROM snap.atthasdef
        OR live.def        IS DISTINCT FROM snap.def
  ) THEN
    RAISE EXCEPTION 'postcondition failed: a column other than the three new ones changed on profiles or workout_plans';
  END IF;

  -- The three new columns: types, nullability, no default.
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
      RAISE EXCEPTION 'postcondition failed: %.% is not % NULL without default', spec.tbl, spec.col, spec.typ;
    END IF;
  END LOOP;

  SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def INTO con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.workout_plans'::regclass
     AND c.conname = 'workout_plans_operation_valid';
  IF NOT FOUND OR con.contype <> 'c' OR NOT con.convalidated OR con.def IS DISTINCT FROM c_op_check THEN
    RAISE EXCEPTION 'postcondition failed: workout_plans_operation_valid is %, expected %', con.def, c_op_check;
  END IF;

  -- Clients hold no INSERT or UPDATE on either anchor.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH col_name IN ARRAY ARRAY['first_plan_at', 'last_plan_adjustment_at'] LOOP
      IF has_column_privilege(r, 'public.profiles', col_name, 'INSERT')
         OR has_column_privilege(r, 'public.profiles', col_name, 'UPDATE') THEN
        RAISE EXCEPTION 'postcondition failed: % can INSERT or UPDATE profiles.%', r, col_name;
      END IF;
    END LOOP;
  END LOOP;

  -- The index on workout_plans(user_id).
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
       AND i.indisready
       AND am.amname = 'btree') THEN
    RAISE EXCEPTION 'postcondition failed: workout_plans has no plain btree index on (user_id)';
  END IF;
  IF did_index AND obj_description(to_regclass('public.' || c_idx_name), 'pg_class')
                   IS DISTINCT FROM c_idx_marker THEN
    RAISE EXCEPTION 'postcondition failed: public.% lacks this file''s marker comment', c_idx_name;
  END IF;

  -- Triggers on profiles: still exactly the measured three.
  SELECT array_agg(g.tgname::text ORDER BY g.tgname::text COLLATE "C")
    INTO trg_names
    FROM pg_trigger g
   WHERE g.tgrelid = 'public.profiles'::regclass
     AND NOT g.tgisinternal;
  IF trg_names IS DISTINCT FROM ARRAY['trg_protect_onboarding_completed_latch',
                                      'trg_protect_profile_billing',
                                      'trg_set_profile_safety_fingerprint'] THEN
    RAISE EXCEPTION 'postcondition failed: user triggers on public.profiles are %', trg_names;
  END IF;

  -- RPC: exactly one function; the eleven-argument contract.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: expected exactly one replace_user_plans_atomic, the eleven-argument one (found %)', n;
  END IF;
  IF to_regprocedure(
       'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: the ten-argument migration A function still exists';
  END IF;

  SELECT p.pronamespace, p.prokind, p.prosecdef, p.provolatile, p.proretset,
         p.pronargs, p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM c_rpc_ident THEN
    RAISE EXCEPTION 'postcondition failed: RPC identity arguments are %', pg_get_function_identity_arguments(rpc_oid);
  END IF;
  IF pg_get_function_result(rpc_oid) IS DISTINCT FROM c_rpc_result THEN
    RAISE EXCEPTION 'postcondition failed: RPC result is %', pg_get_function_result(rpc_oid);
  END IF;
  IF fn.pronamespace <> 'public'::regnamespace OR fn.prokind <> 'f' OR fn.lanname <> 'plpgsql'
     OR NOT fn.prosecdef OR fn.provolatile <> 'v' OR NOT fn.proretset
     OR fn.pronargs <> 11 OR fn.pronargdefaults <> 3 THEN
    RAISE EXCEPTION 'postcondition failed: RPC language, security, volatility or arity is not the eleven-argument contract';
  END IF;
  IF fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'postcondition failed: RPC proconfig is %', fn.proconfig;
  END IF;
  IF fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'postcondition failed: RPC owner is %', fn.proowner::regrole;
  END IF;
  IF md5(fn.prosrc) IS DISTINCT FROM md5(c_rpc_body) OR fn.prosrc IS DISTINCT FROM c_rpc_body THEN
    RAISE EXCEPTION 'postcondition failed: RPC body md5 is %, expected %', md5(fn.prosrc), md5(c_rpc_body);
  END IF;
  IF md5(fn.prosrc) = c_a_md5 THEN
    RAISE EXCEPTION 'postcondition failed: RPC body is still migration A''s body';
  END IF;
  IF obj_description(rpc_oid, 'pg_proc') IS DISTINCT FROM c_comment THEN
    RAISE EXCEPTION 'postcondition failed: RPC comment is %, expected % (carried over verbatim)',
      obj_description(rpc_oid, 'pg_proc'), c_comment;
  END IF;

  IF NOT has_table_privilege(fn.proowner::regrole::text, 'auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition failed: the definer cannot SELECT auth.users';
  END IF;
  IF NOT has_column_privilege(fn.proowner::regrole::text, 'public.profiles', 'last_plan_adjustment_at', 'UPDATE')
     OR NOT has_column_privilege(fn.proowner::regrole::text, 'public.profiles', 'first_plan_at', 'UPDATE') THEN
    RAISE EXCEPTION 'postcondition failed: the definer cannot UPDATE the profiles anchors';
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid AND a.grantee = 0;
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC holds % privilege(s) on the RPC', n;
  END IF;
  IF has_function_privilege('anon', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: anon can execute the RPC';
  END IF;
  IF has_function_privilege('authenticated', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: authenticated can execute the RPC';
  END IF;
  IF NOT has_function_privilege('service_role', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: service_role cannot execute the RPC';
  END IF;
  SELECT count(*) INTO n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid
     AND a.grantee NOT IN (fn.proowner, 'service_role'::regrole::oid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: % unexpected grantee(s) on the RPC', n;
  END IF;
END
$mig$;

-- PostgREST caches function signatures. The eleven-argument RPC is invisible
-- to /rest/v1/rpc until it reloads. NOTIFY is transactional: it is delivered
-- only when this transaction commits, and never on rollback.
NOTIFY pgrst, 'reload schema';

COMMIT;
