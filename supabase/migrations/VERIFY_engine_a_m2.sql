-- NOT A MIGRATION. Read-only verification for
-- 20261127130000_engine_a_m2_columns.sql (draft v3). One SELECT, no writes.
-- Run right after the forward file, before M3 (M3 changes these tables).
-- Expected: exactly one row, section 'result', detail 'PASS'. Any other row
-- names one failed check.
-- Part 1 is independent of anything M2 installed: the sha256 of each M2
-- function's stored body (prosrc, kept byte for byte as written in the
-- forward file), its volatility and its pinned search_path.
-- Part 2 runs public.engine_a_m2_problems(), whose body part 1 has just
-- pinned. It compares the four tables' catalog with the pre-M2 catalog in
-- the ledger (only the listed additions and the widened operation CHECK may
-- differ; grants, policies and RLS flags must be identical), checks every
-- added column, constraint, index and trigger, the M2 functions' owner and
-- exact ACL, the projection known-answer test, that every profile has
-- planning columns, the M1 routine baseline, and that Engine A is off.
WITH expected(name, body_sha256, volatility, config) AS (VALUES
('engine_a_log_identity_guard', 'd2639a12e6075963774c2a71f7ae097d6949523b1d8327a09dfc936c8c12c2a1', 'v', 'search_path=pg_catalog, public'),
('engine_a_m2_problems', '30aa6fb66e0b9b279740262dd86b168904e0166a061ebc02f8008e4f078b2728', 's', 'search_path=pg_catalog, public'),
('engine_a_plan_provenance_guard', '081daf862d6b0deb70260ef5b0019a6405e3dee347d710681e39e9bf6e5508e0', 'v', 'search_path=pg_catalog, public'),
('engine_a_planning_digests_v1', '481f9a421b1139da236433fbbe37484feeb9f0874f0cd9e1ad165e6a03668306', 'i', 'search_path=pg_catalog'),
('engine_a_planning_revision_v1', '6af6a568d49755044425cdca5f693d68e3979d593e139cb741c357b2d8257bb0', 'i', 'search_path=pg_catalog'),
('engine_a_set_planning_revision', '26ade24015119e6d8aea4fc226ab719ce85e346e5df770859bd21f280ebfb9b5', 'v', 'search_path=pg_catalog, public'),
('engine_a_table_catalog', 'e9427ea4dbb3ec0a0fc00c0548e25682a61b71fa1281a1eb819dd1c518944147', 's', 'search_path=pg_catalog, public'),
('engine_a_utf8', '2ebff47fd44cdad275f1eec3e7d1a73a764f19f488cbc5ad40a5048c93445d41', 'i', 'search_path=pg_catalog'),
('engine_a_valid_planning_digests', 'df9b7a2189899ad1a7cc4301a5bdc0f032250fa784b0d249a1e649b6229c64ec', 'i', 'search_path=pg_catalog')),
problems(p) AS (
  SELECT 'function body, volatility or search_path differs: ' || e.name
    FROM expected e
    LEFT JOIN pg_proc f ON f.pronamespace = 'public'::regnamespace AND f.proname = e.name
   WHERE f.oid IS NULL
      OR encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') <> e.body_sha256
      OR f.provolatile::text <> e.volatility
      OR array_to_string(f.proconfig, ';') IS DISTINCT FROM e.config
  UNION ALL
  SELECT 'unexpected M2 function count'
   WHERE (SELECT count(*) FROM pg_proc f WHERE f.pronamespace = 'public'::regnamespace
            AND f.proname IN (SELECT name FROM expected)) <> 9
  UNION ALL
  SELECT x FROM public.engine_a_m2_problems() AS x)
SELECT 'result' AS section, 'all checks' AS item,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS detail
  FROM problems
UNION ALL
SELECT 'failed', p, '' FROM problems
ORDER BY 1 DESC, 2;
