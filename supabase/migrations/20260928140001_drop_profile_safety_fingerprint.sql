-- 20260928140001_drop_profile_safety_fingerprint.sql
-- REVERSE of 20260928140000_profile_safety_fingerprint.sql
-- UNEXECUTED. Manual rollback only. Do not supabase db push. Do not apply this
-- file together with the forward migration. Apply in the SQL Editor only to
-- undo 20260928140000, after review.
-- The reverse file must NEVER be executed as part of a sequential migration
-- run. This repo's production migrations are applied one at a time by hand
-- in the SQL Editor. supabase db push is never run against production.
--
-- DEPLOY ORDER: roll the api/replace-plans.js that sends
-- p_expected_safety_fingerprint back FIRST. After this file, the RPC has nine
-- arguments again and that endpoint can no longer save.
--
-- DATA LOSS ON ROLLBACK: workout_plans.safety_fingerprint is dropped. The
-- fingerprints of every plan saved after migration A are lost and cannot be
-- recovered; re-applying migration A leaves those plans NULL (= unverified).
-- profiles.safety_fingerprint is dropped too; it is derived data and migration
-- A recomputes it.
--
-- Order:
--   1. guard: replace_user_plans_atomic is exactly migration A's ten-argument
--      function (body md5)
--   2. drop the ten-argument function; create the exact nine-argument M4
--      function (body verbatim from 20260911140000) and assert
--      md5 = 1b0241b82984a66de984e0d536b6838d
--   3. re-apply the M4 owner and EXECUTE privileges
--   4. drop get_active_plan_safety_status()
--   5. drop trg_set_profile_safety_fingerprint
--   6. drop set_profile_safety_fingerprint() and profile_safety_fingerprint()
--   7. drop profiles.safety_fingerprint and workout_plans.safety_fingerprint
--      (their CHECK constraints go with them)
--   8. NOTIFY pgrst, 'reload schema' (delivered on commit only)
-- Nothing else is touched. No row is inserted, updated or deleted.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back everything
-- this file did in the same run.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   migration A installed (the only replace_user_plans_atomic is the
--     ten-argument function with migration A's body md5, and every object is
--     present)
--     -> steps 2-8
--   already rolled back (the only replace_user_plans_atomic is the
--     nine-argument M4 function and every object is absent)
--     -> steps 2 and 4-7 are no-ops; privileges are re-applied; AFTER
--        assertions still run
--   anything else -> fail closed, no mutate

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.workout_plans IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE _sfp_const (
  k text PRIMARY KEY,
  v text NOT NULL
) ON COMMIT DROP;

INSERT INTO _sfp_const (k, v) VALUES
  ('m4_body_md5', '1b0241b82984a66de984e0d536b6838d'),
  ('a_body_md5',  'a88fc6c9fa02ab37fd2390ccacde264a'),
  ('m4_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb'),
  ('a_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb, '
   || 'p_expected_safety_fingerprint text'),
  ('rpc_result',
   'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)'),
  -- Verbatim copy of the M4 body in 20260911140000_plan_replacement_rpc.sql.
  ('m4_body', $fnbody$
DECLARE
  v_workout_found   uuid;
  v_nutrition_found uuid;
  v_workout_new     uuid;
  v_nutrition_new   uuid;
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

  -- Fresh. Workout first, always. Only rows that are actually active are
  -- archived: false and NULL are left exactly as they are.
  UPDATE public.workout_plans
     SET is_active = false
   WHERE user_id = p_user_id
     AND is_active IS TRUE;

  INSERT INTO public.workout_plans
    (user_id, coach_id, plan_type, week_start, week_number, activate_on,
     plan_data, is_active, client_attempt_id)
  VALUES
    (p_user_id, p_workout_coach_id, p_workout_plan_type, p_workout_week_start,
     p_workout_week_number, p_workout_activate_on, p_workout_plan_data, true,
     p_client_attempt_id)
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

CREATE TEMP TABLE _sfp_state (
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
   AND a.attname <> 'safety_fingerprint'
   AND a.attnum > 0
   AND NOT a.attisdropped;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rpc9_oid     oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)');
  rpc10_oid    oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');
  rpc_oid      oid;
  is_nine      boolean;
  fn           record;
  n            integer;
  have_fp      boolean;
  have_trgfn   boolean;
  have_gate    boolean;
  have_pcol    boolean;
  have_wcol    boolean;
  have_trg     boolean;
  rpc_is_a     boolean;
  rpc_is_m4    boolean;
  is_installed boolean;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR (rpc9_oid IS NULL AND rpc10_oid IS NULL) THEN
    RAISE EXCEPTION 'precondition failed: replace_user_plans_atomic is absent, overloaded, or has another signature';
  END IF;

  is_nine := rpc9_oid IS NOT NULL;
  rpc_oid := CASE WHEN is_nine THEN rpc9_oid ELSE rpc10_oid END;

  SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.pronargs,
         p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM
       (SELECT v FROM _sfp_const WHERE k = CASE WHEN is_nine THEN 'm4_ident' ELSE 'a_ident' END)
     OR pg_get_function_result(rpc_oid) IS DISTINCT FROM (SELECT v FROM _sfp_const WHERE k = 'rpc_result')
     OR fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' OR NOT fn.prosecdef
     OR fn.provolatile <> 'v' OR NOT fn.proretset
     OR (is_nine AND (fn.pronargs <> 9 OR fn.pronargdefaults <> 1))
     OR (NOT is_nine AND (fn.pronargs <> 10 OR fn.pronargdefaults <> 2))
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'precondition failed: replace_user_plans_atomic matches neither the M4 nor the migration A contract outside its body';
  END IF;

  rpc_is_a  := NOT is_nine AND md5(fn.prosrc) = (SELECT v FROM _sfp_const WHERE k = 'a_body_md5');
  rpc_is_m4 := is_nine AND md5(fn.prosrc) = (SELECT v FROM _sfp_const WHERE k = 'm4_body_md5');

  have_fp    := to_regprocedure('public.profile_safety_fingerprint(text, text[], text, text, text)') IS NOT NULL;
  have_trgfn := to_regprocedure('public.set_profile_safety_fingerprint()') IS NOT NULL;
  have_gate  := to_regprocedure('public.get_active_plan_safety_status()') IS NOT NULL;
  have_pcol  := EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = 'public.profiles'::regclass
                           AND a.attname = 'safety_fingerprint'
                           AND a.attnum > 0 AND NOT a.attisdropped);
  have_wcol  := EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = 'public.workout_plans'::regclass
                           AND a.attname = 'safety_fingerprint'
                           AND a.attnum > 0 AND NOT a.attisdropped);
  have_trg   := EXISTS (SELECT 1 FROM pg_trigger g
                         WHERE g.tgrelid = 'public.profiles'::regclass
                           AND g.tgname = 'trg_set_profile_safety_fingerprint');

  IF rpc_is_a AND have_fp AND have_trgfn AND have_gate AND have_pcol AND have_wcol AND have_trg THEN
    is_installed := true;
  ELSIF rpc_is_m4 AND NOT (have_fp OR have_trgfn OR have_gate OR have_pcol OR have_wcol OR have_trg)
        AND NOT EXISTS (SELECT 1 FROM pg_proc p
                         WHERE p.pronamespace = 'public'::regnamespace
                           AND p.proname IN ('profile_safety_fingerprint',
                                             'set_profile_safety_fingerprint',
                                             'get_active_plan_safety_status')) THEN
    is_installed := false;
  ELSE
    RAISE EXCEPTION 'precondition failed: RPC (% arguments, body md5 %) with fp=% trgfn=% gate=% profiles.col=% workout_plans.col=% trigger=% is neither migration A installed nor already rolled back',
      fn.pronargs, md5(fn.prosrc), have_fp, have_trgfn, have_gate, have_pcol, have_wcol, have_trg;
  END IF;

  -- Any comment on the installed function is carried back verbatim.
  INSERT INTO _sfp_state (installed, rpc_comment)
  VALUES (is_installed, obj_description(rpc_oid, 'pg_proc'));
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. RESTORE THE EXACT M4 FUNCTION. Before the column drops: migration A's
--    body reads profiles.safety_fingerprint and writes
--    workout_plans.safety_fingerprint. No CASCADE on the drop.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rpc_oid   oid;
  c_comment text := (SELECT rpc_comment FROM _sfp_state);
BEGIN
  IF (SELECT installed FROM _sfp_state) THEN
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
      || 'p_nutrition_plan_data jsonb DEFAULT NULL) '
      || 'RETURNS TABLE (workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean) '
      || 'LANGUAGE plpgsql VOLATILE SECURITY DEFINER '
      || 'SET search_path = public, pg_temp '
      || 'AS ' || quote_literal((SELECT v FROM _sfp_const WHERE k = 'm4_body'));

    IF c_comment IS NOT NULL THEN
      EXECUTE format(
        'COMMENT ON FUNCTION public.replace_user_plans_atomic('
        || 'uuid, uuid, text, text, date, integer, date, jsonb, jsonb) IS %L',
        c_comment);
    END IF;
  END IF;

  rpc_oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)');
  IF rpc_oid IS NULL
     OR md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = rpc_oid)) IS DISTINCT FROM '1b0241b82984a66de984e0d536b6838d' THEN
    RAISE EXCEPTION 'rollback failed: restored RPC body md5 is %, expected 1b0241b82984a66de984e0d536b6838d',
      md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = rpc_oid));
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. OWNERSHIP AND EXECUTE PRIVILEGES, exactly as M4. Idempotent.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.replace_user_plans_atomic(
  uuid, uuid, text, text, date, integer, date, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4-7. GATE, TRIGGER, FUNCTIONS, COLUMNS. No CASCADE: an unexpected dependent
--      object aborts the rollback instead of being dropped silently.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_active_plan_safety_status();

DROP TRIGGER IF EXISTS trg_set_profile_safety_fingerprint ON public.profiles;

DROP FUNCTION IF EXISTS public.set_profile_safety_fingerprint();

DROP FUNCTION IF EXISTS public.profile_safety_fingerprint(text, text[], text, text, text);

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS safety_fingerprint;

ALTER TABLE public.workout_plans
  DROP COLUMN IF EXISTS safety_fingerprint;

-- ---------------------------------------------------------------------------
-- 8. AFTER ASSERTIONS.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rpc_oid oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)');
  c_comment text := (SELECT rpc_comment FROM _sfp_state);
  fn      record;
  n       bigint;
  n_pre   bigint;
  n_post  bigint;
BEGIN
  -- RPC: exactly one function, the nine-argument M4 function, body included.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: expected exactly one replace_user_plans_atomic, the nine-argument M4 one (found %)', n;
  END IF;

  SELECT p.pronamespace, p.prokind, p.prosecdef, p.provolatile, p.proretset,
         p.pronargs, p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF md5(fn.prosrc) IS DISTINCT FROM '1b0241b82984a66de984e0d536b6838d'
     OR fn.prosrc IS DISTINCT FROM (SELECT v FROM _sfp_const WHERE k = 'm4_body') THEN
    RAISE EXCEPTION 'postcondition failed: RPC body md5 is %, expected the M4 body', md5(fn.prosrc);
  END IF;
  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM (SELECT v FROM _sfp_const WHERE k = 'm4_ident')
     OR pg_get_function_result(rpc_oid) IS DISTINCT FROM (SELECT v FROM _sfp_const WHERE k = 'rpc_result')
     OR fn.pronamespace <> 'public'::regnamespace OR fn.prokind <> 'f' OR fn.lanname <> 'plpgsql'
     OR NOT fn.prosecdef OR fn.provolatile <> 'v' OR NOT fn.proretset
     OR fn.pronargs <> 9 OR fn.pronargdefaults <> 1
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'postcondition failed: replace_user_plans_atomic does not match the M4 contract';
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
    RAISE EXCEPTION 'postcondition failed: RPC EXECUTE privileges are not the M4 set';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = rpc_oid
     AND a.grantee NOT IN (fn.proowner, 'service_role'::regrole::oid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: % unexpected grantee(s) on the RPC', n;
  END IF;

  -- Every migration A object is gone.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('profile_safety_fingerprint',
                                  'set_profile_safety_fingerprint',
                                  'get_active_plan_safety_status'))
     OR EXISTS (SELECT 1 FROM pg_trigger g
                 WHERE g.tgrelid = 'public.profiles'::regclass
                   AND g.tgname = 'trg_set_profile_safety_fingerprint')
     OR EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass)
                   AND a.attname = 'safety_fingerprint'
                   AND a.attnum > 0 AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint c
                 WHERE c.conname IN ('profiles_safety_fingerprint_format',
                                     'workout_plans_safety_fingerprint_format')) THEN
    RAISE EXCEPTION 'postcondition failed: a migration A object is still present';
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
           AND a.attname <> 'safety_fingerprint'
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
    RAISE EXCEPTION 'postcondition failed: a column other than safety_fingerprint changed';
  END IF;
END
$mig$;

-- PostgREST caches function signatures; the nine-argument RPC is invisible to
-- /rest/v1/rpc until it reloads. NOTIFY is transactional: delivered only when
-- this transaction commits, never on rollback.
NOTIFY pgrst, 'reload schema';

COMMIT;
