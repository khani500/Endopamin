-- Reconcile public.workout_plans into migration history.
--
-- This table exists in the current production database. It was created outside
-- this directory, so a database built from these migrations alone would not have
-- it. This file closes that gap for new environments. It makes no claim about
-- what has or has not been run anywhere.
--
-- Every column type, ordinal position, nullability and default below was read
-- back from the catalog against production rather than reconstructed from
-- application code.
--
-- ATOMIC. The whole file runs inside one explicit transaction. COMMIT is reached
-- only after every assertion has passed. Any exception raised anywhere below
-- rolls back everything this file did in the same run -- on the fresh path that
-- means the table, the RLS setting and both policies are all undone together, so
-- a partially configured table can never be left behind.
--
-- TWO PATHS, chosen by to_regclass before anything is touched:
--
--   Table ABSENT  -> create it, enable RLS, create both policies, then assert.
--   Table PRESENT -> assert FIRST, mutate NOTHING. An existing table whose
--                    contract disagrees fails with a named error before any
--                    statement has changed the database.
--
--   The ordering is the point. CREATE TABLE IF NOT EXISTS on a table that merely
--   shares a name passes silently, and a later ENABLE RLS or CREATE POLICY would
--   then be a real mutation applied to an object this file never verified.
--
-- PREREQUISITE: auth.users must exist before this file runs.
--   Supabase local provides that relation before project migrations are applied.
--   Empirical evidence: migration 20260516200500, which declares a foreign key to
--   auth.users, executed successfully during the M0 local run. A general
--   PostgreSQL instance without Supabase is OUT OF TARGET for this migration; on
--   such an instance CREATE TABLE fails on the foreign key before any assertion
--   is reached, and that failure is correct rather than a defect of this file.
--
-- DELIBERATELY OUT OF SCOPE:
--
--   workout_sessions and its incoming foreign key
--     workout_sessions.workout_sessions_plan_id_fkey REFERENCES workout_plans(id)
--     exists in production with NO ACTION. That table has no CREATE TABLE in this
--     directory either -- it is OI-B and stays there. THIS FILE DOES NOT ACHIEVE
--     FULL SCHEMA PARITY ON ITS OWN: a fresh database will have workout_plans but
--     not the relationship that points at it.
--
--   user_id stays nullable. Production has it nullable. Whether it should become
--   NOT NULL is an open decision, and a reconciliation file records a contract
--   rather than changing one.
--
--   Table privileges are neither asserted nor altered. Production grants are a
--   separate finding recorded in OPEN_ITEMS; any revoke belongs to the lockdown
--   phase, behind the same adoption gate as the RLS change.
--
--   client_attempt_id, owner hardening and the RLS lockdown are later phases.
--
--   No secondary index. Production has exactly one index, the primary key.
--
-- PARITY IS CLAIMED ONLY OVER WHAT IS ASSERTED BELOW: relkind, persistence,
-- owner, the ten columns with their defaults, the constraint set, the primary
-- key, the owner foreign key, the index set, the RLS flags, the policy set, and
-- the absence of non-system triggers. Database comments, grants, statistics
-- targets, storage parameters and anything else are outside the contract and no
-- claim is made about them.
--
-- No data write, no backfill, no trigger, no UPDATE, no DELETE, no GRANT, no
-- REVOKE.

BEGIN;

-- ===========================================================================
-- PATH SELECTION AND, WHEN THE TABLE IS ABSENT, CREATION
-- ===========================================================================

DO $$
BEGIN
  IF to_regclass('public.workout_plans') IS NULL THEN
    RAISE NOTICE 'workout_plans is absent: creating table, RLS and policies';

    CREATE TABLE public.workout_plans (
      id            uuid        NOT NULL DEFAULT gen_random_uuid(),
      user_id       uuid        NULL,
      coach_id      text        NOT NULL,
      plan_type     text        NULL DEFAULT 'weekly'::text,
      generated_at  timestamptz NULL DEFAULT now(),
      week_start    date        NULL,
      plan_data     jsonb       NOT NULL,
      is_active     boolean     NULL DEFAULT true,
      week_number   integer     NULL DEFAULT 1,
      activate_on   date        NULL,
      CONSTRAINT workout_plans_pkey PRIMARY KEY (id),
      CONSTRAINT workout_plans_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
    );

    ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users see own plans"
      ON public.workout_plans
      AS PERMISSIVE
      FOR ALL
      TO public
      USING (auth.uid() = user_id);

    CREATE POLICY "Users can read own workout plans"
      ON public.workout_plans
      AS PERMISSIVE
      FOR SELECT
      TO public
      USING (auth.uid() = user_id);

  ELSE
    RAISE NOTICE 'workout_plans is present: verifying contract, mutating nothing';
  END IF;
END
$$;

-- ===========================================================================
-- CONTRACT ASSERTIONS
-- ===========================================================================
-- These run on both paths. On the present path they are the only thing this
-- file does. They are executable statements -- they read the catalog and can
-- raise -- but they change no schema and write no row. Any raise aborts the
-- transaction opened above, so nothing this file created survives a failure.

DO $$
DECLARE
  v_expected_cols text :=
       'id|uuid|NOT NULL|gen_random_uuid()|-|-'
    || '#user_id|uuid|nullable|-|-|-'
    || '#coach_id|text|NOT NULL|-|-|-'
    || '#plan_type|text|nullable|''weekly''::text|-|-'
    || '#generated_at|timestamp with time zone|nullable|now()|-|-'
    || '#week_start|date|nullable|-|-|-'
    || '#plan_data|jsonb|NOT NULL|-|-|-'
    || '#is_active|boolean|nullable|true|-|-'
    || '#week_number|integer|nullable|1|-|-'
    || '#activate_on|date|nullable|-|-|-';
  v_expected_cons text := 'workout_plans_pkey,workout_plans_user_id_fkey';
  v_actual_cols text;
  v_actual_cons text;
  v_n    integer;
  v_txt  text;
BEGIN
  -- A1. the relation is an ordinary, permanent table owned by postgres
  SELECT c.relkind::text || '|' || c.relpersistence::text || '|'
         || pg_get_userbyid(c.relowner)
    INTO v_txt
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'workout_plans';

  IF v_txt IS NULL THEN
    RAISE EXCEPTION 'A1 FAIL: public.workout_plans does not exist after this migration';
  END IF;
  IF v_txt <> 'r|p|postgres' THEN
    RAISE EXCEPTION
      'A1 FAIL: expected relkind r, persistence p, owner postgres. actual [%]', v_txt;
  END IF;

  -- A2. exactly ten columns, in order, with type, nullability, default, and no
  --     identity or generated expression
  SELECT string_agg(
           a.attname
           || '|' || format_type(a.atttypid, a.atttypmod)
           || '|' || CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'nullable' END
           || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || '|' || CASE WHEN a.attidentity = '' THEN '-' ELSE a.attidentity::text END
           || '|' || CASE WHEN a.attgenerated = '' THEN '-' ELSE a.attgenerated::text END,
           '#' ORDER BY a.attnum)
    INTO v_actual_cols
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.workout_plans'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_actual_cols IS DISTINCT FROM v_expected_cols THEN
    RAISE EXCEPTION
      'A2 FAIL: column contract mismatch. expected [%] actual [%]',
      v_expected_cols, v_actual_cols;
  END IF;

  -- A3. the OUTGOING constraint SET is exactly these two, by count and by name.
  --     Checked before the per-constraint assertions below, so an extra
  --     constraint or a renamed one is caught here rather than passing silently
  --     because the two expected names happen to also be present.
  SELECT count(*) INTO v_n
  FROM pg_constraint WHERE conrelid = 'public.workout_plans'::regclass;
  IF v_n <> 2 THEN
    SELECT string_agg(conname || '(' || contype::text || ')', ', ' ORDER BY conname)
      INTO v_txt
    FROM pg_constraint WHERE conrelid = 'public.workout_plans'::regclass;
    RAISE EXCEPTION
      'A3 FAIL: expected exactly 2 outgoing constraints, found %. actual set [%]',
      v_n, coalesce(v_txt, 'none');
  END IF;

  SELECT string_agg(conname, ',' ORDER BY conname) INTO v_actual_cons
  FROM pg_constraint WHERE conrelid = 'public.workout_plans'::regclass;
  IF v_actual_cons IS DISTINCT FROM v_expected_cons THEN
    RAISE EXCEPTION
      'A3 FAIL: constraint name set mismatch. expected [%] actual [%]',
      v_expected_cons, coalesce(v_actual_cons, 'none');
  END IF;

  -- A4. exactly one primary key, validated, on id
  SELECT count(*) INTO v_n
  FROM pg_constraint
  WHERE conrelid = 'public.workout_plans'::regclass AND contype = 'p';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A4 FAIL: expected exactly 1 primary key, found %', v_n;
  END IF;

  SELECT conname || '|' || convalidated::text || '|' || pg_get_constraintdef(oid)
    INTO v_txt
  FROM pg_constraint
  WHERE conrelid = 'public.workout_plans'::regclass AND contype = 'p';
  IF v_txt <> 'workout_plans_pkey|true|PRIMARY KEY (id)' THEN
    RAISE EXCEPTION 'A4 FAIL: primary key contract mismatch. actual [%]', v_txt;
  END IF;

  -- A5. exactly one outgoing foreign key, validated, to auth.users with CASCADE
  SELECT count(*) INTO v_n
  FROM pg_constraint
  WHERE conrelid = 'public.workout_plans'::regclass AND contype = 'f';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A5 FAIL: expected exactly 1 outgoing foreign key, found %', v_n;
  END IF;

  SELECT conname || '|' || convalidated::text || '|' || pg_get_constraintdef(oid)
    INTO v_txt
  FROM pg_constraint
  WHERE conrelid = 'public.workout_plans'::regclass AND contype = 'f';
  IF v_txt <> 'workout_plans_user_id_fkey|true|'
              || 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE' THEN
    RAISE EXCEPTION 'A5 FAIL: owner foreign key contract mismatch. actual [%]', v_txt;
  END IF;

  -- A6. exactly one index, and it is the primary key index
  SELECT count(*) INTO v_n
  FROM pg_index WHERE indrelid = 'public.workout_plans'::regclass;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A6 FAIL: expected exactly 1 index, found %', v_n;
  END IF;

  SELECT c.relname || '|' || i.indisunique::text || '|' || i.indisprimary::text
         || '|' || i.indisvalid::text
    INTO v_txt
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'public.workout_plans'::regclass;
  IF v_txt <> 'workout_plans_pkey|true|true|true' THEN
    RAISE EXCEPTION 'A6 FAIL: index contract mismatch. actual [%]', v_txt;
  END IF;

  -- A7. RLS enabled, FORCE RLS off
  SELECT relrowsecurity::text || '|' || relforcerowsecurity::text INTO v_txt
  FROM pg_class WHERE oid = 'public.workout_plans'::regclass;
  IF v_txt <> 'true|false' THEN
    RAISE EXCEPTION
      'A7 FAIL: expected rls enabled and not forced. actual [enabled|forced = %]', v_txt;
  END IF;

  -- A8. exactly two policies, and no others
  SELECT count(*) INTO v_n
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_plans';
  IF v_n <> 2 THEN
    SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_txt
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_plans';
    RAISE EXCEPTION
      'A8 FAIL: expected exactly 2 policies, found %. actual set [%]',
      v_n, coalesce(v_txt, 'none');
  END IF;

  -- A9. the FOR ALL policy, exact shape including roles and WITH CHECK
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'workout_plans'
    AND policyname = 'Users see own plans'
    AND permissive = 'PERMISSIVE'
    AND roles::text = '{public}'
    AND cmd = 'ALL'
    AND qual = '(auth.uid() = user_id)'
    AND with_check IS NULL;
  IF v_n <> 1 THEN
    SELECT 'permissive=' || permissive || ' roles=' || roles::text
           || ' cmd=' || cmd || ' using=' || coalesce(qual, 'NULL')
           || ' check=' || coalesce(with_check, 'NULL')
      INTO v_txt
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workout_plans'
      AND policyname = 'Users see own plans';
    RAISE EXCEPTION
      'A9 FAIL: policy "Users see own plans" missing or altered. actual [%]',
      coalesce(v_txt, 'policy not present');
  END IF;

  -- A10. the FOR SELECT policy, exact shape including roles and WITH CHECK
  SELECT count(*) INTO v_n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'workout_plans'
    AND policyname = 'Users can read own workout plans'
    AND permissive = 'PERMISSIVE'
    AND roles::text = '{public}'
    AND cmd = 'SELECT'
    AND qual = '(auth.uid() = user_id)'
    AND with_check IS NULL;
  IF v_n <> 1 THEN
    SELECT 'permissive=' || permissive || ' roles=' || roles::text
           || ' cmd=' || cmd || ' using=' || coalesce(qual, 'NULL')
           || ' check=' || coalesce(with_check, 'NULL')
      INTO v_txt
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workout_plans'
      AND policyname = 'Users can read own workout plans';
    RAISE EXCEPTION
      'A10 FAIL: policy "Users can read own workout plans" missing or altered. actual [%]',
      coalesce(v_txt, 'policy not present');
  END IF;

  -- A11. zero non-system triggers
  SELECT count(*) INTO v_n
  FROM pg_trigger
  WHERE tgrelid = 'public.workout_plans'::regclass AND NOT tgisinternal;
  IF v_n <> 0 THEN
    SELECT string_agg(tgname, ', ' ORDER BY tgname) INTO v_txt
    FROM pg_trigger
    WHERE tgrelid = 'public.workout_plans'::regclass AND NOT tgisinternal;
    RAISE EXCEPTION
      'A11 FAIL: expected 0 non-system triggers, found %. actual set [%]', v_n, v_txt;
  END IF;

  RAISE NOTICE 'workout_plans contract verified: A1 to A11 all pass';
END
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- This migration has NO automated rollback.
--
-- Within a single run it is self-unwinding: the explicit transaction above means
-- any failed assertion discards everything the same run created. That is not the
-- same as reversing a run that already committed.
--
-- On an environment that holds real plans, removing the table would destroy user
-- data and break the incoming foreign key from workout_sessions. No reversal
-- statement is offered here, deliberately: the safety of this file comes from
-- asserting before it mutates and from committing only after every assertion
-- passes, not from being reversible.
