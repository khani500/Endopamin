-- 20260914143400_drop_profile_prescription_input_defaults.sql
-- UNEXECUTED. This file is in the tree for review. It has not been applied to
-- any database. Do not supabase db push. Apply in the SQL Editor after review.
-- Reverse: 20260914143401_restore_profile_prescription_input_defaults.sql
--
-- Drops the DEFAULT on eleven public.profiles prescription-input columns so a
-- client that omits a key on INSERT no longer receives a fabricated answer
-- written by the database. That is how production rows acquired gender 'male'
-- without a user choosing it.
--
-- ALTER COLUMN ... DROP DEFAULT only. No data write, no UPDATE, no DELETE, no
-- backfill, no column drop/rename/retype, no NOT NULL.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back everything
-- this file did in the same run.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   all eleven currently have a non-null column_default -> drop those defaults
--   all eleven already have column_default IS NULL     -> DROP DEFAULT is a
--     no-op; AFTER assertions still run
--   any mixed or missing column                        -> fail closed, no mutate
--
-- AFTER also holds the eight keep-list columns to a non-null default, so a
-- migration that dropped every default on the table cannot pass.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- Snapshot row identities and keep-list defaults BEFORE any catalog change.
-- xmin/ctid detect in-place updates; the id set detects insert/delete.
-- ---------------------------------------------------------------------------
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
  rel_oid   oid := to_regclass('public.profiles');
  rel       record;
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
  n_drop    integer;
  n_with    integer;
  n_keep    integer;
  n_keep_def integer;
  rec       record;
BEGIN
  IF rel_oid IS NULL THEN
    RAISE EXCEPTION 'precondition failed: public.profiles does not exist';
  END IF;

  SELECT c.relkind, c.relnamespace
    INTO rel
    FROM pg_class c
   WHERE c.oid = rel_oid;

  IF rel.relkind <> 'r' THEN
    RAISE EXCEPTION 'precondition failed: profiles has relkind %, expected an ordinary table',
      rel.relkind;
  END IF;

  IF rel.relnamespace <> 'public'::regnamespace THEN
    RAISE EXCEPTION 'precondition failed: profiles does not live in schema public';
  END IF;

  SELECT count(*) INTO n_drop FROM _drop_pre;
  IF n_drop <> 11 THEN
    RAISE EXCEPTION 'precondition failed: found % of 11 drop-list columns on public.profiles',
      n_drop;
  END IF;

  FOREACH col IN ARRAY drop_list LOOP
    SELECT * INTO rec FROM _drop_pre WHERE attname = col;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'precondition failed: public.profiles.% does not exist', col;
    END IF;
  END LOOP;

  SELECT count(*) FILTER (WHERE atthasdef) INTO n_with FROM _drop_pre;
  IF n_with NOT IN (0, 11) THEN
    RAISE EXCEPTION 'precondition failed: % of 11 drop-list columns have a default; expected 11 (unapplied) or 0 (already applied)',
      n_with;
  END IF;

  IF n_with = 11 THEN
    FOREACH col IN ARRAY drop_list LOOP
      SELECT * INTO rec FROM _drop_pre WHERE attname = col;
      IF rec.def IS NULL OR NOT rec.atthasdef THEN
        RAISE EXCEPTION 'precondition failed: public.profiles.% does not currently have a non-null column_default',
          col;
      END IF;
    END LOOP;
  END IF;

  SELECT count(*) INTO n_keep FROM _keep_pre
   WHERE attname = ANY (keep_list);
  IF n_keep <> 8 THEN
    RAISE EXCEPTION 'precondition failed: found % of 8 keep-list columns on public.profiles',
      n_keep;
  END IF;

  SELECT count(*) FILTER (WHERE atthasdef AND def IS NOT NULL) INTO n_keep_def
    FROM _keep_pre
   WHERE attname = ANY (keep_list);
  IF n_keep_def <> 8 THEN
    RAISE EXCEPTION 'precondition failed: % of 8 keep-list columns currently have a default; refusing to proceed against a catalog that is not the measured one',
      n_keep_def;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. DROP DEFAULT. Catalog-only. Idempotent if already absent.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ALTER COLUMN gender DROP DEFAULT,
  ALTER COLUMN equipment DROP DEFAULT,
  ALTER COLUMN location DROP DEFAULT,
  ALTER COLUMN activity DROP DEFAULT,
  ALTER COLUMN session_duration DROP DEFAULT,
  ALTER COLUMN diet DROP DEFAULT,
  ALTER COLUMN last_workout DROP DEFAULT,
  ALTER COLUMN injuries DROP DEFAULT,
  ALTER COLUMN height_unit DROP DEFAULT,
  ALTER COLUMN weight_unit DROP DEFAULT,
  ALTER COLUMN unit_system DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. AFTER: drop-list defaults are gone; keep-list defaults are untouched;
--    no profiles row was inserted, deleted or updated.
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
  pre       record;
  post_type oid;
  post_mod  integer;
  post_nn   boolean;
  n_pre     bigint;
  n_post    bigint;
BEGIN
  FOREACH col IN ARRAY drop_list LOOP
    SELECT a.atthasdef, pg_get_expr(d.adbin, d.adrelid), a.atttypid, a.atttypmod, a.attnotnull
      INTO hasdef, def, post_type, post_mod, post_nn
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.profiles'::regclass
       AND a.attname = col
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF hasdef OR def IS NOT NULL THEN
      RAISE EXCEPTION 'postcondition failed: public.profiles.% still has column_default %',
        col, def;
    END IF;

    SELECT c.column_default INTO info_def
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'profiles'
       AND c.column_name = col;

    IF info_def IS NOT NULL THEN
      RAISE EXCEPTION 'postcondition failed: information_schema.columns.column_default for public.profiles.% is %, expected NULL',
        col, info_def;
    END IF;

    SELECT atttypid, atttypmod, attnotnull INTO pre FROM _drop_pre WHERE attname = col;
    IF post_type IS DISTINCT FROM pre.atttypid
       OR post_mod IS DISTINCT FROM pre.atttypmod
       OR post_nn IS DISTINCT FROM pre.attnotnull THEN
      RAISE EXCEPTION 'postcondition failed: public.profiles.% type or nullability changed',
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

    IF NOT hasdef OR def IS NULL THEN
      RAISE EXCEPTION 'postcondition failed: keep-list column public.profiles.% lost its default',
        col;
    END IF;

    SELECT * INTO pre FROM _keep_pre WHERE attname = col;
    IF def IS DISTINCT FROM pre.def THEN
      RAISE EXCEPTION 'postcondition failed: keep-list column public.profiles.% default changed from % to %',
        col, pre.def, def;
    END IF;
  END LOOP;

  -- Do-not-touch remainder (coach_id, coach, selected_coach, current_coach):
  -- whatever default they had before must be byte-identical after.
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
      RAISE EXCEPTION 'postcondition failed: do-not-touch column public.profiles.% was modified',
        pre.attname;
    END IF;
  END LOOP;

  SELECT count(*) INTO n_pre  FROM _profiles_pre;
  SELECT count(*) INTO n_post FROM public.profiles;
  IF n_post IS DISTINCT FROM n_pre THEN
    RAISE EXCEPTION 'postcondition failed: profiles row count changed from % to %',
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
    RAISE EXCEPTION 'postcondition failed: a profiles row was inserted, deleted or modified';
  END IF;
END
$mig$;

COMMIT;
