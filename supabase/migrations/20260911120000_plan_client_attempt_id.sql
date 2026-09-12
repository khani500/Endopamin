-- 20260911120000_plan_client_attempt_id.sql
-- M3 / C-2.
--
-- Adds a nullable client_attempt_id to public.workout_plans and
-- public.nutrition_plans, and creates one independent partial unique index per
-- table over (user_id, client_attempt_id) with the predicate
--     user_id IS NOT NULL AND client_attempt_id IS NOT NULL
--
-- No backfill. No policy. No grant. No trigger. No default. No NOT NULL.
-- No CHECK. No data is written. A healthy re-run is a no-op.
--
-- Every verification reads the catalog and compares by OID where an OID exists.
-- Any present state that does not match the contract raises and aborts the
-- whole transaction: this migration never drops, rebuilds or repairs an
-- existing object.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED. Both targets must exist as ordinary tables
--    in the public schema.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t        text;
  rel_oid  oid;
  rel      record;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.workout_plans', 'public.nutrition_plans'] LOOP
    rel_oid := to_regclass(t);
    IF rel_oid IS NULL THEN
      RAISE EXCEPTION 'M3 precondition failed: relation % does not exist', t;
    END IF;

    SELECT c.relkind, c.relnamespace
      INTO rel
      FROM pg_class c
     WHERE c.oid = rel_oid;

    IF rel.relkind <> 'r' THEN
      RAISE EXCEPTION 'M3 precondition failed: % has relkind %, expected an ordinary table',
        t, rel.relkind;
    END IF;

    IF rel.relnamespace <> 'public'::regnamespace THEN
      RAISE EXCEPTION 'M3 precondition failed: % does not live in schema public', t;
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. THE COLUMN. Nullable by omission. No DEFAULT, so no table rewrite.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_plans   ADD COLUMN IF NOT EXISTS client_attempt_id uuid;
ALTER TABLE public.nutrition_plans ADD COLUMN IF NOT EXISTS client_attempt_id uuid;

-- ---------------------------------------------------------------------------
-- 3. VERIFY THE COLUMN FROM THE CATALOG. A pre-existing column of the wrong
--    type, or one already NOT NULL, is an incompatible present state.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t        text;
  rel_oid  oid;
  att      record;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.workout_plans', 'public.nutrition_plans'] LOOP
    rel_oid := to_regclass(t);

    SELECT a.atttypid, a.atttypmod, a.attnotnull, a.attidentity,
           a.attgenerated, a.atthasdef
      INTO att
      FROM pg_attribute a
     WHERE a.attrelid = rel_oid
       AND a.attname  = 'client_attempt_id'
       AND a.attnum   > 0
       AND NOT a.attisdropped;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'M3 failed: %.client_attempt_id is absent after ADD COLUMN', t;
    END IF;

    IF att.atttypid <> 'uuid'::regtype THEN
      RAISE EXCEPTION 'M3 failed: %.client_attempt_id is type %, expected uuid',
        t, format_type(att.atttypid, att.atttypmod);
    END IF;

    IF att.attnotnull THEN
      RAISE EXCEPTION 'M3 failed: %.client_attempt_id is NOT NULL; the contract is nullable', t;
    END IF;

    IF att.atthasdef OR att.attidentity <> '' OR att.attgenerated <> '' THEN
      RAISE EXCEPTION 'M3 failed: %.client_attempt_id carries a default, identity or generation expression', t;
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. THE INDEXES. One per table, independent. Created only when the name is
--    free; when it is taken, the existing object is held to the same contract
--    and the migration aborts rather than touching it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec         record;
  rel_oid      oid;
  idx_oid      oid;
  idx          record;
  keypos       record;
  expected_pred CONSTANT text :=
    '((user_id IS NOT NULL) AND (client_attempt_id IS NOT NULL))';
  actual_pred  text;
  expect_cols  CONSTANT text[] := ARRAY['user_id', 'client_attempt_id'];
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.workout_plans',   'workout_plans_user_attempt_uniq'),
      ('public.nutrition_plans', 'nutrition_plans_user_attempt_uniq')
    ) AS v(tbl, idx_name)
  LOOP
    rel_oid := to_regclass(spec.tbl);
    idx_oid := to_regclass('public.' || spec.idx_name);

    IF idx_oid IS NULL THEN
      EXECUTE format(
        'CREATE UNIQUE INDEX %I ON %s USING btree (user_id, client_attempt_id) '
        'WHERE user_id IS NOT NULL AND client_attempt_id IS NOT NULL',
        spec.idx_name, spec.tbl
      );
      idx_oid := to_regclass('public.' || spec.idx_name);
      IF idx_oid IS NULL THEN
        RAISE EXCEPTION 'M3 failed: % was not created', spec.idx_name;
      END IF;
    END IF;

    -- One verification path, applied to the just-created and the pre-existing
    -- object alike.
    SELECT c.relkind, c.relnamespace, am.amname,
           i.indrelid, i.indisunique, i.indisprimary, i.indisexclusion,
           i.indisvalid, i.indisready, i.indislive,
           i.indnkeyatts, i.indnatts,
           i.indexprs IS NOT NULL AS has_exprs,
           i.indpred  IS NOT NULL AS is_partial
      INTO idx
      FROM pg_index i
      JOIN pg_class c  ON c.oid  = i.indexrelid
      JOIN pg_am    am ON am.oid = c.relam
     WHERE i.indexrelid = idx_oid;

    IF NOT FOUND OR idx.relkind <> 'i' THEN
      RAISE EXCEPTION 'M3 failed: % exists but is not an index', spec.idx_name;
    END IF;

    IF idx.relnamespace <> 'public'::regnamespace THEN
      RAISE EXCEPTION 'M3 failed: % does not live in schema public', spec.idx_name;
    END IF;

    IF idx.indrelid <> rel_oid THEN
      RAISE EXCEPTION 'M3 failed: % is attached to relation oid %, expected % (oid %)',
        spec.idx_name, idx.indrelid, spec.tbl, rel_oid;
    END IF;

    IF idx.amname <> 'btree' THEN
      RAISE EXCEPTION 'M3 failed: % uses access method %, expected btree',
        spec.idx_name, idx.amname;
    END IF;

    IF NOT idx.indisunique THEN
      RAISE EXCEPTION 'M3 failed: % is not unique', spec.idx_name;
    END IF;

    IF idx.indisprimary OR idx.indisexclusion THEN
      RAISE EXCEPTION 'M3 failed: % is a primary or exclusion index; the contract is a bare unique index',
        spec.idx_name;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = idx_oid) THEN
      RAISE EXCEPTION 'M3 failed: % is owned by a constraint; the contract is a bare index',
        spec.idx_name;
    END IF;

    IF NOT (idx.indisvalid AND idx.indisready AND idx.indislive) THEN
      RAISE EXCEPTION 'M3 failed: % is not valid, ready and live (valid=%, ready=%, live=%)',
        spec.idx_name, idx.indisvalid, idx.indisready, idx.indislive;
    END IF;

    IF idx.has_exprs THEN
      RAISE EXCEPTION 'M3 failed: % contains an expression key; the contract is two plain columns',
        spec.idx_name;
    END IF;

    IF idx.indnkeyatts <> 2 OR idx.indnatts <> 2 THEN
      RAISE EXCEPTION 'M3 failed: % has % key and % total attributes, expected exactly 2 and 2 (no INCLUDE)',
        spec.idx_name, idx.indnkeyatts, idx.indnatts;
    END IF;

    -- Per key position: name, order, default sort behaviour, collation and
    -- opclass. indkey, indoption, indcollation and indclass are 0-based vectors.
    FOR keypos IN
      SELECT k.ord,
             a.attname,
             a.atttypid,
             a.attcollation,
             i.indoption[k.ord - 1]    AS opt,
             i.indcollation[k.ord - 1] AS coll,
             i.indclass[k.ord - 1]     AS opc
        FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum   = k.attnum
       WHERE i.indexrelid = idx_oid
       ORDER BY k.ord
    LOOP
      IF keypos.attname <> expect_cols[keypos.ord] THEN
        RAISE EXCEPTION 'M3 failed: % key % is %, expected %',
          spec.idx_name, keypos.ord, keypos.attname, expect_cols[keypos.ord];
      END IF;

      -- 0 = ASC, NULLS LAST: the btree default for both columns.
      IF keypos.opt <> 0 THEN
        RAISE EXCEPTION 'M3 failed: % key % (%) has non-default sort options (indoption=%), expected ASC NULLS LAST',
          spec.idx_name, keypos.ord, keypos.attname, keypos.opt;
      END IF;

      IF keypos.coll <> keypos.attcollation THEN
        RAISE EXCEPTION 'M3 failed: % key % (%) uses collation oid %, expected the column collation %',
          spec.idx_name, keypos.ord, keypos.attname, keypos.coll, keypos.attcollation;
      END IF;

      IF NOT EXISTS (
        SELECT 1
          FROM pg_opclass oc
          JOIN pg_am am ON am.oid = oc.opcmethod
         WHERE oc.oid          = keypos.opc
           AND oc.opcdefault
           AND am.amname       = 'btree'
           AND oc.opcintype    = keypos.atttypid
      ) THEN
        RAISE EXCEPTION 'M3 failed: % key % (%) does not use the default btree opclass for its column type',
          spec.idx_name, keypos.ord, keypos.attname;
      END IF;
    END LOOP;

    IF NOT idx.is_partial THEN
      RAISE EXCEPTION 'M3 failed: % is not partial', spec.idx_name;
    END IF;

    -- Non-pretty deparse on purpose: it is the canonical, fully parenthesised
    -- form, identical to what pg_get_indexdef reports.
    SELECT pg_get_expr(i.indpred, i.indrelid)
      INTO actual_pred
      FROM pg_index i
     WHERE i.indexrelid = idx_oid;

    IF actual_pred IS DISTINCT FROM expected_pred THEN
      RAISE EXCEPTION 'M3 failed: % predicate is %, expected %',
        spec.idx_name, actual_pred, expected_pred;
    END IF;
  END LOOP;
END
$$;

COMMIT;
