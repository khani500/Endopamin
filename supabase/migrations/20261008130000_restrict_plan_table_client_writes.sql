-- Migration B: restrict client plan-table privileges; partial nutrition hardening.
-- Manual execution only. No data changes; service_role and postgres remain unchanged.
-- For a dry run, replace the final COMMIT with ROLLBACK.

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.workout_plans, public.nutrition_plans IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
  t record;
  actual jsonb;
  expected jsonb;
  expected_policies text[];
BEGIN
  FOR t IN SELECT * FROM (VALUES ('workout_plans'), ('nutrition_plans')) v(name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || t.name)
        AND c.relkind = 'r' AND c.relowner = 'postgres'::regrole
        AND c.relrowsecurity AND NOT c.relforcerowsecurity
    ) OR EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || t.name) AND NOT tgisinternal
    ) OR EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t.name) AND attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration B precondition failed: owner/RLS/triggers/column ACLs for %', t.name;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_array(a.grantee, a.privilege_type, a.is_grantable)
                            ORDER BY a.grantee, a.privilege_type), '[]'::jsonb)
      INTO actual FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid = to_regclass('public.' || t.name);
    SELECT jsonb_agg(jsonb_build_array(r.oid, v.privilege, v.grantable)
                     ORDER BY r.oid, v.privilege)
      INTO expected FROM (VALUES
        ('workout_plans', 'anon', 'DELETE', false),
        ('workout_plans', 'anon', 'INSERT', false),
        ('workout_plans', 'anon', 'MAINTAIN', false),
        ('workout_plans', 'anon', 'REFERENCES', false),
        ('workout_plans', 'anon', 'SELECT', false),
        ('workout_plans', 'anon', 'TRIGGER', false),
        ('workout_plans', 'anon', 'TRUNCATE', false),
        ('workout_plans', 'anon', 'UPDATE', false),
        ('workout_plans', 'authenticated', 'DELETE', false),
        ('workout_plans', 'authenticated', 'INSERT', false),
        ('workout_plans', 'authenticated', 'MAINTAIN', false),
        ('workout_plans', 'authenticated', 'REFERENCES', false),
        ('workout_plans', 'authenticated', 'SELECT', false),
        ('workout_plans', 'authenticated', 'TRIGGER', false),
        ('workout_plans', 'authenticated', 'TRUNCATE', false),
        ('workout_plans', 'authenticated', 'UPDATE', false),
        ('workout_plans', 'service_role', 'DELETE', false),
        ('workout_plans', 'service_role', 'INSERT', false),
        ('workout_plans', 'service_role', 'MAINTAIN', false),
        ('workout_plans', 'service_role', 'REFERENCES', false),
        ('workout_plans', 'service_role', 'SELECT', false),
        ('workout_plans', 'service_role', 'TRIGGER', false),
        ('workout_plans', 'service_role', 'TRUNCATE', false),
        ('workout_plans', 'service_role', 'UPDATE', false),
        ('workout_plans', 'postgres', 'DELETE', false),
        ('workout_plans', 'postgres', 'INSERT', false),
        ('workout_plans', 'postgres', 'MAINTAIN', false),
        ('workout_plans', 'postgres', 'REFERENCES', false),
        ('workout_plans', 'postgres', 'SELECT', false),
        ('workout_plans', 'postgres', 'TRIGGER', false),
        ('workout_plans', 'postgres', 'TRUNCATE', false),
        ('workout_plans', 'postgres', 'UPDATE', false),
        ('nutrition_plans', 'anon', 'DELETE', false),
        ('nutrition_plans', 'anon', 'INSERT', false),
        ('nutrition_plans', 'anon', 'MAINTAIN', false),
        ('nutrition_plans', 'anon', 'REFERENCES', false),
        ('nutrition_plans', 'anon', 'SELECT', false),
        ('nutrition_plans', 'anon', 'TRIGGER', false),
        ('nutrition_plans', 'anon', 'TRUNCATE', false),
        ('nutrition_plans', 'anon', 'UPDATE', false),
        ('nutrition_plans', 'authenticated', 'DELETE', false),
        ('nutrition_plans', 'authenticated', 'INSERT', false),
        ('nutrition_plans', 'authenticated', 'MAINTAIN', false),
        ('nutrition_plans', 'authenticated', 'REFERENCES', false),
        ('nutrition_plans', 'authenticated', 'SELECT', false),
        ('nutrition_plans', 'authenticated', 'TRIGGER', false),
        ('nutrition_plans', 'authenticated', 'TRUNCATE', false),
        ('nutrition_plans', 'authenticated', 'UPDATE', false),
        ('nutrition_plans', 'service_role', 'DELETE', false),
        ('nutrition_plans', 'service_role', 'INSERT', false),
        ('nutrition_plans', 'service_role', 'MAINTAIN', false),
        ('nutrition_plans', 'service_role', 'REFERENCES', false),
        ('nutrition_plans', 'service_role', 'SELECT', false),
        ('nutrition_plans', 'service_role', 'TRIGGER', false),
        ('nutrition_plans', 'service_role', 'TRUNCATE', false),
        ('nutrition_plans', 'service_role', 'UPDATE', false),
        ('nutrition_plans', 'postgres', 'DELETE', false),
        ('nutrition_plans', 'postgres', 'INSERT', false),
        ('nutrition_plans', 'postgres', 'MAINTAIN', false),
        ('nutrition_plans', 'postgres', 'REFERENCES', false),
        ('nutrition_plans', 'postgres', 'SELECT', false),
        ('nutrition_plans', 'postgres', 'TRIGGER', false),
        ('nutrition_plans', 'postgres', 'TRUNCATE', false),
        ('nutrition_plans', 'postgres', 'UPDATE', false)
      ) v(tbl, role_name, privilege, grantable)
      JOIN pg_roles r ON r.rolname = v.role_name WHERE v.tbl = t.name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'migration B precondition failed: exact ACL for %', t.name;
    END IF;
    expected_policies := CASE WHEN t.name = 'workout_plans'
      THEN ARRAY['Users can read own workout plans:r', 'Users see own plans:*']
      ELSE ARRAY['Users can read own nutrition plans:r', 'Users manage own nutrition plans:*'] END;
    IF (SELECT array_agg(polname::text || ':' || polcmd::text ORDER BY polname)
        FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name))
          IS DISTINCT FROM expected_policies
       OR EXISTS (
         SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name)
           AND (NOT polpermissive OR polroles IS DISTINCT FROM ARRAY[0::oid]
                OR pg_get_expr(polqual, polrelid) IS DISTINCT FROM '(auth.uid() = user_id)'
                OR polwithcheck IS NOT NULL)
       ) THEN
      RAISE EXCEPTION 'migration B precondition failed: exact policies for %', t.name;
    END IF;
  END LOOP;
  RAISE NOTICE 'migration B precondition PASS: exact ACLs, policies, owners, RLS and empty column ACLs';
END
$guard$;

REVOKE ALL PRIVILEGES ON TABLE public.workout_plans FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.workout_plans FROM authenticated;
DROP POLICY "Users see own plans" ON public.workout_plans;
REVOKE ALL PRIVILEGES ON TABLE public.nutrition_plans FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.nutrition_plans FROM authenticated;

DO $guard$
DECLARE
  t record;
  actual jsonb;
  expected jsonb;
  expected_policies text[];
BEGIN
  FOR t IN SELECT * FROM (VALUES ('workout_plans'), ('nutrition_plans')) v(name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.' || t.name)
        AND c.relkind = 'r' AND c.relowner = 'postgres'::regrole
        AND c.relrowsecurity AND NOT c.relforcerowsecurity
    ) OR EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || t.name) AND NOT tgisinternal
    ) OR EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t.name) AND attacl IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration B postcondition failed: owner/RLS/triggers/column ACLs for %', t.name;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_array(a.grantee, a.privilege_type, a.is_grantable)
                            ORDER BY a.grantee, a.privilege_type), '[]'::jsonb)
      INTO actual FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid = to_regclass('public.' || t.name);
    SELECT jsonb_agg(jsonb_build_array(r.oid, v.privilege, v.grantable)
                     ORDER BY r.oid, v.privilege)
      INTO expected FROM (VALUES
        ('workout_plans', 'authenticated', 'SELECT', false),
        ('workout_plans', 'service_role', 'DELETE', false),
        ('workout_plans', 'service_role', 'INSERT', false),
        ('workout_plans', 'service_role', 'MAINTAIN', false),
        ('workout_plans', 'service_role', 'REFERENCES', false),
        ('workout_plans', 'service_role', 'SELECT', false),
        ('workout_plans', 'service_role', 'TRIGGER', false),
        ('workout_plans', 'service_role', 'TRUNCATE', false),
        ('workout_plans', 'service_role', 'UPDATE', false),
        ('workout_plans', 'postgres', 'DELETE', false),
        ('workout_plans', 'postgres', 'INSERT', false),
        ('workout_plans', 'postgres', 'MAINTAIN', false),
        ('workout_plans', 'postgres', 'REFERENCES', false),
        ('workout_plans', 'postgres', 'SELECT', false),
        ('workout_plans', 'postgres', 'TRIGGER', false),
        ('workout_plans', 'postgres', 'TRUNCATE', false),
        ('workout_plans', 'postgres', 'UPDATE', false),
        ('nutrition_plans', 'authenticated', 'DELETE', false),
        ('nutrition_plans', 'authenticated', 'INSERT', false),
        ('nutrition_plans', 'authenticated', 'SELECT', false),
        ('nutrition_plans', 'authenticated', 'UPDATE', false),
        ('nutrition_plans', 'service_role', 'DELETE', false),
        ('nutrition_plans', 'service_role', 'INSERT', false),
        ('nutrition_plans', 'service_role', 'MAINTAIN', false),
        ('nutrition_plans', 'service_role', 'REFERENCES', false),
        ('nutrition_plans', 'service_role', 'SELECT', false),
        ('nutrition_plans', 'service_role', 'TRIGGER', false),
        ('nutrition_plans', 'service_role', 'TRUNCATE', false),
        ('nutrition_plans', 'service_role', 'UPDATE', false),
        ('nutrition_plans', 'postgres', 'DELETE', false),
        ('nutrition_plans', 'postgres', 'INSERT', false),
        ('nutrition_plans', 'postgres', 'MAINTAIN', false),
        ('nutrition_plans', 'postgres', 'REFERENCES', false),
        ('nutrition_plans', 'postgres', 'SELECT', false),
        ('nutrition_plans', 'postgres', 'TRIGGER', false),
        ('nutrition_plans', 'postgres', 'TRUNCATE', false),
        ('nutrition_plans', 'postgres', 'UPDATE', false)
      ) v(tbl, role_name, privilege, grantable)
      JOIN pg_roles r ON r.rolname = v.role_name WHERE v.tbl = t.name;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'migration B postcondition failed: exact ACL for %', t.name;
    END IF;
    expected_policies := CASE WHEN t.name = 'workout_plans'
      THEN ARRAY['Users can read own workout plans:r']
      ELSE ARRAY['Users can read own nutrition plans:r', 'Users manage own nutrition plans:*'] END;
    IF (SELECT array_agg(polname::text || ':' || polcmd::text ORDER BY polname)
        FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name))
          IS DISTINCT FROM expected_policies
       OR EXISTS (
         SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.' || t.name)
           AND (NOT polpermissive OR polroles IS DISTINCT FROM ARRAY[0::oid]
                OR pg_get_expr(polqual, polrelid) IS DISTINCT FROM '(auth.uid() = user_id)'
                OR polwithcheck IS NOT NULL)
       ) THEN
      RAISE EXCEPTION 'migration B postcondition failed: exact policies for %', t.name;
    END IF;
  END LOOP;
  RAISE NOTICE 'migration B postcondition PASS: exact ACLs, policies, owners, RLS and empty column ACLs';
END
$guard$;

COMMIT;
