-- NOT A MIGRATION. Read-only verification for
-- 20261127120000_engine_a_m1_tables.sql (v4).
-- Search-path independent: names are compared by catalog identity. One SELECT, no writes.
-- Run right after the forward file, before any Engine A row is written
-- (it expects the off singleton, one seed event and empty data tables).
-- Expected: exactly one row, section 'result', detail 'PASS'. Any other row
-- names one failed check. The same checks ran inside the forward file.
-- Checks: effective privileges of anon, authenticated and service_role
-- (membership and PUBLIC included) on the 12 tables, 11 functions and their
-- sequences; no PUBLIC grant and no grant option; no column ACL; RLS on;
-- exactly the PR select-own policy (role, command, predicate); 13 enabled
-- triggers; both domains; no FK to workout_plans (that is M2); control off;
-- one seed event; empty data tables; the M1 ledger row.
WITH tabs(t) AS (VALUES ('engine_a_releases'),('engine_a_control'),('engine_a_control_events'),('engine_a_qa_accounts'),('engine_a_delist'),('engine_a_delist_events'),('engine_a_attempts'),('engine_a_decisions'),('engine_a_schedule_revisions'),('engine_a_schedule_offers'),('exercise_personal_records'),('engine_a_migration_events')),
rel AS (SELECT tabs.t, to_regclass('public.' || tabs.t) AS oid FROM tabs),
roles(r) AS (VALUES ('anon'), ('authenticated'), ('service_role')),
privs(p) AS (
  SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
    || CASE WHEN current_setting('server_version_num')::int >= 170000
            THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END)),
want_tab(t, r, p) AS (
  SELECT t, 'service_role', 'SELECT' FROM tabs WHERE t <> 'engine_a_migration_events'
  UNION ALL VALUES
    ('engine_a_attempts', 'service_role', 'INSERT'),
    ('engine_a_attempts', 'service_role', 'UPDATE'),
    ('engine_a_decisions', 'service_role', 'INSERT'),
    ('engine_a_schedule_offers', 'service_role', 'INSERT'),
    ('exercise_personal_records', 'authenticated', 'SELECT')),
fnlist(sig) AS (VALUES ('public.engine_a_valid_weekdays(smallint[])'),('public.engine_a_forbid_change()'),('public.engine_a_release_guard()'),('public.engine_a_control_stamp()'),('public.engine_a_control_log()'),('public.engine_a_delist_log()'),('public.engine_a_attempt_guard()'),('public.engine_a_offer_guard()'),('public.engine_a_purge_decisions()'),('public.engine_a_routine_baseline()'),('public.engine_a_ledger_guard()')),
fn AS (SELECT p.oid, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS sig, p.proacl, p.proowner, p.prosecdef, p.proconfig
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'engine\_a\_%'),
want_fn(sig, r) AS (VALUES
    ('engine_a_purge_decisions()', 'service_role'),
    ('engine_a_valid_weekdays(smallint[])', 'service_role')),
seqs AS (SELECT d.objid AS oid FROM pg_depend d JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
          WHERE d.refobjid IN (SELECT oid FROM rel WHERE oid IS NOT NULL) AND d.deptype IN ('a','i')),
problems(problem) AS (
  SELECT 'missing table ' || t FROM rel WHERE oid IS NULL
  UNION ALL
  SELECT 'RLS off on ' || rel.t FROM rel JOIN pg_class c ON c.oid = rel.oid WHERE NOT c.relrowsecurity
  UNION ALL
  SELECT 'effective table privilege ' || rel.t || ' ' || roles.r || ' ' || privs.p
         || CASE WHEN has_table_privilege(roles.r, rel.oid, privs.p) THEN ' unexpected' ELSE ' missing' END
    FROM rel, roles, privs
   WHERE rel.oid IS NOT NULL
     AND has_table_privilege(roles.r, rel.oid, privs.p)
         <> EXISTS (SELECT 1 FROM want_tab w WHERE w.t = rel.t AND w.r = roles.r AND w.p = privs.p)
  UNION ALL
  SELECT 'PUBLIC grant on ' || rel.t FROM rel JOIN pg_class c ON c.oid = rel.oid, aclexplode(c.relacl) a
   WHERE a.grantee = 0
  UNION ALL
  SELECT 'grant option on ' || rel.t || ' for ' || a.grantee::regrole::text
    FROM rel JOIN pg_class c ON c.oid = rel.oid, aclexplode(c.relacl) a
   WHERE a.is_grantable AND a.grantee <> c.relowner
  UNION ALL
  SELECT 'column ACL on ' || rel.t FROM rel JOIN pg_attribute a ON a.attrelid = rel.oid
   WHERE a.attacl IS NOT NULL
  UNION ALL
  SELECT 'missing function ' || sig FROM fnlist WHERE to_regprocedure(sig) IS NULL
  UNION ALL
  SELECT 'unexpected engine_a function count ' || count(*) FROM fn HAVING count(*) <> 11
  UNION ALL
  SELECT 'function owner or search_path ' || sig FROM fn
   WHERE fn.proowner <> 'postgres'::regrole OR fn.proconfig IS NULL
  UNION ALL
  SELECT 'SECURITY DEFINER other than purge: ' || sig FROM fn
   WHERE fn.prosecdef AND sig <> 'engine_a_purge_decisions()'
  UNION ALL
  SELECT 'purge is not SECURITY DEFINER' WHERE NOT EXISTS
    (SELECT 1 FROM fn WHERE sig = 'engine_a_purge_decisions()' AND prosecdef)
  UNION ALL
  SELECT 'effective EXECUTE ' || fn.sig || ' ' || roles.r
         || CASE WHEN has_function_privilege(roles.r, fn.oid, 'EXECUTE') THEN ' unexpected' ELSE ' missing' END
    FROM fn, roles
   WHERE has_function_privilege(roles.r, fn.oid, 'EXECUTE')
         <> EXISTS (SELECT 1 FROM want_fn w WHERE w.sig = fn.sig AND w.r = roles.r)
  UNION ALL
  SELECT 'PUBLIC or grant-option EXECUTE on ' || fn.sig
    FROM fn, aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
   WHERE a.grantee = 0 OR (a.is_grantable AND a.grantee <> fn.proowner)
  UNION ALL
  SELECT 'sequence privilege ' || s.oid::regclass::text || ' ' || roles.r
    FROM seqs s, roles
   WHERE has_sequence_privilege(roles.r, s.oid, 'USAGE')
      OR has_sequence_privilege(roles.r, s.oid, 'SELECT')
      OR has_sequence_privilege(roles.r, s.oid, 'UPDATE')
  UNION ALL
  SELECT 'PUBLIC or grant option on sequence ' || s.oid::regclass::text
    FROM seqs s JOIN pg_class c ON c.oid = s.oid, aclexplode(c.relacl) a
   WHERE a.grantee = 0 OR (a.is_grantable AND a.grantee <> c.relowner)
  UNION ALL
  SELECT 'policy set is not exactly the PR select-own policy'
   WHERE (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN (SELECT oid FROM rel)) <> 1
      OR NOT EXISTS (
        SELECT 1 FROM pg_policy p
         WHERE p.polrelid = to_regclass('public.exercise_personal_records')
           AND p.polname = 'exercise_personal_records_select_own'
           AND p.polcmd = 'r' AND p.polpermissive
           AND p.polroles = ARRAY['authenticated'::regrole::oid]
           -- Catalog identity, not deparsed text: the predicate depends on
           -- auth.uid() and on the user_id column, and its text is that
           -- comparison with or without the schema prefix (search_path).
           AND pg_get_expr(p.polqual, p.polrelid) ~ '^\((auth\.)?uid\(\) = user_id\)$'
           AND EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_policy'::regclass AND d.objid = p.oid
                          AND d.refclassid = 'pg_proc'::regclass
                          AND d.refobjid = 'auth.uid()'::regprocedure)
           AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_attribute a
                          ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                        WHERE d.classid = 'pg_policy'::regclass AND d.objid = p.oid
                          AND d.refobjid = p.polrelid AND a.attname = 'user_id')
           AND p.polwithcheck IS NULL)
  UNION ALL
  SELECT 'trigger inventory is not 13 enabled triggers'
   WHERE (SELECT count(*) FILTER (WHERE tgenabled = 'O') FROM pg_trigger
           WHERE tgrelid IN (SELECT oid FROM rel) AND NOT tgisinternal) <> 13
      OR (SELECT count(*) FROM pg_trigger
           WHERE tgrelid IN (SELECT oid FROM rel) AND NOT tgisinternal) <> 13
  UNION ALL
  SELECT 'missing domain ' || d FROM (VALUES ('engine_a_code'), ('engine_a_disclosure_kind')) v(d)
   WHERE to_regtype('public.' || d) IS NULL
  UNION ALL
  SELECT 'foreign key to public.workout_plans (belongs to M2)'
   WHERE EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.contype = 'f' AND c.conrelid IN (SELECT oid FROM rel)
                    AND c.confrelid = 'public.workout_plans'::regclass)

  UNION ALL
  SELECT 'control singleton is not off'
   WHERE (SELECT count(*) FROM public.engine_a_control) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.engine_a_control
                      WHERE id = 1 AND state = 'off' AND NOT admission_enabled
                        AND active_release_id IS NULL)
  UNION ALL
  SELECT 'seed control event missing or wrong'
   WHERE (SELECT count(*) FROM public.engine_a_control_events) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.engine_a_control_events
                      WHERE old_row IS NULL AND new_row ->> 'state' = 'off'
                        AND new_row ->> 'admission_enabled' = 'false'
                        AND new_row -> 'active_release_id' = 'null'::jsonb)
  UNION ALL
  SELECT 'data table not empty' WHERE
       EXISTS (SELECT 1 FROM public.engine_a_releases)
    OR EXISTS (SELECT 1 FROM public.engine_a_qa_accounts)
    OR EXISTS (SELECT 1 FROM public.engine_a_delist)
    OR EXISTS (SELECT 1 FROM public.engine_a_delist_events)
    OR EXISTS (SELECT 1 FROM public.engine_a_attempts)
    OR EXISTS (SELECT 1 FROM public.engine_a_decisions)
    OR EXISTS (SELECT 1 FROM public.engine_a_schedule_revisions)
    OR EXISTS (SELECT 1 FROM public.engine_a_schedule_offers)
    OR EXISTS (SELECT 1 FROM public.exercise_personal_records)
  UNION ALL
  SELECT 'migration ledger is not exactly the M1 applied row with routine baseline'
   WHERE (SELECT count(*) FROM public.engine_a_migration_events) <> 1
      OR NOT EXISTS (SELECT 1 FROM public.engine_a_migration_events
                      WHERE step = 'M1' AND action = 'applied'
                        AND evidence -> 'routines' = public.engine_a_routine_baseline())
)
SELECT 'result' AS section, 'all checks' AS item,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS detail
  FROM problems
UNION ALL
SELECT 'failed', problem, '' FROM problems
ORDER BY 1 DESC, 2;
