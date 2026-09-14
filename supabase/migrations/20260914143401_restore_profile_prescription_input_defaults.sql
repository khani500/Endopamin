-- 20260914143401_restore_profile_prescription_input_defaults.sql
-- REVERSE of 20260914143400_drop_profile_prescription_input_defaults.sql
-- UNEXECUTED. Manual rollback only. Do not supabase db push. Do not apply this
-- file together with the forward migration. Apply in the SQL Editor only to
-- undo 20260914143400, after review.
--
-- Restores the eleven original default expressions, verbatim as they appear in
-- the live catalog. equipment's default is an array literal cast onto a text
-- column; this file reproduces that expression and does not "fix" it.
--
-- ALTER COLUMN ... SET DEFAULT only. No data write, no UPDATE, no DELETE, no
-- backfill, no column drop/rename/retype, no NOT NULL.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back everything
-- this file did in the same run.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   all eleven have column_default IS NULL
--     -> restore the eleven measured expressions
--   all eleven already equal the measured expressions
--     -> SET DEFAULT is a no-op; AFTER assertions still run
--   any mixed, missing, or unexpected expression
--     -> fail closed, no mutate

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE _expected_defaults (
  attname name PRIMARY KEY,
  def     text NOT NULL
) ON COMMIT DROP;

INSERT INTO _expected_defaults (attname, def) VALUES
  ('gender',           $$'male'::text$$),
  ('equipment',        $$'{}'::text[]$$),
  ('location',         $$'gym'::text$$),
  ('activity',         $$'moderate'::text$$),
  ('session_duration', $$45$$),
  ('diet',             $$'none'::text$$),
  ('last_workout',     $$'this_week'::text$$),
  ('injuries',         $$''::text$$),
  ('height_unit',      $$'cm'::text$$),
  ('weight_unit',      $$'kg'::text$$),
  ('unit_system',      $$'metric'::text$$);

CREATE TEMP TABLE _profiles_pre ON COMMIT DROP AS
SELECT id, xmin AS row_xmin, ctid AS row_ctid
  FROM public.profiles;

CREATE TEMP TABLE _keep_pre ON COMMIT DROP AS
SELECT a.attname,
       a.atthasdef,
       pg_get_expr(d.adbin, d.adrelid) AS def,
       a.atttypid,
       a.atttypmod,
       a.attnotnull
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attrelid = 'public.profiles'::regclass
   AND a.attname = ANY (ARRAY[
         'steps_goal', 'active_calories_goal', 'dopa_level', 'dopa_xp',
         'streak_count', 'is_pro', 'created_at', 'onboarding_completed',
         'coach_id', 'coach', 'selected_coach', 'current_coach'
       ]::name[])
   AND a.attnum > 0
   AND NOT a.attisdropped;

CREATE TEMP TABLE _drop_pre ON COMMIT DROP AS
SELECT a.attname,
       a.atthasdef,
       pg_get_expr(d.adbin, d.adrelid) AS def,
       a.atttypid,
       a.atttypmod,
       a.attnotnull
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attrelid = 'public.profiles'::regclass
   AND a.attname = ANY (ARRAY[
         'gender', 'equipment', 'location', 'activity', 'session_duration',
         'diet', 'last_workout', 'injuries', 'height_unit', 'weight_unit',
         'unit_system'
       ]::name[])
   AND a.attnum > 0
   AND NOT a.attisdropped;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rel_oid    oid := to_regclass('public.profiles');
  rel        record;
  drop_list  text[] := ARRAY[
    'gender', 'equipment', 'location', 'activity', 'session_duration',
    'diet', 'last_workout', 'injuries', 'height_unit', 'weight_unit',
    'unit_system'
  ];
  col        text;
  n_drop     integer;
  n_null     integer;
  n_match    integer;
  rec        record;
BEGIN
  IF rel_oid IS NULL THEN
    RAISE EXCEPTION 'reverse precondition failed: public.profiles does not exist';
  END IF;

  SELECT c.relkind, c.relnamespace
    INTO rel
    FROM pg_class c
   WHERE c.oid = rel_oid;

  IF rel.relkind <> 'r' OR rel.relnamespace <> 'public'::regnamespace THEN
    RAISE EXCEPTION 'reverse precondition failed: profiles is not an ordinary table in schema public';
  END IF;

  SELECT count(*) INTO n_drop FROM _drop_pre;
  IF n_drop <> 11 THEN
    RAISE EXCEPTION 'reverse precondition failed: found % of 11 drop-list columns on public.profiles',
      n_drop;
  END IF;

  FOREACH col IN ARRAY drop_list LOOP
    SELECT * INTO rec FROM _drop_pre WHERE attname = col;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reverse precondition failed: public.profiles.% does not exist', col;
    END IF;
  END LOOP;

  SELECT count(*) FILTER (WHERE NOT atthasdef AND def IS NULL) INTO n_null FROM _drop_pre;
  SELECT count(*) INTO n_match
    FROM _drop_pre d
    JOIN _expected_defaults e ON e.attname = d.attname
   WHERE d.atthasdef
     AND d.def IS NOT DISTINCT FROM e.def;

  IF n_null = 11 THEN
    NULL; -- forward applied; restore
  ELSIF n_match = 11 THEN
    NULL; -- already restored; SET DEFAULT is a no-op
  ELSE
    RAISE EXCEPTION 'reverse precondition failed: catalog matches neither the post-forward state (11 null defaults) nor the measured originals (11 exact expressions); null=% match=%',
      n_null, n_match;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. SET DEFAULT to the measured live-catalog expressions, verbatim.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ALTER COLUMN gender SET DEFAULT 'male'::text,
  ALTER COLUMN equipment SET DEFAULT '{}'::text[],
  ALTER COLUMN location SET DEFAULT 'gym'::text,
  ALTER COLUMN activity SET DEFAULT 'moderate'::text,
  ALTER COLUMN session_duration SET DEFAULT 45,
  ALTER COLUMN diet SET DEFAULT 'none'::text,
  ALTER COLUMN last_workout SET DEFAULT 'this_week'::text,
  ALTER COLUMN injuries SET DEFAULT ''::text,
  ALTER COLUMN height_unit SET DEFAULT 'cm'::text,
  ALTER COLUMN weight_unit SET DEFAULT 'kg'::text,
  ALTER COLUMN unit_system SET DEFAULT 'metric'::text;

-- ---------------------------------------------------------------------------
-- 3. AFTER: eleven defaults match the measured expressions; keep-list and
--    do-not-touch columns unchanged; no profiles row was modified.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  drop_list text[] := ARRAY[
    'gender', 'equipment', 'location', 'activity', 'session_duration',
    'diet', 'last_workout', 'injuries', 'height_unit', 'weight_unit',
    'unit_system'
  ];
  keep_list text[] := ARRAY[
    'steps_goal', 'active_calories_goal', 'dopa_level', 'dopa_xp',
    'streak_count', 'is_pro', 'created_at', 'onboarding_completed'
  ];
  col       text;
  def       text;
  hasdef    boolean;
  info_def  text;
  expected  text;
  pre       record;
  post_type oid;
  post_mod  integer;
  post_nn   boolean;
  n_pre     bigint;
  n_post    bigint;
BEGIN
  FOREACH col IN ARRAY drop_list LOOP
    SELECT e.def INTO expected FROM _expected_defaults e WHERE e.attname = col;

    SELECT a.atthasdef, pg_get_expr(d.adbin, d.adrelid), a.atttypid, a.atttypmod, a.attnotnull
      INTO hasdef, def, post_type, post_mod, post_nn
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.profiles'::regclass
       AND a.attname = col
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF NOT hasdef OR def IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'reverse postcondition failed: public.profiles.% default is %, expected %',
        col, def, expected;
    END IF;

    SELECT c.column_default INTO info_def
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'profiles'
       AND c.column_name = col;

    IF info_def IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'reverse postcondition failed: information_schema.columns.column_default for public.profiles.% is %, expected %',
        col, info_def, expected;
    END IF;

    SELECT atttypid, atttypmod, attnotnull INTO pre FROM _drop_pre WHERE attname = col;
    IF post_type IS DISTINCT FROM pre.atttypid
       OR post_mod IS DISTINCT FROM pre.atttypmod
       OR post_nn IS DISTINCT FROM pre.attnotnull THEN
      RAISE EXCEPTION 'reverse postcondition failed: public.profiles.% type or nullability changed',
        col;
    END IF;
  END LOOP;

  FOREACH col IN ARRAY keep_list LOOP
    SELECT a.atthasdef, pg_get_expr(d.adbin, d.adrelid)
      INTO hasdef, def
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.profiles'::regclass
       AND a.attname = col
       AND a.attnum > 0
       AND NOT a.attisdropped;

    SELECT * INTO pre FROM _keep_pre WHERE attname = col;
    IF hasdef IS DISTINCT FROM pre.atthasdef OR def IS DISTINCT FROM pre.def THEN
      RAISE EXCEPTION 'reverse postcondition failed: keep-list column public.profiles.% was modified',
        col;
    END IF;
  END LOOP;

  FOR pre IN
    SELECT * FROM _keep_pre
     WHERE attname = ANY (ARRAY['coach_id', 'coach', 'selected_coach', 'current_coach']::name[])
  LOOP
    SELECT a.atthasdef, pg_get_expr(d.adbin, d.adrelid), a.atttypid, a.atttypmod, a.attnotnull
      INTO hasdef, def, post_type, post_mod, post_nn
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.profiles'::regclass
       AND a.attname = pre.attname
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF hasdef IS DISTINCT FROM pre.atthasdef
       OR def IS DISTINCT FROM pre.def
       OR post_type IS DISTINCT FROM pre.atttypid
       OR post_mod IS DISTINCT FROM pre.atttypmod
       OR post_nn IS DISTINCT FROM pre.attnotnull THEN
      RAISE EXCEPTION 'reverse postcondition failed: do-not-touch column public.profiles.% was modified',
        pre.attname;
    END IF;
  END LOOP;

  SELECT count(*) INTO n_pre  FROM _profiles_pre;
  SELECT count(*) INTO n_post FROM public.profiles;
  IF n_post IS DISTINCT FROM n_pre THEN
    RAISE EXCEPTION 'reverse postcondition failed: profiles row count changed from % to %',
      n_pre, n_post;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.profiles live
      FULL OUTER JOIN _profiles_pre snap ON snap.id = live.id
     WHERE snap.id IS NULL
        OR live.id IS NULL
        OR live.xmin IS DISTINCT FROM snap.row_xmin
        OR live.ctid IS DISTINCT FROM snap.row_ctid
  ) THEN
    RAISE EXCEPTION 'reverse postcondition failed: a profiles row was inserted, deleted or modified';
  END IF;
END
$mig$;

COMMIT;
