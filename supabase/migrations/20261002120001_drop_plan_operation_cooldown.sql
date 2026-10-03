-- 20261002120001_drop_plan_operation_cooldown.sql
-- REVERSE of 20261002120000_plan_operation_cooldown.sql
-- UNEXECUTED. Manual rollback only. Do not supabase db push. Do not apply this
-- file together with the forward migration. Apply in the SQL Editor only to
-- undo 20261002120000, after review.
-- The reverse file must NEVER be executed as part of a sequential migration
-- run. This repo's production migrations are applied one at a time by hand
-- in the SQL Editor. supabase db push is never run against production.
--
-- DEPLOY ORDER: roll the api/replace-plans.js that sends p_operation back
-- FIRST. After this file, the RPC has ten arguments again and that endpoint
-- can no longer save.
--
-- DATA LOSS ON ROLLBACK: workout_plans.operation, profiles.first_plan_at and
-- profiles.last_plan_adjustment_at are dropped. Every plan's operation label
-- and every user's adjustment anchor are lost and cannot be recovered.
-- Re-applying migration C backfills first_plan_at from the earliest plan, but
-- leaves last_plan_adjustment_at NULL: every running cooldown is reset.
--
-- Order:
--   1. guard: replace_user_plans_atomic is exactly migration C's
--      eleven-argument function (body md5), or exactly migration A's
--      ten-argument function with every migration C object absent
--   2. drop the eleven-argument function; create the exact ten-argument
--      migration A function (body verbatim from 20260928140000) and assert
--      md5 = a88fc6c9fa02ab37fd2390ccacde264a
--   3. re-apply migration A's owner and EXECUTE privileges
--   4. drop workout_plans_operation_valid and workout_plans.operation
--   5. drop workout_plans_user_id_idx, only if it carries migration C's marker
--      comment (an index that existed before migration C is kept)
--   6. drop profiles.first_plan_at and profiles.last_plan_adjustment_at
--   7. NOTIFY pgrst, 'reload schema' (delivered on commit only)
-- Nothing else is touched. No row is inserted, updated or deleted.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back everything
-- this file did in the same run.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   migration C installed -> steps 2-7
--   already rolled back   -> steps 2 and 4-6 are no-ops; privileges are
--                            re-applied; AFTER assertions still run
--   anything else         -> fail closed, no mutate

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.workout_plans IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE _poc_const (
  k text PRIMARY KEY,
  v text NOT NULL
) ON COMMIT DROP;

INSERT INTO _poc_const (k, v) VALUES
  ('a_body_md5',   'a88fc6c9fa02ab37fd2390ccacde264a'),
  ('c_body_md5',   '8a558cb77f1e686e1018f0f66dabd1ea'),
  ('a_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb, '
   || 'p_expected_safety_fingerprint text'),
  ('c_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb, '
   || 'p_expected_safety_fingerprint text, p_operation text'),
  ('rpc_result',
   'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)'),
  ('index_name',   'workout_plans_user_id_idx'),
  ('index_marker', 'created by 20261002120000_plan_operation_cooldown'),
  -- Verbatim copy of the migration A body in
  -- 20260928140000_profile_safety_fingerprint.sql.
  ('a_body', $fnbody$
DECLARE
  v_workout_found   uuid;
  v_nutrition_found uuid;
  v_workout_new     uuid;
  v_nutrition_new   uuid;
  v_profile_safety_fingerprint text;
  v_plan_safety_fingerprint    text;
BEGIN
  -- The only two validations that live in the database. Shape validation is the
  -- endpoint's, before any call is made.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'plan_owner_id_required' USING ERRCODE = '22004';
  END IF;

  IF p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'plan_attempt_id_required' USING ERRCODE = '22004';
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

  -- Fresh. Workout first, always. Only rows that are actually active are
  -- archived: false and NULL are left exactly as they are.
  UPDATE public.workout_plans
     SET is_active = false
   WHERE user_id = p_user_id
     AND is_active IS TRUE;

  INSERT INTO public.workout_plans
    (user_id, coach_id, plan_type, week_start, week_number, activate_on,
     plan_data, is_active, client_attempt_id, safety_fingerprint)
  VALUES
    (p_user_id, p_workout_coach_id, p_workout_plan_type, p_workout_week_start,
     p_workout_week_number, p_workout_activate_on, p_workout_plan_data, true,
     p_client_attempt_id, v_plan_safety_fingerprint)
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

  RETURN QUERY SELECT v_workout_new, v_nutrition_new, false;
END;
$fnbody$);

CREATE TEMP TABLE _poc_state (
  installed   boolean NOT NULL,
  rpc_comment text
) ON COMMIT DROP;

CREATE TEMP TABLE _profiles_pre ON COMMIT DROP AS
SELECT id, xmin AS row_xmin, ctid AS row_ctid
  FROM public.profiles;

CREATE TEMP TABLE _workout_plans_pre ON COMMIT DROP AS
SELECT id, xmin AS row_xmin, ctid AS row_ctid
  FROM public.workout_plans;

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
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rpc10_oid    oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');
  rpc11_oid    oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text)');
  rpc_oid      oid;
  is_ten       boolean;
  fn           record;
  n            integer;
  have_first   boolean;
  have_last    boolean;
  have_op      boolean;
  have_con     boolean;
  idx_oid      oid;
  idx_is_ours  boolean;
  rpc_is_a     boolean;
  rpc_is_c     boolean;
  is_installed boolean;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR (rpc10_oid IS NULL AND rpc11_oid IS NULL) THEN
    RAISE EXCEPTION 'precondition failed: replace_user_plans_atomic is absent, overloaded, or has another signature';
  END IF;

  is_ten  := rpc10_oid IS NOT NULL;
  rpc_oid := CASE WHEN is_ten THEN rpc10_oid ELSE rpc11_oid END;

  SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.pronargs,
         p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM
       (SELECT v FROM _poc_const WHERE k = CASE WHEN is_ten THEN 'a_ident' ELSE 'c_ident' END)
     OR pg_get_function_result(rpc_oid) IS DISTINCT FROM (SELECT v FROM _poc_const WHERE k = 'rpc_result')
     OR fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' OR NOT fn.prosecdef
     OR fn.provolatile <> 'v' OR NOT fn.proretset
     OR (is_ten AND (fn.pronargs <> 10 OR fn.pronargdefaults <> 2))
     OR (NOT is_ten AND (fn.pronargs <> 11 OR fn.pronargdefaults <> 3))
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'precondition failed: replace_user_plans_atomic matches neither the migration A nor the migration C contract outside its body';
  END IF;

  rpc_is_c := NOT is_ten AND md5(fn.prosrc) = (SELECT v FROM _poc_const WHERE k = 'c_body_md5');
  rpc_is_a := is_ten AND md5(fn.prosrc) = (SELECT v FROM _poc_const WHERE k = 'a_body_md5');

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
  idx_oid     := to_regclass('public.' || (SELECT v FROM _poc_const WHERE k = 'index_name'));
  idx_is_ours := idx_oid IS NOT NULL
                 AND obj_description(idx_oid, 'pg_class')
                     IS NOT DISTINCT FROM (SELECT v FROM _poc_const WHERE k = 'index_marker');

  IF rpc_is_c AND have_first AND have_last AND have_op AND have_con THEN
    is_installed := true;
  ELSIF rpc_is_a AND NOT (have_first OR have_last OR have_op OR have_con OR idx_is_ours) THEN
    is_installed := false;
  ELSE
    RAISE EXCEPTION 'precondition failed: RPC (% arguments, body md5 %) with profiles.first_plan_at=% profiles.last_plan_adjustment_at=% workout_plans.operation=% check=% marked index=% is neither migration C installed nor already rolled back',
      fn.pronargs, md5(fn.prosrc), have_first, have_last, have_op, have_con, idx_is_ours;
  END IF;

  -- Any comment on the installed function is carried back verbatim.
  INSERT INTO _poc_state (installed, rpc_comment)
  VALUES (is_installed, obj_description(rpc_oid, 'pg_proc'));
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. RESTORE THE EXACT MIGRATION A FUNCTION. Before the column drops:
--    migration C's body reads and writes the columns dropped below. No
--    CASCADE on the drop.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rpc_oid   oid;
  c_comment text := (SELECT rpc_comment FROM _poc_state);
BEGIN
  IF (SELECT installed FROM _poc_state) THEN
    DROP FUNCTION public.replace_user_plans_atomic(
      uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text, text);

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
      || 'p_expected_safety_fingerprint text DEFAULT NULL) '
      || 'RETURNS TABLE (workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean) '
      || 'LANGUAGE plpgsql VOLATILE SECURITY DEFINER '
      || 'SET search_path = public, pg_temp '
      || 'AS ' || quote_literal((SELECT v FROM _poc_const WHERE k = 'a_body'));

    IF c_comment IS NOT NULL THEN
      EXECUTE format(
        'COMMENT ON FUNCTION public.replace_user_plans_atomic('
        || 'uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text) IS %L',
        c_comment);
    END IF;
  END IF;

  rpc_oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');
  IF rpc_oid IS NULL
     OR md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = rpc_oid)) IS DISTINCT FROM 'a88fc6c9fa02ab37fd2390ccacde264a' THEN
    RAISE EXCEPTION 'rollback failed: restored RPC body md5 is %, expected a88fc6c9fa02ab37fd2390ccacde264a',
      md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = rpc_oid));
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. OWNERSHIP AND EXECUTE PRIVILEGES, exactly as migration A. Idempotent.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4-6. CHECK, COLUMN, INDEX (ours only), ANCHORS. No CASCADE: an unexpected
--      dependent object aborts the rollback instead of being dropped silently.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_operation_valid;

ALTER TABLE public.workout_plans
  DROP COLUMN IF EXISTS operation;

DO $mig$
DECLARE
  idx_oid oid := to_regclass('public.' || (SELECT v FROM _poc_const WHERE k = 'index_name'));
BEGIN
  IF idx_oid IS NOT NULL
     AND obj_description(idx_oid, 'pg_class')
         IS NOT DISTINCT FROM (SELECT v FROM _poc_const WHERE k = 'index_marker') THEN
    DROP INDEX public.workout_plans_user_id_idx;
  END IF;
END
$mig$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS first_plan_at,
  DROP COLUMN IF EXISTS last_plan_adjustment_at;

-- ---------------------------------------------------------------------------
-- 7. AFTER ASSERTIONS.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rpc_oid   oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');
  c_comment text := (SELECT rpc_comment FROM _poc_state);
  idx_oid   oid := to_regclass('public.' || (SELECT v FROM _poc_const WHERE k = 'index_name'));
  fn        record;
  n         bigint;
  n_pre     bigint;
  n_post    bigint;
BEGIN
  -- RPC: exactly one function, the ten-argument migration A function.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: expected exactly one replace_user_plans_atomic, the ten-argument one (found %)', n;
  END IF;

  SELECT p.pronamespace, p.prokind, p.prosecdef, p.provolatile, p.proretset,
         p.pronargs, p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF md5(fn.prosrc) IS DISTINCT FROM 'a88fc6c9fa02ab37fd2390ccacde264a'
     OR fn.prosrc IS DISTINCT FROM (SELECT v FROM _poc_const WHERE k = 'a_body') THEN
    RAISE EXCEPTION 'postcondition failed: RPC body md5 is %, expected migration A''s body', md5(fn.prosrc);
  END IF;
  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM (SELECT v FROM _poc_const WHERE k = 'a_ident')
     OR pg_get_function_result(rpc_oid) IS DISTINCT FROM (SELECT v FROM _poc_const WHERE k = 'rpc_result')
     OR fn.pronamespace <> 'public'::regnamespace OR fn.prokind <> 'f' OR fn.lanname <> 'plpgsql'
     OR NOT fn.prosecdef OR fn.provolatile <> 'v' OR NOT fn.proretset
     OR fn.pronargs <> 10 OR fn.pronargdefaults <> 2
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'postcondition failed: replace_user_plans_atomic does not match the migration A contract';
  END IF;
  IF obj_description(rpc_oid, 'pg_proc') IS DISTINCT FROM c_comment THEN
    RAISE EXCEPTION 'postcondition failed: RPC comment is %, expected % (carried over verbatim)',
      obj_description(rpc_oid, 'pg_proc'), c_comment;
  END IF;

  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid AND a.grantee = 0;
  IF n <> 0
     OR has_function_privilege('anon', rpc_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', rpc_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: RPC EXECUTE privileges are not the migration A set';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid
     AND a.grantee NOT IN (fn.proowner, 'service_role'::regrole::oid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: % unexpected grantee(s) on the RPC', n;
  END IF;

  -- Every migration C object is gone.
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE ((a.attrelid = 'public.profiles'::regclass
                      AND a.attname IN ('first_plan_at', 'last_plan_adjustment_at'))
                  OR (a.attrelid = 'public.workout_plans'::regclass
                      AND a.attname = 'operation'))
                AND a.attnum > 0 AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint c
                 WHERE c.conname = 'workout_plans_operation_valid')
     OR (idx_oid IS NOT NULL
         AND obj_description(idx_oid, 'pg_class')
             IS NOT DISTINCT FROM (SELECT v FROM _poc_const WHERE k = 'index_marker')) THEN
    RAISE EXCEPTION 'postcondition failed: a migration C object is still present';
  END IF;

  -- No row inserted, deleted or modified in either table.
  SELECT count(*) INTO n_pre  FROM _profiles_pre;
  SELECT count(*) INTO n_post FROM public.profiles;
  IF n_post IS DISTINCT FROM n_pre OR EXISTS (
    SELECT 1
      FROM public.profiles live
      FULL OUTER JOIN _profiles_pre snap ON snap.id = live.id
     WHERE snap.id IS NULL OR live.id IS NULL
        OR live.xmin IS DISTINCT FROM snap.row_xmin
        OR live.ctid IS DISTINCT FROM snap.row_ctid
  ) THEN
    RAISE EXCEPTION 'postcondition failed: a profiles row was inserted, deleted or modified';
  END IF;

  SELECT count(*) INTO n_pre  FROM _workout_plans_pre;
  SELECT count(*) INTO n_post FROM public.workout_plans;
  IF n_post IS DISTINCT FROM n_pre OR EXISTS (
    SELECT 1
      FROM public.workout_plans live
      FULL OUTER JOIN _workout_plans_pre snap ON snap.id = live.id
     WHERE snap.id IS NULL OR live.id IS NULL
        OR live.xmin IS DISTINCT FROM snap.row_xmin
        OR live.ctid IS DISTINCT FROM snap.row_ctid
  ) THEN
    RAISE EXCEPTION 'postcondition failed: a workout_plans row was inserted, deleted or modified';
  END IF;

  -- Every other column of both tables unchanged.
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
    RAISE EXCEPTION 'postcondition failed: a column other than migration C''s changed';
  END IF;
END
$mig$;

-- PostgREST caches function signatures; the ten-argument RPC is invisible to
-- /rest/v1/rpc until it reloads. NOTIFY is transactional: delivered only when
-- this transaction commits, never on rollback.
NOTIFY pgrst, 'reload schema';

COMMIT;
