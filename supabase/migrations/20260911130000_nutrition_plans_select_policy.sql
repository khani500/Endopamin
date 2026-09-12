-- 20260911130000_nutrition_plans_select_policy.sql
-- M2.
--
-- Gives public.nutrition_plans its own independent SELECT policy, so that when
-- M5 drops the ALL policy the table still has a read path. Mirrors the
-- arrangement workout_plans already has.
--
-- Does NOT drop, alter or replace the existing ALL policy. No GRANT, no
-- REVOKE, no ALTER TABLE, no RLS enable/disable, no data write. A healthy
-- re-run is a no-op. Any present state that does not match the recorded
-- contract aborts the whole transaction.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rel_oid oid := to_regclass('public.nutrition_plans');
  rel     record;
BEGIN
  IF rel_oid IS NULL THEN
    RAISE EXCEPTION 'M2 precondition failed: public.nutrition_plans does not exist';
  END IF;

  SELECT c.relkind, c.relnamespace, c.relrowsecurity, c.relforcerowsecurity
    INTO rel
    FROM pg_class c
   WHERE c.oid = rel_oid;

  IF rel.relkind <> 'r' THEN
    RAISE EXCEPTION 'M2 precondition failed: nutrition_plans has relkind %, expected an ordinary table',
      rel.relkind;
  END IF;

  IF rel.relnamespace <> 'public'::regnamespace THEN
    RAISE EXCEPTION 'M2 precondition failed: nutrition_plans does not live in schema public';
  END IF;

  -- Verified, never changed: a SELECT policy on a table without RLS enabled
  -- would be inert, and enabling RLS is not in scope for M2.
  IF NOT rel.relrowsecurity THEN
    RAISE EXCEPTION 'M2 precondition failed: row-level security is not enabled on nutrition_plans';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'M2 precondition failed: auth.uid() is not available';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. THE EXISTING ALL POLICY MUST BE EXACTLY AS RECORDED. It is not touched;
--    it is held to its recorded shape so M2 never runs against a table whose
--    access model has already moved.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rel_oid  oid := to_regclass('public.nutrition_plans');
  pol      record;
  n_other  integer;
BEGIN
  SELECT p.oid, p.polcmd, p.polpermissive, p.polroles,
         pg_get_expr(p.polqual, p.polrelid)      AS qual,
         pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
    INTO pol
    FROM pg_policy p
   WHERE p.polrelid = rel_oid
     AND p.polname  = 'Users manage own nutrition plans';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'M2 precondition failed: the recorded ALL policy is absent from nutrition_plans';
  END IF;

  IF pol.polcmd <> '*' THEN
    RAISE EXCEPTION 'M2 precondition failed: the recorded policy has command %, expected ALL', pol.polcmd;
  END IF;

  IF NOT pol.polpermissive THEN
    RAISE EXCEPTION 'M2 precondition failed: the recorded ALL policy is restrictive, expected permissive';
  END IF;

  IF pol.polroles IS DISTINCT FROM '{0}'::oid[] THEN
    RAISE EXCEPTION 'M2 precondition failed: the recorded ALL policy applies to roles %, expected PUBLIC',
      pol.polroles;
  END IF;

  IF pol.qual IS DISTINCT FROM '(auth.uid() = user_id)' THEN
    RAISE EXCEPTION 'M2 precondition failed: the recorded ALL policy USING is %, expected (auth.uid() = user_id)',
      pol.qual;
  END IF;

  IF pol.withcheck IS NOT NULL THEN
    RAISE EXCEPTION 'M2 precondition failed: the recorded ALL policy has a WITH CHECK expression, expected none';
  END IF;

  -- Nothing else may be on this table except the ALL policy and, on a re-run,
  -- the policy this migration creates.
  SELECT count(*) INTO n_other
    FROM pg_policy p
   WHERE p.polrelid = rel_oid
     AND p.polname NOT IN ('Users manage own nutrition plans',
                           'Users can read own nutrition plans');

  IF n_other <> 0 THEN
    RAISE EXCEPTION 'M2 precondition failed: % unexpected policy/policies on nutrition_plans', n_other;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. THE SELECT POLICY. Created only when absent; when present, held to the
--    same contract. Never dropped, never replaced.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rel_oid    oid := to_regclass('public.nutrition_plans');
  all_oid    oid;
  all_oid_2  oid;
  pol        record;
  n_total    integer;
BEGIN
  SELECT p.oid INTO all_oid
    FROM pg_policy p
   WHERE p.polrelid = rel_oid AND p.polname = 'Users manage own nutrition plans';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE p.polrelid = rel_oid AND p.polname = 'Users can read own nutrition plans'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can read own nutrition plans" ON public.nutrition_plans '
            'FOR SELECT TO public USING (auth.uid() = user_id)';
  END IF;

  SELECT p.oid, p.polrelid, p.polcmd, p.polpermissive, p.polroles,
         pg_get_expr(p.polqual, p.polrelid)      AS qual,
         pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
    INTO pol
    FROM pg_policy p
   WHERE p.polrelid = rel_oid
     AND p.polname  = 'Users can read own nutrition plans';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'M2 failed: the SELECT policy is absent after CREATE POLICY';
  END IF;

  IF pol.polrelid <> rel_oid THEN
    RAISE EXCEPTION 'M2 failed: the SELECT policy is attached to relation oid %, expected %',
      pol.polrelid, rel_oid;
  END IF;

  IF pol.polcmd <> 'r' THEN
    RAISE EXCEPTION 'M2 failed: the SELECT policy has command %, expected SELECT', pol.polcmd;
  END IF;

  IF NOT pol.polpermissive THEN
    RAISE EXCEPTION 'M2 failed: the SELECT policy is restrictive, expected permissive';
  END IF;

  IF pol.polroles IS DISTINCT FROM '{0}'::oid[] THEN
    RAISE EXCEPTION 'M2 failed: the SELECT policy applies to roles %, expected PUBLIC', pol.polroles;
  END IF;

  IF pol.qual IS DISTINCT FROM '(auth.uid() = user_id)' THEN
    RAISE EXCEPTION 'M2 failed: the SELECT policy USING is %, expected (auth.uid() = user_id)', pol.qual;
  END IF;

  IF pol.withcheck IS NOT NULL THEN
    RAISE EXCEPTION 'M2 failed: the SELECT policy carries a WITH CHECK expression; SELECT policies take none';
  END IF;

  -- The ALL policy must be the same object it was before, by OID.
  SELECT p.oid INTO all_oid_2
    FROM pg_policy p
   WHERE p.polrelid = rel_oid AND p.polname = 'Users manage own nutrition plans';

  IF all_oid_2 IS DISTINCT FROM all_oid THEN
    RAISE EXCEPTION 'M2 failed: the existing ALL policy was replaced (oid % -> %)', all_oid, all_oid_2;
  END IF;

  SELECT count(*) INTO n_total FROM pg_policy p WHERE p.polrelid = rel_oid;
  IF n_total <> 2 THEN
    RAISE EXCEPTION 'M2 failed: nutrition_plans carries % policies, expected exactly 2', n_total;
  END IF;
END
$$;

COMMIT;
