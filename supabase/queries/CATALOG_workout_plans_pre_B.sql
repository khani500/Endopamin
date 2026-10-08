-- Read-only, catalog only, no user data; safe to run in production.
-- Global and public-schema table defaults are both included.
WITH targets AS (
  SELECT c.* FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('workout_plans', 'nutrition_plans')
), named_roles AS (
  SELECT * FROM pg_roles
  WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres')
)
SELECT '01_table'::text AS section, 'public.' || c.relname AS object,
  format('owner=%s; relrowsecurity=%s; relforcerowsecurity=%s',
    r.rolname, c.relrowsecurity, c.relforcerowsecurity) AS detail
FROM targets c JOIN pg_roles r ON r.oid = c.relowner
UNION ALL
SELECT '02_table_acl', 'public.' || c.relname,
  format('grantee=%s; privilege=%s; grantable=%s; source=%s',
    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END,
    a.privilege_type, a.is_grantable,
    CASE WHEN c.relacl IS NULL THEN 'implicit default' ELSE 'relacl' END)
FROM targets c
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
LEFT JOIN pg_roles r ON r.oid = a.grantee
UNION ALL
SELECT '03_column_acl', 'public.' || c.relname || '.' || col.attname,
  format('grantee=%s; privilege=%s; grantable=%s',
    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END,
    a.privilege_type, a.is_grantable)
FROM targets c JOIN pg_attribute col ON col.attrelid = c.oid
CROSS JOIN LATERAL aclexplode(col.attacl) a
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE col.attnum > 0 AND NOT col.attisdropped
UNION ALL
SELECT '04_policy', 'public.' || c.relname || '.' || p.polname,
  format('cmd=%s; permissive=%s; roles=%s; USING=%s; WITH CHECK=%s',
    CASE p.polcmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE p.polcmd::text END,
    p.polpermissive,
    (SELECT string_agg(CASE WHEN role_id = 0 THEN 'PUBLIC' ELSE r.rolname END, ', ' ORDER BY role_id)
     FROM unnest(p.polroles) AS role_ids(role_id) LEFT JOIN pg_roles r ON r.oid = role_id),
    COALESCE(pg_get_expr(p.polqual, p.polrelid), '<none>'),
    COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '<none>'))
FROM targets c JOIN pg_policy p ON p.polrelid = c.oid
UNION ALL
SELECT '05_trigger', 'public.' || c.relname || '.' || t.tgname,
  format('enabled=%s; definition=%s', t.tgenabled, pg_get_triggerdef(t.oid, true))
FROM targets c JOIN pg_trigger t ON t.tgrelid = c.oid
WHERE NOT t.tgisinternal
UNION ALL
SELECT '06_default_acl', r.rolname || '.' ||
    CASE WHEN d.defaclnamespace = 0 THEN '<global>' ELSE 'public' END || '.tables',
  format('grantee=%s; privilege=%s; grantable=%s',
    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
    a.privilege_type, a.is_grantable)
FROM pg_default_acl d JOIN pg_roles r ON r.oid = d.defaclrole
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
WHERE d.defaclobjtype = 'r' AND d.defaclnamespace IN (0, 'public'::regnamespace)
UNION ALL
SELECT '07_role', r.rolname,
  format('rolsuper=%s; rolinherit=%s; rolbypassrls=%s; rolcanlogin=%s',
    r.rolsuper, r.rolinherit, r.rolbypassrls, r.rolcanlogin)
FROM named_roles r
UNION ALL
SELECT '08_membership', member.rolname || ' -> ' || role.rolname,
  format('grantor=%s; catalog_row=%s', grantor.rolname, to_jsonb(m)::text)
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles role ON role.oid = m.roleid
LEFT JOIN pg_roles grantor ON grantor.oid = m.grantor
WHERE m.member IN (SELECT oid FROM named_roles) OR m.roleid IN (SELECT oid FROM named_roles)
UNION ALL
SELECT '09_function', 'public.get_active_plan_safety_status()',
  format('prosecdef=%s; owner=%s', p.prosecdef, r.rolname)
FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
WHERE p.oid = to_regprocedure('public.get_active_plan_safety_status()')
ORDER BY section, object;
