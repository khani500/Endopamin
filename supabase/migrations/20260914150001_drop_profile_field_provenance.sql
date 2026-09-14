-- 20260914150001_drop_profile_field_provenance.sql
-- REVERSE of 20260914150000_add_profile_field_provenance.sql
-- UNEXECUTED. Manual rollback only. Do not supabase db push. Do not apply this
-- file together with the forward migration. Apply in the SQL Editor only to
-- undo 20260914150000, after review.
-- The reverse file must NEVER be executed as part of a sequential migration
-- run. This repo's production migrations are applied one at a time by hand
-- in the SQL Editor. supabase db push is never run against production.
--
-- Drops public.profiles.field_provenance. Catalog-only. No data write against
-- any other column. Existing profile values are left untouched.
--
-- DROP COLUMN only. No UPDATE, no DELETE, no backfill, no retype, no NOT NULL.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back everything
-- this file did in the same run.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   field_provenance exists as jsonb, nullable, default NULL
--     -> DROP COLUMN
--   field_provenance is already absent
--     -> DROP is skipped; AFTER assertions still run
--   any other type, nullability, or default
--     -> fail closed, no mutate

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

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
         'streak_count', 'is_pro', 'created_at', 'onboarding_completed'
       ]::name[])
   AND a.attnum > 0
   AND NOT a.attisdropped;

CREATE TEMP TABLE _col_pre ON COMMIT DROP AS
SELECT a.attname,
       a.atthasdef,
       pg_get_expr(d.adbin, d.adrelid) AS def,
       a.atttypid,
       a.atttypmod,
       a.attnotnull
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attrelid = 'public.profiles'::regclass
   AND a.attname = 'field_provenance'
   AND a.attnum > 0
   AND NOT a.attisdropped;

CREATE TEMP TABLE _attr_count_pre ON COMMIT DROP AS
SELECT count(*) AS n
  FROM pg_attribute
 WHERE attrelid = 'public.profiles'::regclass
   AND attnum > 0
   AND NOT attisdropped;

DO $mig$
DECLARE
  rel_oid   oid := to_regclass('public.profiles');
  rel       record;
  n_keep    integer;
  n_keep_ok integer;
  n_col     integer;
  n_attr    integer;
  rec       record;
  jsonb_oid oid := 'jsonb'::regtype;
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

  SELECT n INTO n_attr FROM _attr_count_pre;
  IF n_attr IS NULL OR n_attr < 8 THEN
    RAISE EXCEPTION 'precondition failed: public.profiles has % live attributes, expected at least 8',
      n_attr;
  END IF;

  SELECT count(*) INTO n_keep FROM _keep_pre;
  IF n_keep <> 8 THEN
    RAISE EXCEPTION 'precondition failed: found % of 8 keep-list columns on public.profiles',
      n_keep;
  END IF;

  SELECT count(*) INTO n_keep_ok
    FROM _keep_pre
   WHERE atthasdef AND def IS NOT NULL;
  IF n_keep_ok <> 8 THEN
    RAISE EXCEPTION 'precondition failed: % of 8 keep-list columns currently have a default; refusing to proceed against a catalog that is not the measured one',
      n_keep_ok;
  END IF;

  SELECT count(*) INTO n_col FROM _col_pre;
  IF n_col NOT IN (0, 1) THEN
    RAISE EXCEPTION 'precondition failed: field_provenance matched % live attributes',
      n_col;
  END IF;

  IF n_col = 1 THEN
    SELECT * INTO rec FROM _col_pre;
    IF rec.atttypid IS DISTINCT FROM jsonb_oid THEN
      RAISE EXCEPTION 'precondition failed: public.profiles.field_provenance has type %, expected jsonb; refusing to drop a different column',
        rec.atttypid;
    END IF;
    IF rec.attnotnull THEN
      RAISE EXCEPTION 'precondition failed: public.profiles.field_provenance is NOT NULL; refusing to drop an unexpected definition';
    END IF;
    IF rec.def IS NOT NULL AND rec.def !~* '^NULL(::jsonb)?$' THEN
      RAISE EXCEPTION 'precondition failed: public.profiles.field_provenance default is %, expected NULL',
        rec.def;
    END IF;
  END IF;
END
$mig$;

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM _col_pre) THEN
    ALTER TABLE public.profiles
      DROP COLUMN field_provenance;
  END IF;
END
$mig$;

DO $mig$
DECLARE
  n_col     integer;
  n_pre     bigint;
  n_post    bigint;
  n_attr_pre integer;
  n_attr_post integer;
  n_keep    integer;
  n_keep_seen integer;
  hasdef    boolean;
  def       text;
  post_type oid;
  post_mod  integer;
  post_nn   boolean;
  pre       record;
  col_existed boolean;
BEGIN
  SELECT count(*) INTO n_col
    FROM pg_attribute a
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attname = 'field_provenance'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF n_col <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: public.profiles.field_provenance still exists';
  END IF;

  SELECT EXISTS (SELECT 1 FROM _col_pre) INTO col_existed;
  SELECT n INTO n_attr_pre FROM _attr_count_pre;
  SELECT count(*) INTO n_attr_post
    FROM pg_attribute
   WHERE attrelid = 'public.profiles'::regclass
     AND attnum > 0
     AND NOT attisdropped;

  IF col_existed THEN
    IF n_attr_post IS DISTINCT FROM n_attr_pre - 1 THEN
      RAISE EXCEPTION 'postcondition failed: live attribute count changed from % to %, expected %',
        n_attr_pre, n_attr_post, n_attr_pre - 1;
    END IF;
  ELSE
    IF n_attr_post IS DISTINCT FROM n_attr_pre THEN
      RAISE EXCEPTION 'postcondition failed: live attribute count changed from % to % on an already-absent column',
        n_attr_pre, n_attr_post;
    END IF;
  END IF;

  SELECT count(*) INTO n_keep FROM _keep_pre;
  IF n_keep <> 8 THEN
    RAISE EXCEPTION 'postcondition failed: _keep_pre has % rows, expected 8',
      n_keep;
  END IF;

  n_keep_seen := 0;
  FOR pre IN SELECT * FROM _keep_pre LOOP
    n_keep_seen := n_keep_seen + 1;
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
      RAISE EXCEPTION 'postcondition failed: keep-list column public.profiles.% was modified',
        pre.attname;
    END IF;
  END LOOP;

  IF n_keep_seen <> 8 THEN
    RAISE EXCEPTION 'postcondition failed: keep-list loop ran % times, expected 8',
      n_keep_seen;
  END IF;

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
