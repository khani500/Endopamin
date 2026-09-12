-- 20260911140000_plan_replacement_rpc.sql
-- M4 / C-1. ONE atomic migration: function creation, OWNER TO postgres, execute
-- restriction, and every ownership/privilege assertion in a single transaction.
-- Splitting is prohibited: between a create step and a later privilege step
-- PUBLIC holds EXECUTE, which is the hole the restriction exists to close.
--
-- Not in this migration: the endpoint, M5's policy drops, M6's trigger, any
-- fingerprint, any NOT NULL or CHECK, any policy, any backfill.
--
-- A healthy re-run is a no-op. A same-named function with a different signature
-- or a different body aborts the migration; nothing is ever replaced silently.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED — relations, roles, auth.users.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  t    text;
  rel  record;
  r    text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.workout_plans', 'public.nutrition_plans'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'M4 precondition failed: relation % does not exist', t;
    END IF;

    SELECT c.relkind, c.relnamespace INTO rel FROM pg_class c WHERE c.oid = to_regclass(t);
    IF rel.relkind <> 'r' OR rel.relnamespace <> 'public'::regnamespace THEN
      RAISE EXCEPTION 'M4 precondition failed: % is not an ordinary table in schema public', t;
    END IF;
  END LOOP;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'M4 precondition failed: auth.users does not exist; the per-user lock has no target';
  END IF;

  FOREACH r IN ARRAY ARRAY['postgres', 'service_role', 'anon', 'authenticated'] LOOP
    IF to_regrole(quote_ident(r)) IS NULL THEN
      RAISE EXCEPTION 'M4 precondition failed: role % does not exist', r;
    END IF;
  END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. EVERY COLUMN THE FUNCTION TOUCHES, VERIFIED BY CATALOG. A function that
--    compiles but references a column of the wrong type is runtime-broken; this
--    turns that into a migration failure.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  spec record;
  att  record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.workout_plans',   'id',                'uuid'),
      ('public.workout_plans',   'user_id',           'uuid'),
      ('public.workout_plans',   'coach_id',          'text'),
      ('public.workout_plans',   'plan_type',         'text'),
      ('public.workout_plans',   'week_start',        'date'),
      ('public.workout_plans',   'week_number',       'integer'),
      ('public.workout_plans',   'activate_on',       'date'),
      ('public.workout_plans',   'plan_data',         'jsonb'),
      ('public.workout_plans',   'is_active',         'boolean'),
      ('public.workout_plans',   'client_attempt_id', 'uuid'),
      ('public.nutrition_plans', 'id',                'uuid'),
      ('public.nutrition_plans', 'user_id',           'uuid'),
      ('public.nutrition_plans', 'plan_data',         'jsonb'),
      ('public.nutrition_plans', 'is_active',         'boolean'),
      ('public.nutrition_plans', 'client_attempt_id', 'uuid'),
      ('auth.users',             'id',                'uuid')
    ) AS v(tbl, col, typ)
  LOOP
    SELECT a.atttypid, a.atttypmod
      INTO att
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass(spec.tbl)
       AND a.attname  = spec.col
       AND a.attnum   > 0
       AND NOT a.attisdropped;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'M4 precondition failed: %.% does not exist', spec.tbl, spec.col;
    END IF;

    IF att.atttypid <> spec.typ::regtype THEN
      RAISE EXCEPTION 'M4 precondition failed: %.% is type %, expected %',
        spec.tbl, spec.col, format_type(att.atttypid, att.atttypmod), spec.typ;
    END IF;
  END LOOP;

  -- generated_at must be database-owned: the function never supplies it.
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.workout_plans',   'generated_at'),
      ('public.nutrition_plans', 'generated_at')
    ) AS v(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = to_regclass(spec.tbl)
         AND a.attname  = spec.col
         AND a.atthasdef
         AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'M4 precondition failed: %.% has no default; it is database-owned in this design',
        spec.tbl, spec.col;
    END IF;
  END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. THE M3 INDEXES MUST BE PRESENT AND EXACTLY AS CONTRACTED. Without them the
--    attempt id is not unique per owner and the replay logic below is a lie.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  spec         record;
  rel_oid      oid;
  idx_oid      oid;
  idx          record;
  keypos       record;
  cols         text[];
  expect_cols  CONSTANT text[] := ARRAY['user_id', 'client_attempt_id'];
  expected_pred CONSTANT text :=
    '((user_id IS NOT NULL) AND (client_attempt_id IS NOT NULL))';
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
      RAISE EXCEPTION 'M4 precondition failed: index % is absent; M3 has not been applied', spec.idx_name;
    END IF;

    SELECT c.relkind, c.relnamespace, am.amname,
           i.indrelid, i.indisunique, i.indisprimary, i.indisexclusion,
           i.indisvalid, i.indisready, i.indislive,
           i.indnkeyatts, i.indnatts,
           i.indexprs IS NOT NULL AS has_exprs,
           pg_get_expr(i.indpred, i.indrelid) AS pred
      INTO idx
      FROM pg_index i
      JOIN pg_class c  ON c.oid  = i.indexrelid
      JOIN pg_am    am ON am.oid = c.relam
     WHERE i.indexrelid = idx_oid;

    IF NOT FOUND OR idx.relkind <> 'i' OR idx.relnamespace <> 'public'::regnamespace THEN
      RAISE EXCEPTION 'M4 precondition failed: % is not an index in schema public', spec.idx_name;
    END IF;

    IF idx.indrelid <> rel_oid THEN
      RAISE EXCEPTION 'M4 precondition failed: % is attached to relation oid %, expected % (oid %)',
        spec.idx_name, idx.indrelid, spec.tbl, rel_oid;
    END IF;

    IF idx.amname <> 'btree' OR NOT idx.indisunique
       OR idx.indisprimary OR idx.indisexclusion THEN
      RAISE EXCEPTION 'M4 precondition failed: % is not a bare unique btree index', spec.idx_name;
    END IF;

    IF NOT (idx.indisvalid AND idx.indisready AND idx.indislive) THEN
      RAISE EXCEPTION 'M4 precondition failed: % is not valid, ready and live', spec.idx_name;
    END IF;

    IF idx.has_exprs OR idx.indnkeyatts <> 2 OR idx.indnatts <> 2 THEN
      RAISE EXCEPTION 'M4 precondition failed: % does not have exactly two plain key columns', spec.idx_name;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = idx_oid) THEN
      RAISE EXCEPTION 'M4 precondition failed: % is owned by a constraint; the M3 contract is a bare index',
        spec.idx_name;
    END IF;

    SELECT array_agg(a.attname ORDER BY k.ord)
      INTO cols
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indexrelid = idx_oid;

    IF cols IS DISTINCT FROM expect_cols THEN
      RAISE EXCEPTION 'M4 precondition failed: % has key columns %, expected (user_id, client_attempt_id)',
        spec.idx_name, cols;
    END IF;

    -- Per key position: default sort behaviour, collation and opclass. indkey,
    -- indoption, indcollation and indclass are 0-based vectors.
    FOR keypos IN
      SELECT k.ord, a.attname, a.atttypid, a.attcollation,
             i.indoption[k.ord - 1]    AS opt,
             i.indcollation[k.ord - 1] AS coll,
             i.indclass[k.ord - 1]     AS opc
        FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE i.indexrelid = idx_oid
       ORDER BY k.ord
    LOOP
      -- 0 = ASC, NULLS LAST: the btree default for both columns.
      IF keypos.opt <> 0 THEN
        RAISE EXCEPTION 'M4 precondition failed: % key % (%) has non-default sort options (indoption=%), expected ASC NULLS LAST',
          spec.idx_name, keypos.ord, keypos.attname, keypos.opt;
      END IF;

      IF keypos.coll <> keypos.attcollation THEN
        RAISE EXCEPTION 'M4 precondition failed: % key % (%) uses collation oid %, expected the column collation %',
          spec.idx_name, keypos.ord, keypos.attname, keypos.coll, keypos.attcollation;
      END IF;

      IF NOT EXISTS (
        SELECT 1
          FROM pg_opclass oc
          JOIN pg_am am ON am.oid = oc.opcmethod
         WHERE oc.oid       = keypos.opc
           AND oc.opcdefault
           AND am.amname    = 'btree'
           AND oc.opcintype = keypos.atttypid
      ) THEN
        RAISE EXCEPTION 'M4 precondition failed: % key % (%) does not use the default btree opclass for its column type',
          spec.idx_name, keypos.ord, keypos.attname;
      END IF;
    END LOOP;

    IF idx.pred IS DISTINCT FROM expected_pred THEN
      RAISE EXCEPTION 'M4 precondition failed: % predicate is %, expected %',
        spec.idx_name, coalesce(idx.pred, '<not partial>'), expected_pred;
    END IF;
  END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 4. THE FUNCTION. Created only when absent. A same-named function with any
--    other signature, or the same signature with a different body, aborts.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  -- pg_get_function_identity_arguments includes parameter names, so the
  -- expected value names them too; a renamed parameter is a contract change.
  expect_ident CONSTANT text :=
    'p_user_id uuid, p_client_attempt_id uuid, p_workout_coach_id text, '
    || 'p_workout_plan_type text, p_workout_week_start date, '
    || 'p_workout_week_number integer, p_workout_activate_on date, '
    || 'p_workout_plan_data jsonb, p_nutrition_plan_data jsonb';
  fn_oid   oid;
  n_same   integer;
  v_body   CONSTANT text := $fnbody$
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
$fnbody$;
BEGIN
  SELECT count(*) INTO n_same
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'replace_user_plans_atomic';

  fn_oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)');

  IF n_same > 0 AND fn_oid IS NULL THEN
    RAISE EXCEPTION 'M4 failed: % function(s) named public.replace_user_plans_atomic exist with a different signature; refusing to replace', n_same;
  END IF;

  IF n_same > 1 THEN
    RAISE EXCEPTION 'M4 failed: public.replace_user_plans_atomic is overloaded (% overloads); the contract is a single function', n_same;
  END IF;

  IF fn_oid IS NULL THEN
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
      || 'AS ' || quote_literal(v_body);

    fn_oid := to_regprocedure(
      'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)');
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'M4 failed: the function was not created';
    END IF;
  END IF;

  -- Held to the contract whether just created or pre-existing. A body that
  -- differs by one character aborts rather than being replaced.
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = fn_oid) IS DISTINCT FROM v_body THEN
    RAISE EXCEPTION 'M4 failed: an existing public.replace_user_plans_atomic has a different body; refusing to replace it';
  END IF;

  IF pg_get_function_identity_arguments(fn_oid) IS DISTINCT FROM expect_ident THEN
    RAISE EXCEPTION 'M4 failed: identity arguments are %, expected %',
      pg_get_function_identity_arguments(fn_oid), expect_ident;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 5. OWNERSHIP AND EXECUTE PRIVILEGES. Idempotent; safe to re-run.
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
-- 6. ASSERTIONS. Signature, return shape, definer, search_path, owner,
--    privileges, and the definer's own read on auth.users.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  fn_oid oid := to_regprocedure(
    'public.replace_user_plans_atomic(uuid, uuid, text, text, date, integer, date, jsonb, jsonb)');
  fn        record;
  n_public  integer;
  n_grantee integer;
  expect_result CONSTANT text :=
    'TABLE(workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean)';
BEGIN
  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'M4 assertion failed: the function is absent';
  END IF;

  SELECT p.pronamespace, p.prokind, p.prosecdef, p.provolatile, p.proretset,
         p.pronargs, p.pronargdefaults, p.proowner, p.proconfig, l.lanname
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = fn_oid;

  IF fn.pronamespace <> 'public'::regnamespace THEN
    RAISE EXCEPTION 'M4 assertion failed: the function is not in schema public';
  END IF;

  IF fn.prokind <> 'f' OR fn.lanname <> 'plpgsql' THEN
    RAISE EXCEPTION 'M4 assertion failed: prokind=% lanname=%, expected a plpgsql function',
      fn.prokind, fn.lanname;
  END IF;

  IF fn.pronargs <> 9 OR fn.pronargdefaults <> 1 THEN
    RAISE EXCEPTION 'M4 assertion failed: % arguments with % default(s), expected 9 and 1',
      fn.pronargs, fn.pronargdefaults;
  END IF;

  IF pg_get_function_result(fn_oid) IS DISTINCT FROM expect_result THEN
    RAISE EXCEPTION 'M4 assertion failed: result is %, expected %',
      pg_get_function_result(fn_oid), expect_result;
  END IF;

  IF NOT fn.proretset THEN
    RAISE EXCEPTION 'M4 assertion failed: the function is not set-returning';
  END IF;

  IF NOT fn.prosecdef THEN
    RAISE EXCEPTION 'M4 assertion failed: the function is not SECURITY DEFINER';
  END IF;

  IF fn.provolatile <> 'v' THEN
    RAISE EXCEPTION 'M4 assertion failed: volatility is %, expected VOLATILE', fn.provolatile;
  END IF;

  IF fn.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'M4 assertion failed: proconfig is %, expected {"search_path=public, pg_temp"}',
      fn.proconfig;
  END IF;

  -- Assertion A — ownership, read back from the catalog by OID.
  IF fn.proowner <> 'postgres'::regrole THEN
    RAISE EXCEPTION 'M4 assertion failed: owner is %, expected postgres', fn.proowner::regrole;
  END IF;

  -- Assertion B — definer capability. Independent of A: A catches a misapplied
  -- OWNER TO, B catches a future revocation of the definer's read on auth.users,
  -- which would leave ownership correct and the lock broken.
  IF NOT has_table_privilege(fn.proowner::regrole::text, 'auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'M4 assertion failed: the definer (%) cannot SELECT auth.users; the per-user lock would fail at runtime',
      fn.proowner::regrole;
  END IF;

  -- PUBLIC must hold nothing at all.
  SELECT count(*) INTO n_public
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = fn_oid AND a.grantee = 0;
  IF n_public <> 0 THEN
    RAISE EXCEPTION 'M4 assertion failed: PUBLIC still holds % privilege(s) on the function', n_public;
  END IF;

  IF has_function_privilege('anon', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M4 assertion failed: anon can execute the function';
  END IF;

  IF has_function_privilege('authenticated', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M4 assertion failed: authenticated can execute the function';
  END IF;

  IF NOT has_function_privilege('service_role', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M4 assertion failed: service_role cannot execute the function';
  END IF;

  -- service_role is the only grantee besides the owner.
  SELECT count(*) INTO n_grantee
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = fn_oid
     AND a.grantee NOT IN (fn.proowner, 'service_role'::regrole::oid);
  IF n_grantee <> 0 THEN
    RAISE EXCEPTION 'M4 assertion failed: % unexpected grantee(s) on the function', n_grantee;
  END IF;
END
$mig$;

COMMIT;
