-- 20260922140000_add_profile_equipment_extras.sql
-- UNEXECUTED. This file is in the tree for review. It has not been applied to
-- any database. Do not supabase db push. Apply in the SQL Editor after review.
-- Reverse: 20260922140001_drop_profile_equipment_extras.sql
-- The reverse file must NEVER be executed as a sequential follow-on. This
-- repo's production migrations are applied one at a time by hand in the SQL
-- Editor. supabase db push is never run against production.
--
-- Adds public.profiles.equipment_extras text[] NULL (no DEFAULT) so
-- save-profile can store optional extras tokens (bands, pullup_bar,
-- door_anchor). NULL means no extras and implies nothing about equipment.
--
-- ADD COLUMN only. No data write, no UPDATE, no DELETE, no backfill, no
-- column drop/rename/retype, no NOT NULL, no CHECK, no DEFAULT.
-- Does not touch equipment or any other profile column.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back
-- everything this file did in the same run.
--
-- IDEMPOTENT. Two legal catalogs, chosen before anything is mutated:
--   equipment_extras is absent
--     -> ADD COLUMN text[] (nullable, no DEFAULT)
--   equipment_extras already exists as text[], nullable, no DEFAULT
--     -> ADD is skipped; AFTER assertions still run
--   any other type, nullability, or default
--     -> fail closed, no mutate

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- Snapshot row identities and keep-list catalog BEFORE any change.
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
       a.attnotnull,
       a.attnum
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
   AND a.attname = 'equipment_extras'
   AND a.attnum > 0
   AND NOT a.attisdropped;

CREATE TEMP TABLE _attr_count_pre ON COMMIT DROP AS
SELECT count(*) AS n
  FROM pg_attribute
 WHERE attrelid = 'public.profiles'::regclass
   AND attnum > 0
   AND NOT attisdropped;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rel_oid    oid := to_regclass('public.profiles');
  rel        record;
  n_keep     integer;
  n_keep_ok  integer;
  n_col      integer;
  n_attr     integer;
  rec        record;
  textarr_oid oid := 'text[]'::regtype;
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
    RAISE EXCEPTION 'precondition failed: equipment_extras matched % live attributes',
      n_col;
  END IF;

  IF n_col = 1 THEN
    SELECT * INTO rec FROM _col_pre;
    IF rec.atttypid IS DISTINCT FROM textarr_oid THEN
      RAISE EXCEPTION 'precondition failed: public.profiles.equipment_extras has type %, expected text[]',
        rec.atttypid;
    END IF;
    IF rec.attnotnull THEN
      RAISE EXCEPTION 'precondition failed: public.profiles.equipment_extras is NOT NULL; expected nullable';
    END IF;
    IF rec.atthasdef OR rec.def IS NOT NULL THEN
      RAISE EXCEPTION 'precondition failed: public.profiles.equipment_extras has a DEFAULT (%); expected none',
        rec.def;
    END IF;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. ADD COLUMN. Catalog-only. Idempotent if already present as text[] NULL.
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _col_pre) THEN
    ALTER TABLE public.profiles
      ADD COLUMN equipment_extras text[];
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. AFTER: column is text[] nullable with no DEFAULT; keep-list untouched;
--    information_schema reports ARRAY / _text / nullable / no default;
--    no profiles row was inserted, deleted or updated.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  textarr_oid oid := 'text[]'::regtype;
  hasdef    boolean;
  def       text;
  post_type oid;
  post_mod  integer;
  post_nn   boolean;
  n_pre     bigint;
  n_post    bigint;
  n_attr_pre integer;
  n_attr_post integer;
  n_keep    integer;
  n_keep_seen integer;
  pre       record;
  col_existed boolean;
  info      record;
BEGIN
  SELECT a.atthasdef, pg_get_expr(d.adbin, d.adrelid), a.atttypid, a.atttypmod, a.attnotnull
    INTO hasdef, def, post_type, post_mod, post_nn
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attname = 'equipment_extras'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'postcondition failed: public.profiles.equipment_extras is absent';
  END IF;

  IF post_type IS DISTINCT FROM textarr_oid THEN
    RAISE EXCEPTION 'postcondition failed: public.profiles.equipment_extras type is %, expected text[]',
      post_type;
  END IF;

  IF post_nn THEN
    RAISE EXCEPTION 'postcondition failed: public.profiles.equipment_extras is NOT NULL';
  END IF;

  IF hasdef OR def IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: public.profiles.equipment_extras has a DEFAULT (%); expected none',
      def;
  END IF;

  SELECT c.data_type, c.udt_name, c.column_default, c.is_nullable
    INTO info
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'profiles'
     AND c.column_name = 'equipment_extras';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'postcondition failed: information_schema has no public.profiles.equipment_extras';
  END IF;

  IF info.data_type IS DISTINCT FROM 'ARRAY' THEN
    RAISE EXCEPTION 'postcondition failed: data_type is %, expected ARRAY',
      info.data_type;
  END IF;

  IF info.udt_name IS DISTINCT FROM '_text' THEN
    RAISE EXCEPTION 'postcondition failed: udt_name is %, expected _text',
      info.udt_name;
  END IF;

  IF info.column_default IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: column_default is %, expected NULL',
      info.column_default;
  END IF;

  IF info.is_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'postcondition failed: is_nullable is %, expected YES',
      info.is_nullable;
  END IF;

  SELECT EXISTS (SELECT 1 FROM _col_pre) INTO col_existed;
  SELECT n INTO n_attr_pre FROM _attr_count_pre;
  SELECT count(*) INTO n_attr_post
    FROM pg_attribute
   WHERE attrelid = 'public.profiles'::regclass
     AND attnum > 0
     AND NOT attisdropped;

  IF col_existed THEN
    IF n_attr_post IS DISTINCT FROM n_attr_pre THEN
      RAISE EXCEPTION 'postcondition failed: live attribute count changed from % to % on an already-present column',
        n_attr_pre, n_attr_post;
    END IF;
  ELSE
    IF n_attr_post IS DISTINCT FROM n_attr_pre + 1 THEN
      RAISE EXCEPTION 'postcondition failed: live attribute count changed from % to %, expected %',
        n_attr_pre, n_attr_post, n_attr_pre + 1;
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
