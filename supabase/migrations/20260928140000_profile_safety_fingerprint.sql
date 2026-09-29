-- 20260928140000_profile_safety_fingerprint.sql
-- UNEXECUTED. This file is in the tree for review. It has not been applied to
-- any database. Do not supabase db push. Apply in the SQL Editor after review.
-- Reverse: 20260928140001_drop_profile_safety_fingerprint.sql
-- The reverse file must NEVER be executed as a sequential follow-on. This
-- repo's production migrations are applied one at a time by hand in the SQL
-- Editor. supabase db push is never run against production.
-- Post-apply check: VERIFY_profile_safety_fingerprint.sql (always rolls back).
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the api/replace-plans.js
-- that sends p_expected_safety_fingerprint. The M4 function has no such
-- parameter, so that endpoint cannot save against the M4 catalog. The M4
-- endpoint, in turn, keeps working against this migration: its nine named
-- arguments still resolve, and the tenth defaults to NULL.
--
-- Migration A. A database-owned fingerprint of the five profile fields that
-- decide exercise safety, a copy of it on every newly saved plan, an
-- optimistic concurrency token on the plan save, and a workout-start gate:
--   public.profile_safety_fingerprint(...)      pure function, reads no table
--   public.profiles.safety_fingerprint          text NOT NULL, v1 format CHECK
--   public.set_profile_safety_fingerprint()     trigger function
--   trg_set_profile_safety_fingerprint          BEFORE INSERT OR UPDATE, per row
--   public.workout_plans.safety_fingerprint     text NULL, v1 format CHECK
--   public.replace_user_plans_atomic            M4 nine arguments plus
--                                               p_expected_safety_fingerprint
--   public.get_active_plan_safety_status()      caller-only status, no writes
--
-- Fingerprint v1: 'v1:' || lowercase hex sha256 of the UTF-8 bytes of
--   jsonb_build_array(equipment, canonical_extras, experience,
--                     health_conditions, injuries)::text
-- canonical_extras: NULL stays JSON null; a non-null array is deduplicated and
-- sorted by byte order (COLLATE "C"); an empty array stays []. Every other
-- value is used exactly as stored: no trim, no parsing of health_conditions,
-- NULL is distinct from ''. Uses built-in sha256(bytea); no pgcrypto.
--
-- Data writes: every existing profiles row gets safety_fingerprint computed
-- from its own current columns; no other profiles column changes. No
-- workout_plans row is written: every existing plan stays NULL (= unverified).
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back
-- everything this file did in the same run. The nine-argument M4 function is
-- dropped and the ten-argument function created inside that transaction, so
-- no other session ever sees neither, or both.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   fresh: none of the objects above exist and replace_user_plans_atomic is
--     the nine-argument M4 function (body md5 1b0241b82984a66de984e0d536b6838d)
--     -> install everything, backfill, assert
--   installed: every object above already exists exactly as specified here,
--     replace_user_plans_atomic is the ten-argument function with this file's
--     body, and every profile fingerprint equals its recomputation
--     -> nothing is created or replaced; privileges are re-applied; the
--        backfill touches zero rows; AFTER assertions still run
--   anything else (partial install, other RPC body, other types)
--     -> fail closed, no mutate

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- Both tables get a column. Taken up front, in one order, so the whole run
-- sees one state. replace_user_plans_atomic waits on these locks.
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.workout_plans IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 0. CONSTANTS. The four function bodies live here exactly once. Every
--    create and every body assertion below reads them from this table.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _sfp_const (
  k text PRIMARY KEY,
  v text NOT NULL
) ON COMMIT DROP;

INSERT INTO _sfp_const (k, v) VALUES
  ('m4_body_md5', '1b0241b82984a66de984e0d536b6838d'),
  ('fp_ident',
   'p_equipment text, p_equipment_extras text[], p_experience text, '
   || 'p_health_conditions text, p_injuries text'),
  ('m4_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb'),
  ('rpc_ident',
   'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
   || 'p_workout_plan_type text, p_workout_week_start date, '
   || 'p_workout_week_number integer, p_workout_activate_on date, '
   || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb, '
   || 'p_expected_safety_fingerprint text'),
  ('rpc_result',
   'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)'),
  ('gate_result',
   'TABLE(status text, plan_id uuid)'),
  ('profiles_check',
   $chk$CHECK ((safety_fingerprint ~ '^v1:[0-9a-f]{64}$'::text))$chk$),
  ('workout_plans_check',
   $chk$CHECK (((safety_fingerprint IS NULL) OR (safety_fingerprint ~ '^v1:[0-9a-f]{64}$'::text)))$chk$),
  ('fp_body', $fpbody$
SELECT 'v1:' || encode(
         sha256(
           convert_to(
             jsonb_build_array(
               p_equipment,
               CASE
                 WHEN p_equipment_extras IS NULL THEN NULL::jsonb
                 ELSE coalesce(
                   (SELECT jsonb_agg(d.x ORDER BY d.x)
                      FROM (SELECT DISTINCT (e.x COLLATE "C") AS x
                              FROM unnest(p_equipment_extras) AS e(x)) AS d),
                   '[]'::jsonb)
               END,
               p_experience,
               p_health_conditions,
               p_injuries
             )::text,
             'UTF8')),
         'hex')
$fpbody$),
  ('trg_body', $trgbody$
BEGIN
  -- Every INSERT and every UPDATE, whatever columns the statement names.
  -- A supplied safety_fingerprint is always overwritten.
  NEW.safety_fingerprint := public.profile_safety_fingerprint(
    NEW.equipment,
    NEW.equipment_extras,
    NEW.experience,
    NEW.health_conditions,
    NEW.injuries);
  RETURN NEW;
END;
$trgbody$),
  ('gate_body', $gatebody$
WITH caller AS (
  -- NULL when there is no JWT; every join below then matches nothing and the
  -- result is profile_unavailable.
  SELECT auth.uid() AS uid
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
$gatebody$),
  ('rpc_body', $fnbody$
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

CREATE TEMP TABLE _sfp_state (
  installed   boolean NOT NULL,
  rpc_comment text
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Snapshot row identities and column catalogs BEFORE any change.
-- profiles: the id set detects insert/delete; the row image minus
--   safety_fingerprint detects a change to any other column (xmin cannot,
--   because the backfill legitimately updates every row on a fresh run).
-- workout_plans: nothing may touch a row at all, so xmin/ctid must hold.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _profiles_pre ON COMMIT DROP AS
SELECT p.id,
       p.xmin AS row_xmin,
       p.ctid AS row_ctid,
       to_jsonb(p) - 'safety_fingerprint' AS row_image
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
   AND a.attname <> 'safety_fingerprint'
   AND a.attnum > 0
   AND NOT a.attisdropped;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED. Decides fresh or installed; anything else
--    aborts before a single object is changed.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  t             text;
  r             text;
  rel           record;
  spec          record;
  att           record;
  fn            record;
  con           record;
  trg           record;
  rpc_oid       oid;
  rpc9_oid      oid;
  rpc10_oid     oid;
  is_nine       boolean;
  fp_oid        oid;
  trgfn_oid     oid;
  gate_oid      oid;
  n             integer;
  trg_names     text[];
  have_fp       boolean;
  have_trgfn    boolean;
  have_gate     boolean;
  have_pcol     boolean;
  have_wcol     boolean;
  have_pcon     boolean;
  have_wcon     boolean;
  have_trg      boolean;
  rpc_is_m4     boolean;
  rpc_is_new    boolean;
  is_installed  boolean;
  c_m4_md5      text := (SELECT v FROM _sfp_const WHERE k = 'm4_body_md5');
  c_m4_ident    text := (SELECT v FROM _sfp_const WHERE k = 'm4_ident');
  c_rpc_ident   text := (SELECT v FROM _sfp_const WHERE k = 'rpc_ident');
  c_rpc_result  text := (SELECT v FROM _sfp_const WHERE k = 'rpc_result');
  c_rpc_body    text := (SELECT v FROM _sfp_const WHERE k = 'rpc_body');
  c_fp_ident    text := (SELECT v FROM _sfp_const WHERE k = 'fp_ident');
  c_fp_body     text := (SELECT v FROM _sfp_const WHERE k = 'fp_body');
  c_trg_body    text := (SELECT v FROM _sfp_const WHERE k = 'trg_body');
  c_gate_body   text := (SELECT v FROM _sfp_const WHERE k = 'gate_body');
  c_gate_result text := (SELECT v FROM _sfp_const WHERE k = 'gate_result');
  c_pcheck      text := (SELECT v FROM _sfp_const WHERE k = 'profiles_check');
  c_wcheck      text := (SELECT v FROM _sfp_const WHERE k = 'workout_plans_check');
BEGIN
  -- Relations and roles.
  FOREACH t IN ARRAY ARRAY['public.profiles', 'public.workout_plans'] LOOP
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

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'precondition failed: auth.uid() does not exist; the workout-start gate has no caller identity';
  END IF;

  FOREACH r IN ARRAY ARRAY['postgres', 'service_role', 'anon', 'authenticated'] LOOP
    IF to_regrole(quote_ident(r)) IS NULL THEN
      RAISE EXCEPTION 'precondition failed: role % does not exist', r;
    END IF;
  END LOOP;

  -- The columns the fingerprint and the gate read, with the measured types.
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.profiles', 'id',                'uuid',    false),
      ('public.profiles', 'equipment',         'text',    true),
      ('public.profiles', 'equipment_extras',  'text[]',  true),
      ('public.profiles', 'experience',        'text',    true),
      ('public.profiles', 'health_conditions', 'text',    true),
      ('public.profiles', 'injuries',          'text',    true),
      ('public.workout_plans', 'id',           'uuid',    false),
      ('public.workout_plans', 'user_id',      'uuid',    false),
      ('public.workout_plans', 'is_active',    'boolean', false)
    ) AS v(tbl, col, typ, must_be_nullable)
  LOOP
    SELECT a.atttypid, a.atttypmod, a.attnotnull
      INTO att
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
        spec.tbl, spec.col, format_type(att.atttypid, att.atttypmod), spec.typ;
    END IF;

    IF spec.must_be_nullable AND att.attnotnull THEN
      RAISE EXCEPTION 'precondition failed: %.% is NOT NULL; expected nullable',
        spec.tbl, spec.col;
    END IF;
  END LOOP;

  -- Built-in sha256(bytea) -> bytea. pgcrypto is neither used nor needed.
  IF to_regprocedure('pg_catalog.sha256(bytea)') IS NULL
     OR (SELECT p.prorettype FROM pg_proc p
          WHERE p.oid = to_regprocedure('pg_catalog.sha256(bytea)')) <> 'bytea'::regtype THEN
    RAISE EXCEPTION 'precondition failed: built-in pg_catalog.sha256(bytea) returning bytea is not available';
  END IF;

  -- replace_user_plans_atomic: exactly one function, and it is either the
  -- nine-argument M4 function with the M4 body, or the ten-argument function
  -- with this file's body. Everything outside the body must match both ways.
  SELECT count(*) INTO n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 THEN
    RAISE EXCEPTION 'precondition failed: % functions named public.replace_user_plans_atomic; expected exactly one', n;
  END IF;

  rpc9_oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)');
  rpc10_oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');

  is_nine := rpc9_oid IS NOT NULL;
  IF is_nine THEN
    rpc_oid := rpc9_oid;
  ELSIF rpc10_oid IS NOT NULL THEN
    rpc_oid := rpc10_oid;
  ELSE
    RAISE EXCEPTION 'precondition failed: public.replace_user_plans_atomic has neither the M4 signature nor this file''s signature';
  END IF;

  SELECT p.pronamespace, p.prokind, p.prosecdef, p.provolatile, p.proretset,
         p.pronargs, p.pronargdefaults, p.proowner, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = rpc_oid;

  IF pg_get_function_identity_arguments(rpc_oid) IS DISTINCT FROM
       (CASE WHEN is_nine THEN c_m4_ident ELSE c_rpc_ident END) THEN
    RAISE EXCEPTION 'precondition failed: RPC identity arguments are %',
      pg_get_function_identity_arguments(rpc_oid);
  END IF;
  IF (is_nine AND (fn.pronargs <> 9 OR fn.pronargdefaults <> 1))
     OR (NOT is_nine AND (fn.pronargs <> 10 OR fn.pronargdefaults <> 2)) THEN
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

  rpc_is_m4  := is_nine AND md5(fn.prosrc) = c_m4_md5;
  rpc_is_new := NOT is_nine AND fn.prosrc = c_rpc_body;
  IF NOT rpc_is_m4 AND NOT rpc_is_new THEN
    RAISE EXCEPTION 'precondition failed: RPC body md5 is %, expected the M4 body (%) on the nine-argument function or exactly this migration''s body on the ten-argument function; refusing to replace',
      md5(fn.prosrc), c_m4_md5;
  END IF;

  -- Presence of every object this file creates.
  have_fp    := EXISTS (SELECT 1 FROM pg_proc p
                         WHERE p.pronamespace = 'public'::regnamespace
                           AND p.proname = 'profile_safety_fingerprint');
  have_trgfn := EXISTS (SELECT 1 FROM pg_proc p
                         WHERE p.pronamespace = 'public'::regnamespace
                           AND p.proname = 'set_profile_safety_fingerprint');
  have_gate  := EXISTS (SELECT 1 FROM pg_proc p
                         WHERE p.pronamespace = 'public'::regnamespace
                           AND p.proname = 'get_active_plan_safety_status');
  have_pcol  := EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = 'public.profiles'::regclass
                           AND a.attname = 'safety_fingerprint'
                           AND a.attnum > 0 AND NOT a.attisdropped);
  have_wcol  := EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = 'public.workout_plans'::regclass
                           AND a.attname = 'safety_fingerprint'
                           AND a.attnum > 0 AND NOT a.attisdropped);
  have_pcon  := EXISTS (SELECT 1 FROM pg_constraint c
                         WHERE c.conrelid = 'public.profiles'::regclass
                           AND c.conname = 'profiles_safety_fingerprint_format');
  have_wcon  := EXISTS (SELECT 1 FROM pg_constraint c
                         WHERE c.conrelid = 'public.workout_plans'::regclass
                           AND c.conname = 'workout_plans_safety_fingerprint_format');
  have_trg   := EXISTS (SELECT 1 FROM pg_trigger g
                         WHERE g.tgrelid = 'public.profiles'::regclass
                           AND g.tgname = 'trg_set_profile_safety_fingerprint');

  IF rpc_is_m4 AND NOT (have_fp OR have_trgfn OR have_gate OR have_pcol OR have_wcol
                        OR have_pcon OR have_wcon OR have_trg) THEN
    is_installed := false;
  ELSIF rpc_is_new AND have_fp AND have_trgfn AND have_gate AND have_pcol AND have_wcol
        AND have_pcon AND have_wcon AND have_trg THEN
    is_installed := true;
  ELSE
    RAISE EXCEPTION 'precondition failed: partial state (rpc_is_m4=% rpc_is_new=% fp=% trgfn=% gate=% profiles.col=% workout_plans.col=% profiles.check=% workout_plans.check=% trigger=%); refusing to proceed',
      rpc_is_m4, rpc_is_new, have_fp, have_trgfn, have_gate, have_pcol, have_wcol, have_pcon, have_wcon, have_trg;
  END IF;

  -- The user triggers on profiles must be exactly the measured set. Both
  -- measured triggers only raise and never modify NEW, and this file's trigger
  -- recomputes from NEW on every call, so the fingerprint does not depend on
  -- firing order. An unknown trigger could modify NEW after ours: fail closed.
  SELECT array_agg(g.tgname::text ORDER BY g.tgname::text COLLATE "C")
    INTO trg_names
    FROM pg_trigger g
   WHERE g.tgrelid = 'public.profiles'::regclass
     AND NOT g.tgisinternal;

  IF trg_names IS DISTINCT FROM (
       CASE WHEN is_installed
            THEN ARRAY['trg_protect_onboarding_completed_latch',
                       'trg_protect_profile_billing',
                       'trg_set_profile_safety_fingerprint']
            ELSE ARRAY['trg_protect_onboarding_completed_latch',
                       'trg_protect_profile_billing']
       END) THEN
    RAISE EXCEPTION 'precondition failed: user triggers on public.profiles are %, not the measured set',
      trg_names;
  END IF;

  IF is_installed THEN
    -- Pure function, exactly as specified.
    SELECT count(*) INTO n FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'profile_safety_fingerprint';
    fp_oid := to_regprocedure('public.profile_safety_fingerprint(text, text[], text, text, text)');
    IF n <> 1 OR fp_oid IS NULL THEN
      RAISE EXCEPTION 'precondition failed: installed profile_safety_fingerprint is overloaded or has another signature';
    END IF;
    SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.proisstrict,
           p.proconfig, p.prosrc, l.lanname
      INTO fn
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = fp_oid;
    IF pg_get_function_identity_arguments(fp_oid) IS DISTINCT FROM c_fp_ident
       OR pg_get_function_result(fp_oid) IS DISTINCT FROM 'text'
       OR fn.prokind <> 'f' OR fn.lanname <> 'sql' OR fn.provolatile <> 'i'
       OR fn.prosecdef OR fn.proretset OR fn.proisstrict
       OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
       OR fn.prosrc IS DISTINCT FROM c_fp_body THEN
      RAISE EXCEPTION 'precondition failed: installed profile_safety_fingerprint differs from this file';
    END IF;

    -- Trigger function, exactly as specified.
    SELECT count(*) INTO n FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'set_profile_safety_fingerprint';
    trgfn_oid := to_regprocedure('public.set_profile_safety_fingerprint()');
    IF n <> 1 OR trgfn_oid IS NULL THEN
      RAISE EXCEPTION 'precondition failed: installed set_profile_safety_fingerprint is overloaded or has another signature';
    END IF;
    SELECT p.prokind, p.prosecdef, p.provolatile, p.proconfig, p.prosrc, l.lanname
      INTO fn
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = trgfn_oid;
    IF pg_get_function_result(trgfn_oid) IS DISTINCT FROM 'trigger'
       OR fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' OR fn.provolatile <> 'v'
       OR fn.prosecdef
       OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
       OR fn.prosrc IS DISTINCT FROM c_trg_body THEN
      RAISE EXCEPTION 'precondition failed: installed set_profile_safety_fingerprint differs from this file';
    END IF;

    -- Workout-start gate, exactly as specified.
    SELECT count(*) INTO n FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'get_active_plan_safety_status';
    gate_oid := to_regprocedure('public.get_active_plan_safety_status()');
    IF n <> 1 OR gate_oid IS NULL THEN
      RAISE EXCEPTION 'precondition failed: installed get_active_plan_safety_status is overloaded or has another signature';
    END IF;
    SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.pronargs,
           p.proconfig, p.prosrc, l.lanname
      INTO fn
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = gate_oid;
    IF pg_get_function_identity_arguments(gate_oid) IS DISTINCT FROM ''
       OR pg_get_function_result(gate_oid) IS DISTINCT FROM c_gate_result
       OR fn.prokind <> 'f' OR fn.lanname <> 'sql' OR fn.provolatile <> 's'
       OR fn.prosecdef OR NOT fn.proretset OR fn.pronargs <> 0
       OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
       OR fn.prosrc IS DISTINCT FROM c_gate_body THEN
      RAISE EXCEPTION 'precondition failed: installed get_active_plan_safety_status differs from this file';
    END IF;

    -- Columns and CHECKs.
    SELECT a.atttypid, a.attnotnull, a.atthasdef INTO att
      FROM pg_attribute a
     WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'safety_fingerprint';
    IF att.atttypid <> 'text'::regtype OR NOT att.attnotnull OR att.atthasdef THEN
      RAISE EXCEPTION 'precondition failed: installed profiles.safety_fingerprint is not text NOT NULL without default';
    END IF;

    SELECT a.atttypid, a.attnotnull, a.atthasdef INTO att
      FROM pg_attribute a
     WHERE a.attrelid = 'public.workout_plans'::regclass AND a.attname = 'safety_fingerprint';
    IF att.atttypid <> 'text'::regtype OR att.attnotnull OR att.atthasdef THEN
      RAISE EXCEPTION 'precondition failed: installed workout_plans.safety_fingerprint is not text NULL without default';
    END IF;

    SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def INTO con
      FROM pg_constraint c
     WHERE c.conrelid = 'public.profiles'::regclass
       AND c.conname = 'profiles_safety_fingerprint_format';
    IF con.contype <> 'c' OR NOT con.convalidated OR con.def IS DISTINCT FROM c_pcheck THEN
      RAISE EXCEPTION 'precondition failed: installed profiles_safety_fingerprint_format is %', con.def;
    END IF;

    SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def INTO con
      FROM pg_constraint c
     WHERE c.conrelid = 'public.workout_plans'::regclass
       AND c.conname = 'workout_plans_safety_fingerprint_format';
    IF con.contype <> 'c' OR NOT con.convalidated OR con.def IS DISTINCT FROM c_wcheck THEN
      RAISE EXCEPTION 'precondition failed: installed workout_plans_safety_fingerprint_format is %', con.def;
    END IF;

    -- Trigger: BEFORE, ROW, INSERT and UPDATE, enabled, no WHEN, no column list.
    -- Catalog columns only, no rendered text. tgattr with no column list is an
    -- EMPTY one-dimensional int2vector: array_length() of it is 0, not NULL,
    -- so emptiness is tested with cardinality(), which is 0 for any empty array.
    SELECT g.tgrelid, g.tgfoid, g.tgtype, g.tgenabled, g.tgqual, g.tgattr, g.tgnargs, g.tgisinternal
      INTO trg
      FROM pg_trigger g
     WHERE g.tgrelid = 'public.profiles'::regclass
       AND g.tgname = 'trg_set_profile_safety_fingerprint';
    IF NOT FOUND
       OR trg.tgrelid <> 'public.profiles'::regclass
       OR trg.tgfoid <> 'public.set_profile_safety_fingerprint()'::regprocedure
       OR trg.tgtype <> 23
       OR trg.tgisinternal
       OR trg.tgenabled <> 'O'
       OR trg.tgnargs <> 0
       OR trg.tgqual IS NOT NULL
       OR cardinality(trg.tgattr::int2[]) <> 0 THEN
      RAISE EXCEPTION 'precondition failed: installed trg_set_profile_safety_fingerprint differs from this file';
    END IF;

    -- Every profile already carries its own recomputed fingerprint. A row that
    -- does not means the trigger was bypassed; that needs a human, not a rerun.
    SELECT count(*) INTO n
      FROM public.profiles p
     WHERE p.safety_fingerprint IS DISTINCT FROM public.profile_safety_fingerprint(
             p.equipment, p.equipment_extras, p.experience,
             p.health_conditions, p.injuries);
    IF n <> 0 THEN
      RAISE EXCEPTION 'precondition failed: installed, but % profiles rows carry a stale fingerprint', n;
    END IF;
  END IF;

  -- The RPC comment, if any, is carried over verbatim to the ten-argument
  -- function. M4 set none; this is read, not assumed.
  INSERT INTO _sfp_state (installed, rpc_comment)
  VALUES (is_installed, obj_description(rpc_oid, 'pg_proc'));
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. PURE FUNCTION. Reads no table. Not STRICT: NULL inputs are part of the
--    fingerprint. SET search_path pins every name it uses to pg_catalog.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _sfp_state) THEN
    EXECUTE
      'CREATE FUNCTION public.profile_safety_fingerprint('
      || 'p_equipment text, '
      || 'p_equipment_extras text[], '
      || 'p_experience text, '
      || 'p_health_conditions text, '
      || 'p_injuries text) '
      || 'RETURNS text '
      || 'LANGUAGE sql IMMUTABLE '
      || 'SET search_path = pg_catalog '
      || 'AS ' || quote_literal((SELECT v FROM _sfp_const WHERE k = 'fp_body'));
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. profiles.safety_fingerprint, nullable until the backfill below.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _sfp_state) THEN
    ALTER TABLE public.profiles
      ADD COLUMN safety_fingerprint text;
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_safety_fingerprint_format
      CHECK (safety_fingerprint ~ '^v1:[0-9a-f]{64}$');
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 4. TRIGGER. SECURITY INVOKER: it runs with the privileges of whoever writes
--    profiles (athlete JWT, service_role, auth's handle_new_user). It sets
--    NEW.safety_fingerprint on every INSERT and every UPDATE, whatever the
--    statement named, so a client can neither forge nor stale the value.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _sfp_state) THEN
    EXECUTE
      'CREATE FUNCTION public.set_profile_safety_fingerprint() '
      || 'RETURNS trigger '
      || 'LANGUAGE plpgsql VOLATILE SECURITY INVOKER '
      || 'SET search_path = pg_catalog, public '
      || 'AS ' || quote_literal((SELECT v FROM _sfp_const WHERE k = 'trg_body'));

    CREATE TRIGGER trg_set_profile_safety_fingerprint
      BEFORE INSERT OR UPDATE ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.set_profile_safety_fingerprint();
  END IF;
END
$mig$;

-- Deliberately NO REVOKE on profile_safety_fingerprint or
-- set_profile_safety_fingerprint. The trigger is SECURITY INVOKER and calls
-- profile_safety_fingerprint with the privileges of whoever writes profiles.
-- Clients (anon, authenticated) still UPDATE non-safety profile columns
-- directly (dopa_xp, streak_count, last_feedback_week, fcm_token, ...), and
-- signup INSERTs profiles through handle_new_user. Revoking EXECUTE from
-- anon or authenticated would make every one of those writes fail. The pure
-- function reveals nothing: it reads no table and only hashes its arguments.

-- ---------------------------------------------------------------------------
-- 5. BACKFILL every existing profile from its own current columns, then
--    NOT NULL. The trigger fires on this UPDATE and computes the same value.
--    On an installed catalog every row already matches, so zero rows change.
-- ---------------------------------------------------------------------------
UPDATE public.profiles p
   SET safety_fingerprint = public.profile_safety_fingerprint(
         p.equipment, p.equipment_extras, p.experience,
         p.health_conditions, p.injuries)
 WHERE p.safety_fingerprint IS DISTINCT FROM public.profile_safety_fingerprint(
         p.equipment, p.equipment_extras, p.experience,
         p.health_conditions, p.injuries);

ALTER TABLE public.profiles
  ALTER COLUMN safety_fingerprint SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. workout_plans.safety_fingerprint. NULL, no default, no backfill: every
--    existing plan stays NULL, which means unverified.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _sfp_state) THEN
    ALTER TABLE public.workout_plans
      ADD COLUMN safety_fingerprint text;
    ALTER TABLE public.workout_plans
      ADD CONSTRAINT workout_plans_safety_fingerprint_format
      CHECK (safety_fingerprint IS NULL OR safety_fingerprint ~ '^v1:[0-9a-f]{64}$');
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 7. replace_user_plans_atomic. The nine-argument M4 function is dropped and
--    a ten-argument function created: the same nine parameters, defaults and
--    return type, plus p_expected_safety_fingerprint text DEFAULT NULL. The
--    body is the M4 body plus, on the fresh path and before any write, one
--    read of profiles.safety_fingerprint and the token check. The replay path
--    is byte-identical to M4 and stays a pure read.
--    DROP + CREATE rather than CREATE OR REPLACE: adding a parameter creates a
--    new overload, and the contract is a single function. No CASCADE: an
--    unexpected dependent object aborts the migration.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  c_comment text := (SELECT rpc_comment FROM _sfp_state);
BEGIN
  IF NOT (SELECT installed FROM _sfp_state) THEN
    DROP FUNCTION public.replace_user_plans_atomic(
      uuid, uuid, text, text, date, integer, date, jsonb, jsonb);

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
      || 'AS ' || quote_literal((SELECT v FROM _sfp_const WHERE k = 'rpc_body'));

    IF c_comment IS NOT NULL THEN
      EXECUTE format(
        'COMMENT ON FUNCTION public.replace_user_plans_atomic('
        || 'uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text) IS %L',
        c_comment);
    END IF;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 8. RPC OWNERSHIP AND EXECUTE PRIVILEGES, as M4, on the new signature.
--    Idempotent. The new function starts with PUBLIC EXECUTE (and whatever
--    default privileges grant); nothing outside this transaction sees that.
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
-- 9. WORKOUT-START GATE. One statement, caller only (auth.uid()), under RLS,
--    SECURITY INVOKER, no parameters. Returns exactly one row: a status and,
--    only for unverified/stale/valid, the single active plan id. It writes
--    nothing and returns no profile values and no fingerprints.
--    Created after step 6: the body reads workout_plans.safety_fingerprint.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT (SELECT installed FROM _sfp_state) THEN
    EXECUTE
      'CREATE FUNCTION public.get_active_plan_safety_status() '
      || 'RETURNS TABLE (status text, plan_id uuid) '
      || 'LANGUAGE sql STABLE SECURITY INVOKER '
      || 'SET search_path = public, pg_temp '
      || 'AS ' || quote_literal((SELECT v FROM _sfp_const WHERE k = 'gate_body'));
  END IF;
END
$mig$;

REVOKE ALL ON FUNCTION public.get_active_plan_safety_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_plan_safety_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_active_plan_safety_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. AFTER ASSERTIONS.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  is_installed  boolean := (SELECT installed FROM _sfp_state);
  c_comment     text := (SELECT rpc_comment FROM _sfp_state);
  c_rpc_ident   text := (SELECT v FROM _sfp_const WHERE k = 'rpc_ident');
  c_rpc_result  text := (SELECT v FROM _sfp_const WHERE k = 'rpc_result');
  c_rpc_body    text := (SELECT v FROM _sfp_const WHERE k = 'rpc_body');
  c_m4_md5      text := (SELECT v FROM _sfp_const WHERE k = 'm4_body_md5');
  c_fp_ident    text := (SELECT v FROM _sfp_const WHERE k = 'fp_ident');
  c_fp_body     text := (SELECT v FROM _sfp_const WHERE k = 'fp_body');
  c_trg_body    text := (SELECT v FROM _sfp_const WHERE k = 'trg_body');
  c_gate_body   text := (SELECT v FROM _sfp_const WHERE k = 'gate_body');
  c_gate_result text := (SELECT v FROM _sfp_const WHERE k = 'gate_result');
  c_pcheck      text := (SELECT v FROM _sfp_const WHERE k = 'profiles_check');
  c_wcheck      text := (SELECT v FROM _sfp_const WHERE k = 'workout_plans_check');
  rpc_oid       oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text)');
  fp_oid        oid := to_regprocedure('public.profile_safety_fingerprint(text, text[], text, text, text)');
  trgfn_oid     oid := to_regprocedure('public.set_profile_safety_fingerprint()');
  gate_oid      oid := to_regprocedure('public.get_active_plan_safety_status()');
  fn            record;
  att           record;
  con           record;
  trg           record;
  n             bigint;
  n_pre         bigint;
  n_post        bigint;
  last_before   text;
  base          text;
BEGIN
  -- profiles: every row has a valid v1 fingerprint equal to its recomputation.
  SELECT count(*) INTO n
    FROM public.profiles p
   WHERE p.safety_fingerprint IS NULL
      OR p.safety_fingerprint !~ '^v1:[0-9a-f]{64}$'
      OR p.safety_fingerprint IS DISTINCT FROM public.profile_safety_fingerprint(
           p.equipment, p.equipment_extras, p.experience,
           p.health_conditions, p.injuries);
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: % profiles rows lack a valid, current fingerprint', n;
  END IF;

  -- profiles: no row inserted or deleted, no column other than
  -- safety_fingerprint changed.
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
        OR (to_jsonb(live) - 'safety_fingerprint') IS DISTINCT FROM snap.row_image
  ) THEN
    RAISE EXCEPTION 'postcondition failed: a profiles row was inserted, deleted, or changed outside safety_fingerprint';
  END IF;

  -- On an installed catalog the backfill must not have touched any row.
  IF is_installed AND EXISTS (
    SELECT 1
      FROM public.profiles live
      JOIN _profiles_pre snap ON snap.id = live.id
     WHERE live.xmin IS DISTINCT FROM snap.row_xmin
        OR live.ctid IS DISTINCT FROM snap.row_ctid
  ) THEN
    RAISE EXCEPTION 'postcondition failed: a profiles row was rewritten on an already-installed catalog';
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

  -- workout_plans: on a fresh install, zero plans carry a fingerprint. On an
  -- installed catalog, plans saved since the first run legitimately do.
  IF NOT is_installed THEN
    SELECT count(*) INTO n FROM public.workout_plans w WHERE w.safety_fingerprint IS NOT NULL;
    IF n <> 0 THEN
      RAISE EXCEPTION 'postcondition failed: % workout_plans rows have a non-NULL fingerprint after a fresh install', n;
    END IF;
  END IF;

  -- Other columns of both tables unchanged; exactly one new column each.
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
    RAISE EXCEPTION 'postcondition failed: a column other than safety_fingerprint changed on profiles or workout_plans';
  END IF;

  SELECT a.atttypid, a.attnotnull, a.atthasdef INTO att
    FROM pg_attribute a
   WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'safety_fingerprint'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT FOUND OR att.atttypid <> 'text'::regtype OR NOT att.attnotnull OR att.atthasdef THEN
    RAISE EXCEPTION 'postcondition failed: profiles.safety_fingerprint is not text NOT NULL without default';
  END IF;

  SELECT a.atttypid, a.attnotnull, a.atthasdef INTO att
    FROM pg_attribute a
   WHERE a.attrelid = 'public.workout_plans'::regclass AND a.attname = 'safety_fingerprint'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT FOUND OR att.atttypid <> 'text'::regtype OR att.attnotnull OR att.atthasdef THEN
    RAISE EXCEPTION 'postcondition failed: workout_plans.safety_fingerprint is not text NULL without default';
  END IF;

  SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def INTO con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.profiles'::regclass
     AND c.conname = 'profiles_safety_fingerprint_format';
  IF NOT FOUND OR con.contype <> 'c' OR NOT con.convalidated OR con.def IS DISTINCT FROM c_pcheck THEN
    RAISE EXCEPTION 'postcondition failed: profiles_safety_fingerprint_format is %, expected %', con.def, c_pcheck;
  END IF;

  SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def INTO con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.workout_plans'::regclass
     AND c.conname = 'workout_plans_safety_fingerprint_format';
  IF NOT FOUND OR con.contype <> 'c' OR NOT con.convalidated OR con.def IS DISTINCT FROM c_wcheck THEN
    RAISE EXCEPTION 'postcondition failed: workout_plans_safety_fingerprint_format is %, expected %', con.def, c_wcheck;
  END IF;

  -- Pure function: contract and body.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'profile_safety_fingerprint';
  IF n <> 1 OR fp_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: profile_safety_fingerprint is absent or overloaded';
  END IF;
  SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.proisstrict,
         p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = fp_oid;
  IF pg_get_function_identity_arguments(fp_oid) IS DISTINCT FROM c_fp_ident
     OR pg_get_function_result(fp_oid) IS DISTINCT FROM 'text'
     OR fn.prokind <> 'f' OR fn.lanname <> 'sql' OR fn.provolatile <> 'i'
     OR fn.prosecdef OR fn.proretset OR fn.proisstrict
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
     OR fn.prosrc IS DISTINCT FROM c_fp_body THEN
    RAISE EXCEPTION 'postcondition failed: profile_safety_fingerprint differs from this file';
  END IF;

  -- Pure function: behaviour on literals. No table is read or written.
  base := public.profile_safety_fingerprint('home', ARRAY['pullup_bar', 'bands'], 'beginner', '[]', 'none');
  IF base !~ '^v1:[0-9a-f]{64}$'
     OR public.profile_safety_fingerprint(NULL, NULL, NULL, NULL, NULL) !~ '^v1:[0-9a-f]{64}$'
     OR base IS DISTINCT FROM public.profile_safety_fingerprint(
          'home', ARRAY['bands', 'pullup_bar', 'bands'], 'beginner', '[]', 'none')
     OR public.profile_safety_fingerprint('home', NULL, 'beginner', '[]', 'none')
        = public.profile_safety_fingerprint('home', '{}'::text[], 'beginner', '[]', 'none') THEN
    RAISE EXCEPTION 'postcondition failed: profile_safety_fingerprint literal checks failed';
  END IF;

  -- Trigger function: contract and body.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'set_profile_safety_fingerprint';
  IF n <> 1 OR trgfn_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: set_profile_safety_fingerprint is absent or overloaded';
  END IF;
  SELECT p.prokind, p.prosecdef, p.provolatile, p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = trgfn_oid;
  IF pg_get_function_result(trgfn_oid) IS DISTINCT FROM 'trigger'
     OR fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' OR fn.provolatile <> 'v'
     OR fn.prosecdef
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
     OR fn.prosrc IS DISTINCT FROM c_trg_body THEN
    RAISE EXCEPTION 'postcondition failed: set_profile_safety_fingerprint differs from this file';
  END IF;

  -- Clients must keep EXECUTE on both, or their profile writes fail.
  IF NOT has_function_privilege('anon', fp_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', fp_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', fp_oid, 'EXECUTE')
     OR NOT has_function_privilege('anon', trgfn_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', trgfn_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', trgfn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: anon, authenticated or service_role cannot execute the fingerprint functions';
  END IF;

  -- Trigger: BEFORE (2) + ROW (1) + INSERT (4) + UPDATE (16) = 23, enabled,
  -- no WHEN clause, no UPDATE OF column list, no arguments. Catalog columns
  -- only, no rendered text. tgattr with no column list is an EMPTY
  -- one-dimensional int2vector: array_length() of it is 0, not NULL, so
  -- emptiness is tested with cardinality(), which is 0 for any empty array.
  SELECT g.tgrelid, g.tgfoid, g.tgtype, g.tgenabled, g.tgqual, g.tgattr, g.tgnargs, g.tgisinternal
    INTO trg
    FROM pg_trigger g
   WHERE g.tgrelid = 'public.profiles'::regclass
     AND g.tgname = 'trg_set_profile_safety_fingerprint';
  IF NOT FOUND
     OR trg.tgrelid <> 'public.profiles'::regclass
     OR trg.tgfoid <> 'public.set_profile_safety_fingerprint()'::regprocedure
     OR trg.tgtype <> 23
     OR trg.tgisinternal
     OR trg.tgenabled <> 'O'
     OR trg.tgnargs <> 0
     OR trg.tgqual IS NOT NULL
     OR cardinality(trg.tgattr::int2[]) <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: trg_set_profile_safety_fingerprint is not BEFORE INSERT OR UPDATE FOR EACH ROW on public.set_profile_safety_fingerprint()';
  END IF;

  -- Belt and braces: it is also the last BEFORE ROW trigger to fire (triggers
  -- of one timing fire in name order), though correctness does not rely on it.
  SELECT g.tgname::text INTO last_before
    FROM pg_trigger g
   WHERE g.tgrelid = 'public.profiles'::regclass
     AND NOT g.tgisinternal
     AND (g.tgtype & 1) = 1
     AND (g.tgtype & 2) = 2
   ORDER BY g.tgname::text COLLATE "C" DESC
   LIMIT 1;
  IF last_before IS DISTINCT FROM 'trg_set_profile_safety_fingerprint' THEN
    RAISE EXCEPTION 'postcondition failed: last BEFORE ROW trigger on profiles is %', last_before;
  END IF;

  -- RPC: exactly one function; the ten-argument contract; M4 everywhere
  -- except the tenth parameter and the body.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';
  IF n <> 1 OR rpc_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: expected exactly one replace_user_plans_atomic, the ten-argument one (found %)', n;
  END IF;
  IF to_regprocedure(
       'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: the nine-argument M4 function still exists';
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
     OR fn.pronargs <> 10 OR fn.pronargdefaults <> 2 THEN
    RAISE EXCEPTION 'postcondition failed: RPC language, security, volatility or arity is not the ten-argument contract';
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
  IF md5(fn.prosrc) = c_m4_md5 THEN
    RAISE EXCEPTION 'postcondition failed: RPC body is still the M4 body';
  END IF;
  IF obj_description(rpc_oid, 'pg_proc') IS DISTINCT FROM c_comment THEN
    RAISE EXCEPTION 'postcondition failed: RPC comment is %, expected % (carried over verbatim)',
      obj_description(rpc_oid, 'pg_proc'), c_comment;
  END IF;

  IF NOT has_table_privilege(fn.proowner::regrole::text, 'auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition failed: the definer cannot SELECT auth.users';
  END IF;
  IF NOT has_column_privilege(fn.proowner::regrole::text, 'public.profiles', 'safety_fingerprint', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition failed: the definer cannot SELECT profiles.safety_fingerprint';
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

  -- Workout-start gate: contract, body and grants.
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_active_plan_safety_status';
  IF n <> 1 OR gate_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: get_active_plan_safety_status is absent or overloaded';
  END IF;
  SELECT p.prokind, p.prosecdef, p.provolatile, p.proretset, p.pronargs, p.proowner,
         p.proconfig, p.prosrc, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = gate_oid;
  IF pg_get_function_identity_arguments(gate_oid) IS DISTINCT FROM '' OR fn.pronargs <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: get_active_plan_safety_status takes arguments';
  END IF;
  IF pg_get_function_result(gate_oid) IS DISTINCT FROM c_gate_result OR NOT fn.proretset THEN
    RAISE EXCEPTION 'postcondition failed: get_active_plan_safety_status result is %, expected %',
      pg_get_function_result(gate_oid), c_gate_result;
  END IF;
  IF fn.prokind <> 'f' OR fn.lanname <> 'sql' OR fn.provolatile <> 's' THEN
    RAISE EXCEPTION 'postcondition failed: get_active_plan_safety_status is not a STABLE sql function';
  END IF;
  IF fn.prosecdef THEN
    RAISE EXCEPTION 'postcondition failed: get_active_plan_safety_status is SECURITY DEFINER; it must run under the caller''s RLS';
  END IF;
  IF fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'postcondition failed: get_active_plan_safety_status proconfig is %', fn.proconfig;
  END IF;
  IF fn.prosrc IS DISTINCT FROM c_gate_body THEN
    RAISE EXCEPTION 'postcondition failed: get_active_plan_safety_status body differs from this file';
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = gate_oid AND a.grantee = 0;
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC holds % privilege(s) on get_active_plan_safety_status', n;
  END IF;
  IF has_function_privilege('anon', gate_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: anon can execute get_active_plan_safety_status';
  END IF;
  IF NOT has_function_privilege('authenticated', gate_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: authenticated cannot execute get_active_plan_safety_status';
  END IF;
  -- service_role is tolerated only because Supabase default privileges may
  -- grant it; without a JWT it gets profile_unavailable and nothing else.
  SELECT count(*) INTO n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = gate_oid
     AND a.grantee NOT IN (fn.proowner, 'authenticated'::regrole::oid, 'service_role'::regrole::oid);
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: % unexpected grantee(s) on get_active_plan_safety_status', n;
  END IF;
END
$mig$;

-- PostgREST caches function signatures. The ten-argument RPC and the gate are
-- invisible to /rest/v1/rpc until it reloads. NOTIFY is transactional: it is
-- delivered only when this transaction commits, and never on rollback.
NOTIFY pgrst, 'reload schema';

COMMIT;
