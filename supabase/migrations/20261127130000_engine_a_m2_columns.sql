-- 20261127130000_engine_a_m2_columns.sql
-- Draft v3, APPROVED by Codex (review of v3, 2026-11-27); header wording
-- corrected as Codex asked before clipboard approval. See README_M2.md.
-- UNEXECUTED until reviewed by Codex and approved by the owner. Do not
-- supabase db push. Apply by hand in the SQL Editor (clipboard method).
-- Pre-apply check: PRECHECK_engine_a_m2.sql (read-only, every row PASS).
-- Post-apply check: VERIFY_engine_a_m2.sql (read-only, one row PASS).
-- Reverse: 20261127130001_drop_engine_a_m2_columns.sql (manual only).
--
-- Design: SIGNOFF2_1D_DB_DESIGN_v2.md section 5 row M2, plus the M2
-- carry-forwards recorded in Registry OPEN_ITEMS "2026-11-27 (c)".
-- Engine A stays off. Nothing reads or writes the new columns yet; writers
-- arrive in M3. Notes for review: m2_draft/README_M2.md.
--
-- WHAT CHANGES
--   public.profiles
--     + planning_field_digests jsonb NOT NULL, planning_revision text NOT NULL
--       (plain columns, added without a default: no table rewrite)
--     + backfill of every existing row, computed from the row itself
--     + TRIGGER trg_zz_profile_planning_revision (BEFORE INSERT OR UPDATE,
--       named to fire after every other BEFORE trigger) keeps them current
--     + CHECK profiles_planning_fields_valid: both stored values must equal
--       the projection of the row's current values, so a stale or forged
--       value can never be stored, whatever any trigger does
--     This is design 2.9 as written (a DB trigger plus a backfill).
--     Projection v1 = the 12 columns the Engine A adapter reads
--     (api/_engineProfile.js FIELDS minus id and safety_fingerprint):
--     age, gender, goal, experience, location, days_per_week,
--     session_duration, equipment, equipment_extras, injuries,
--     health_conditions, priority_muscle. One sha256 digest per field
--     (so M3 can name the fields that changed) and planning_revision =
--     'v1:' || sha256 of the digest object.
--   public.workout_plans
--     + 10 nullable provenance columns (no default, no backfill; existing
--       rows keep NULL = legacy)
--     + CHECK workout_plans_provenance_valid (per plan_source)
--     + FK (release_id, manifest_sha256) -> engine_a_releases
--     + UNIQUE (id, content_revision), target of the schedule FK
--     + UNIQUE INDEX workout_plans_one_active_per_user (design 2.16)
--     ~ CHECK workout_plans_operation_valid widened by 'setup_change'
--     + TRIGGER engine_a_plan_provenance_guard
--   public.workout_logs
--     + content_revision, schedule_revision, session_index (nullable)
--     + CHECK workout_logs_engine_a_identity_valid
--     + TRIGGER engine_a_log_identity_guard
--   public.engine_a_schedule_revisions
--     + FK (workout_plan_id, content_revision)
--         -> workout_plans (id, content_revision) ON DELETE CASCADE
--   9 functions: 4 pure helpers, 3 trigger functions, the catalog snapshot
--   engine_a_table_catalog and the shared check set engine_a_m2_problems.
--   The two new foreign keys add PostgreSQL's internal referential-integrity
--   triggers on workout_plans (child and parent), engine_a_releases (parent)
--   and engine_a_schedule_revisions (child); the catalog checks list them.
--   One ledger row ('M2','applied') holding the pre-M2 catalog of five
--   tables (the four above plus engine_a_releases), which the M2 rollback
--   must restore exactly.
--
-- EXPLICIT EFFECTS ON EXISTING OBJECTS (all asserted before COMMIT)
--   * BACKFILL. One UPDATE writes the two new columns of every profiles row
--     (57 on 2026-11-27). It runs with the profiles user triggers disabled
--     (ALTER TABLE ... DISABLE TRIGGER USER, inside this transaction, under
--     the ACCESS EXCLUSIVE lock; they are re-enabled right after), so no
--     existing trigger runs and safety_fingerprint is not recomputed. Every
--     row's existing values are compared before and after. No table is
--     rewritten anywhere in this file (ADD COLUMN without a default, CHECK,
--     FK, index and trigger only), so every change is MVCC-safe for other
--     transactions at any isolation level.
--   * profiles, workout_plans and workout_logs are held in ACCESS EXCLUSIVE
--     mode until COMMIT. App reads and writes on them wait for the rest of
--     the transaction (well under a second at current sizes). Run at a quiet
--     time.
--   * NO WAIT ON APP TABLES. After the ledger lock, every other lock is taken
--     with NOWAIT. If any session holds any lock on them (for example a
--     replace RPC between its workout_plans and profiles reads), this file
--     fails at once with "could not obtain lock" and changes nothing; run it
--     again. Because this transaction never waits for an app table, it can
--     never be part of a deadlock cycle with the replace or finish RPC,
--     whatever order they lock in.
--   * No grant, policy, RLS flag, existing column, existing constraint
--     (other than workout_plans_operation_valid), existing index or
--     existing trigger changes (the profiles user triggers are disabled for
--     the backfill statement only and must end enabled as before): the five
--     tables' catalog is compared before and after.
--   * The only write to existing rows is the profiles backfill above (the
--     two new columns of every row). No other existing row is written: every
--     row of profiles, workout_plans and workout_logs keeps its existing
--     values (compared before and after), and every workout_plans and
--     workout_logs row keeps NULL in the new columns. The plpgsql routines
--     baselined at M1 are unchanged (compared with the M1 baseline).
--
-- LOCK ORDER: the ledger first (the M1 contract; the only lock this file
-- waits for), then everything else with NOWAIT.
--
-- ATOMIC. One transaction. NOT IDEMPOTENT ON PURPOSE.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;

LOCK TABLE public.engine_a_migration_events IN EXCLUSIVE MODE;
LOCK TABLE public.profiles, public.workout_plans, public.workout_logs,
           public.engine_a_schedule_revisions
  IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.engine_a_releases, public.engine_a_control
  IN SHARE ROW EXCLUSIVE MODE NOWAIT;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v    text;
  n    bigint;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'precondition failed: PostgreSQL 15 or later required';
  END IF;
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'precondition failed: server_encoding is %, expected UTF8',
      current_setting('server_encoding');
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'precondition failed: run as postgres, not %', current_user;
  END IF;

  -- Ledger, by each step's latest action: M1 applied first; M2, M3, M4
  -- and M5 not applied (never applied, or last dropped).
  SELECT string_agg(step || ':' || action, ',' ORDER BY step) INTO v
    FROM (SELECT DISTINCT ON (step) step, action
            FROM public.engine_a_migration_events ORDER BY step, id DESC) x;
  IF (SELECT step || ':' || action FROM public.engine_a_migration_events ORDER BY id LIMIT 1)
       IS DISTINCT FROM 'M1:applied'
     OR EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (step) step, action
                                 FROM public.engine_a_migration_events
                                ORDER BY step, id DESC) x
                 WHERE x.step <> 'M1' AND x.action = 'applied') THEN
    RAISE EXCEPTION 'precondition failed: latest ledger state is [%], expected M1 applied and M2-M5 not applied', v;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.engine_a_control
                  WHERE id = 1 AND state = 'off' AND NOT admission_enabled) THEN
    RAISE EXCEPTION 'precondition failed: Engine A control is not off';
  END IF;

  -- M2 objects absent.
  SELECT string_agg(a.attrelid::regclass::text || '.' || a.attname, ', ') INTO v
    FROM pg_attribute a
   WHERE a.attrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass,
                        'public.workout_logs'::regclass)
     AND NOT a.attisdropped
     AND a.attname IN ('planning_field_digests','planning_revision','plan_source',
                       'plan_schema_version','content_revision','schedule_revision',
                       'release_id','manifest_sha256','eligibility_id','attempt_digest',
                       'session_index');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'precondition failed: M2 columns already exist (%)', v;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND proname IN ('engine_a_utf8','engine_a_planning_digests_v1',
                              'engine_a_planning_revision_v1','engine_a_valid_planning_digests',
                              'engine_a_plan_provenance_guard','engine_a_log_identity_guard',
                              'engine_a_table_catalog','engine_a_set_planning_revision'))
     OR to_regclass('public.workout_plans_one_active_per_user') IS NOT NULL THEN
    RAISE EXCEPTION 'precondition failed: an M2 function or index already exists';
  END IF;

  -- The 12 projection columns, with the types this file hashes.
  SELECT string_agg(x.col || ' ' || coalesce(format_type(a.atttypid, a.atttypmod), 'MISSING'), ', ')
    INTO v
    FROM (VALUES ('age','integer'), ('gender','text'), ('goal','text'),
                 ('experience','text'), ('location','text'), ('days_per_week','integer'),
                 ('session_duration','integer'), ('equipment','text'),
                 ('equipment_extras','text[]'), ('injuries','text'),
                 ('health_conditions','text'), ('priority_muscle','text')) x(col, typ)
    LEFT JOIN pg_attribute a ON a.attrelid = 'public.profiles'::regclass
                            AND a.attname = x.col AND NOT a.attisdropped
   WHERE format_type(a.atttypid, a.atttypmod) IS DISTINCT FROM x.typ;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'precondition failed: projection column types differ (%)', v;
  END IF;

  -- The constraint this file widens, exactly as installed.
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.workout_plans'::regclass
         AND c.conname = 'workout_plans_operation_valid')
     IS DISTINCT FROM
     'CHECK (((operation IS NULL) OR (operation = ANY (ARRAY[''initial_setup''::text, ''feedback_adjustment''::text, ''safety_regeneration''::text]))))' THEN
    RAISE EXCEPTION 'precondition failed: workout_plans_operation_valid differs from the expected definition';
  END IF;

  -- No user trigger on workout_plans or workout_logs; the three known
  -- profiles triggers only.
  SELECT string_agg(z.n, ', ' ORDER BY z.n COLLATE "C") INTO v
    FROM (SELECT c.relname || '.' || tg.tgname AS n
            FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
           WHERE NOT tg.tgisinternal
             AND tg.tgrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass,
                                'public.workout_logs'::regclass)) z;
  IF v IS DISTINCT FROM 'profiles.trg_protect_onboarding_completed_latch, profiles.trg_protect_profile_billing, profiles.trg_set_profile_safety_fingerprint' THEN
    RAISE EXCEPTION 'precondition failed: unexpected trigger set (%)', v;
  END IF;
  -- They are all enabled, so DISABLE/ENABLE TRIGGER USER restores them exactly.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
              AND NOT tgisinternal AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'precondition failed: a profiles user trigger is not in the enabled (O) state';
  END IF;

  -- The partial unique index needs at most one active plan per owner.
  SELECT count(*) INTO n FROM (
    SELECT user_id FROM public.workout_plans
     WHERE is_active IS TRUE GROUP BY user_id HAVING count(*) > 1) d;
  IF n <> 0 THEN
    RAISE EXCEPTION 'precondition failed: % owners have more than one active plan; a reviewed recovery is required first', n;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. FUNCTIONS. Every function is owned by postgres with a pinned
--    search_path. The four pure helpers are IMMUTABLE and use only
--    immutable built-ins (int4out cast, textout -> byteain I/O cast,
--    replace, length, array_ndims, array_dims, unnest, sha256, encode,
--    jsonb_in, jsonb_out, jsonb accessors), so the generated columns are
--    deterministic.
-- ---------------------------------------------------------------------------

-- UTF-8 bytes of a text value. The database encoding is UTF8 (checked
-- above). Doubling every backslash makes byteain's escape format return the
-- input bytes unchanged; equal to convert_to(p, 'UTF8') (PRECHECK proves it
-- on production for hard cases).
CREATE FUNCTION public.engine_a_utf8(p text)
RETURNS bytea
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT replace(p, E'\\', E'\\\\')::bytea
$fn$;

-- One digest per projection field. Field encoding before hashing:
--   integer / text: 'null' for NULL, else 'int:' || value or 'text:' || value;
--   equipment_extras: 'null' for NULL, else 'arr:' || ndims || ':' ||
--   array_dims (bounds) || ':' then every element, duplicates kept, sorted
--   by COLLATE "C" (NULL first), each as 'n' (NULL element) or
--   length || ':' || element, joined by ','. Only element order is ignored:
--   duplicates, NULL elements, dimensions and bounds all change the digest,
--   because the adapter treats such inputs differently (it rejects
--   duplicates). Over-distinguishing is safe (a spurious change only
--   refuses or regenerates); under-distinguishing is not.
-- Stored values are hashed as stored (no case folding), so any change of a
-- stored value is a planning change.
CREATE FUNCTION public.engine_a_planning_digests_v1(
  p_age integer, p_gender text, p_goal text, p_experience text, p_location text,
  p_days_per_week integer, p_session_duration integer, p_equipment text,
  p_equipment_extras text[], p_injuries text, p_health_conditions text,
  p_priority_muscle text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  WITH enc(k, s) AS (VALUES
    ('age',               CASE WHEN p_age IS NULL THEN 'null' ELSE 'int:' || p_age::text END),
    ('gender',            CASE WHEN p_gender IS NULL THEN 'null' ELSE 'text:' || p_gender END),
    ('goal',              CASE WHEN p_goal IS NULL THEN 'null' ELSE 'text:' || p_goal END),
    ('experience',        CASE WHEN p_experience IS NULL THEN 'null' ELSE 'text:' || p_experience END),
    ('location',          CASE WHEN p_location IS NULL THEN 'null' ELSE 'text:' || p_location END),
    ('days_per_week',     CASE WHEN p_days_per_week IS NULL THEN 'null' ELSE 'int:' || p_days_per_week::text END),
    ('session_duration',  CASE WHEN p_session_duration IS NULL THEN 'null' ELSE 'int:' || p_session_duration::text END),
    ('equipment',         CASE WHEN p_equipment IS NULL THEN 'null' ELSE 'text:' || p_equipment END),
    ('equipment_extras',  CASE WHEN p_equipment_extras IS NULL THEN 'null' ELSE 'arr:'
                            || coalesce(array_ndims(p_equipment_extras), 0)::text || ':'
                            || coalesce(array_dims(p_equipment_extras), '') || ':'
                            || coalesce(
                            (SELECT string_agg(CASE WHEN e.x IS NULL THEN 'n'
                                                    ELSE length(e.x)::text || ':' || e.x END,
                                               ',' ORDER BY e.x COLLATE "C" NULLS FIRST)
                               FROM unnest(p_equipment_extras) AS e(x)), '') END),
    ('injuries',          CASE WHEN p_injuries IS NULL THEN 'null' ELSE 'text:' || p_injuries END),
    ('health_conditions', CASE WHEN p_health_conditions IS NULL THEN 'null' ELSE 'text:' || p_health_conditions END),
    ('priority_muscle',   CASE WHEN p_priority_muscle IS NULL THEN 'null' ELSE 'text:' || p_priority_muscle END))
  SELECT ('{' || string_agg('"' || k || '":"'
                            || encode(sha256(public.engine_a_utf8(s)), 'hex') || '"',
                            ',' ORDER BY k) || '}')::jsonb
    FROM enc
$fn$;

CREATE FUNCTION public.engine_a_planning_revision_v1(p_digests jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE WHEN p_digests IS NULL THEN NULL
              ELSE 'v1:' || encode(sha256(public.engine_a_utf8(p_digests::text)), 'hex') END
$fn$;

-- Exactly the 12 projection keys, each a 64-hex string. NULL input is false.
CREATE FUNCTION public.engine_a_valid_planning_digests(p_digests jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT coalesce(
           jsonb_typeof(p_digests) = 'object'
           AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(p_digests) AS k)
               = ARRAY['age','days_per_week','equipment','equipment_extras','experience',
                       'gender','goal','health_conditions','injuries','location',
                       'priority_muscle','session_duration']::text[]
           AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_digests) AS e
                            WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string'
                               OR NOT ((e.value #>> '{}') ~ '^[0-9a-f]{64}$')),
           false)
$fn$;

-- profiles planning maintenance. Overwrites any supplied value.
CREATE FUNCTION public.engine_a_set_planning_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.planning_field_digests := public.engine_a_planning_digests_v1(
    NEW.age, NEW.gender, NEW.goal, NEW.experience, NEW.location, NEW.days_per_week,
    NEW.session_duration, NEW.equipment, NEW.equipment_extras, NEW.injuries,
    NEW.health_conditions, NEW.priority_muscle);
  NEW.planning_revision := public.engine_a_planning_revision_v1(NEW.planning_field_digests);
  RETURN NEW;
END
$fn$;

-- workout_plans provenance writer rule.
--   INSERT: any provenance value non-NULL only as postgres (the owner of the
--     M3 SECURITY DEFINER RPCs, or the owner's SQL).
--   UPDATE: provenance values never change, except schedule_revision, which
--     only postgres may advance by exactly 1 on an Engine A row. An Engine A
--     row cannot be updated by any other role at all.
CREATE FUNCTION public.engine_a_plan_provenance_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'postgres'
       AND (NEW.plan_source IS NOT NULL OR NEW.plan_schema_version IS NOT NULL
            OR NEW.content_revision IS NOT NULL OR NEW.schedule_revision IS NOT NULL
            OR NEW.release_id IS NOT NULL OR NEW.manifest_sha256 IS NOT NULL
            OR NEW.eligibility_id IS NOT NULL OR NEW.planning_revision IS NOT NULL
            OR NEW.planning_field_digests IS NOT NULL OR NEW.attempt_digest IS NOT NULL) THEN
      RAISE EXCEPTION 'engine_a_provenance_writer: % cannot write plan provenance', current_user;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.plan_source IS NOT DISTINCT FROM 'engine_a' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'engine_a_plan_immutable: % cannot update an Engine A plan', current_user;
  END IF;
  IF NEW.plan_source IS DISTINCT FROM OLD.plan_source
     OR NEW.plan_schema_version IS DISTINCT FROM OLD.plan_schema_version
     OR NEW.content_revision IS DISTINCT FROM OLD.content_revision
     OR NEW.release_id IS DISTINCT FROM OLD.release_id
     OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
     OR NEW.eligibility_id IS DISTINCT FROM OLD.eligibility_id
     OR NEW.planning_revision IS DISTINCT FROM OLD.planning_revision
     OR NEW.planning_field_digests IS DISTINCT FROM OLD.planning_field_digests
     OR NEW.attempt_digest IS DISTINCT FROM OLD.attempt_digest THEN
    RAISE EXCEPTION 'engine_a_provenance_immutable';
  END IF;
  IF NEW.schedule_revision IS DISTINCT FROM OLD.schedule_revision
     AND NOT (current_user = 'postgres'
              AND OLD.plan_source IS NOT DISTINCT FROM 'engine_a'
              AND NEW.schedule_revision IS NOT DISTINCT FROM OLD.schedule_revision + 1) THEN
    RAISE EXCEPTION 'engine_a_schedule_revision_step: % -> %', OLD.schedule_revision, NEW.schedule_revision;
  END IF;
  RETURN NEW;
END
$fn$;

-- workout_logs Engine A identity writer rule.
--   INSERT: identity values non-NULL only as postgres (the M3 finish RPC).
--   UPDATE: identity values never change; an Engine A log cannot be updated
--     by any role other than postgres. DELETE is unchanged (own-row RLS and
--     account deletion keep working).
CREATE FUNCTION public.engine_a_log_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'postgres'
       AND (NEW.content_revision IS NOT NULL OR NEW.schedule_revision IS NOT NULL
            OR NEW.session_index IS NOT NULL) THEN
      RAISE EXCEPTION 'engine_a_log_identity_writer: % cannot write Engine A log identity', current_user;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.content_revision IS NOT NULL AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'engine_a_log_immutable: % cannot update an Engine A log', current_user;
  END IF;
  IF NEW.content_revision IS DISTINCT FROM OLD.content_revision
     OR NEW.schedule_revision IS DISTINCT FROM OLD.schedule_revision
     OR NEW.session_index IS DISTINCT FROM OLD.session_index THEN
    RAISE EXCEPTION 'engine_a_log_identity_immutable';
  END IF;
  RETURN NEW;
END
$fn$;

-- Catalog snapshot of one table: owner, RLS flags, ACL (with grantor),
-- columns (type, nullability, default or generation expression, identity,
-- column ACL), constraints, indexes, user triggers, policies. Used to prove
-- that this file changed only what it lists and that the M2 rollback
-- restores the pre-M2 shape. Pinned search_path, so deparsed text does not
-- depend on the caller.
CREATE FUNCTION public.engine_a_table_catalog(p_rel regclass)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $fn$
  WITH acl AS (
    SELECT coalesce(jsonb_agg(x.e ORDER BY x.e::text COLLATE "C"), '[]'::jsonb) AS v
      FROM (SELECT jsonb_build_array(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
                                     a.privilege_type, a.is_grantable, a.grantor::regrole::text) AS e
              FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
             WHERE c.oid = p_rel) x)
  SELECT jsonb_build_object(
    'owner', (SELECT c.relowner::regrole::text FROM pg_class c WHERE c.oid = p_rel),
    'rls', (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = p_rel),
    'force_rls', (SELECT c.relforcerowsecurity FROM pg_class c WHERE c.oid = p_rel),
    'acl', (SELECT v FROM acl),
    'columns', (SELECT coalesce(jsonb_object_agg(a.attname, jsonb_build_object(
                   'type', format_type(a.atttypid, a.atttypmod),
                   'not_null', a.attnotnull,
                   'default', pg_get_expr(d.adbin, d.adrelid),
                   'generated', a.attgenerated::text,
                   'identity', a.attidentity::text,
                   'acl', (SELECT coalesce(jsonb_agg(y.e ORDER BY y.e::text COLLATE "C"), '[]'::jsonb)
                             FROM (SELECT jsonb_build_array(CASE WHEN ca.grantee = 0 THEN 'PUBLIC' ELSE ca.grantee::regrole::text END,
                                                            ca.privilege_type, ca.is_grantable, ca.grantor::regrole::text) AS e
                                     FROM aclexplode(a.attacl) ca) y))), '{}'::jsonb)
                  FROM pg_attribute a
                  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = p_rel AND a.attnum > 0 AND NOT a.attisdropped),
    'constraints', (SELECT coalesce(jsonb_object_agg(con.conname, jsonb_build_object(
                       'type', con.contype::text, 'def', pg_get_constraintdef(con.oid),
                       'validated', con.convalidated)), '{}'::jsonb)
                      FROM pg_constraint con WHERE con.conrelid = p_rel),
    'indexes', (SELECT coalesce(jsonb_object_agg(ic.relname, pg_get_indexdef(i.indexrelid)), '{}'::jsonb)
                  FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
                 WHERE i.indrelid = p_rel),
    'triggers', (SELECT coalesce(jsonb_object_agg(t.tgname, jsonb_build_object(
                    'def', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled::text)), '{}'::jsonb)
                   FROM pg_trigger t WHERE t.tgrelid = p_rel AND NOT t.tgisinternal),
    -- Internal (referential-integrity) triggers, by constraint: each as
    -- [function, tgtype event bits, enabled state], sorted. Internal names
    -- carry OIDs, so they are not used.
    'internal_triggers', (SELECT coalesce(jsonb_object_agg(z.conname, z.trg), '{}'::jsonb)
                            FROM (SELECT con.conname,
                                         jsonb_agg(jsonb_build_array(t.tgfoid::regproc::text,
                                                                     t.tgtype, t.tgenabled::text)
                                                   ORDER BY t.tgfoid::regproc::text COLLATE "C", t.tgtype) AS trg
                                    FROM pg_trigger t JOIN pg_constraint con ON con.oid = t.tgconstraint
                                   WHERE t.tgrelid = p_rel AND t.tgisinternal
                                   GROUP BY con.conname) z),
    'policies', (SELECT coalesce(jsonb_object_agg(p.polname, jsonb_build_object(
                    'cmd', p.polcmd::text, 'permissive', p.polpermissive,
                    'roles', (SELECT jsonb_agg(z.n ORDER BY z.n COLLATE "C")
                               FROM (SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE r::regrole::text END AS n
                                       FROM unnest(p.polroles) r) z),
                    'using', pg_get_expr(p.polqual, p.polrelid),
                    'check', pg_get_expr(p.polwithcheck, p.polrelid))), '{}'::jsonb)
                   FROM pg_policy p WHERE p.polrelid = p_rel))
$fn$;

-- Privileges. The four pure helpers stay callable by everyone (PUBLIC):
-- they read no data, and the generated columns and CHECKs call them as the
-- writing role, which includes anon, authenticated, service_role and
-- auth's profile writer. Everything else is owner-only.
DO $mig$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('engine_a_utf8','engine_a_planning_digests_v1',
                                'engine_a_planning_revision_v1','engine_a_valid_planning_digests',
                                'engine_a_plan_provenance_guard','engine_a_log_identity_guard',
                                'engine_a_table_catalog','engine_a_set_planning_revision') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END
$mig$;
GRANT EXECUTE ON FUNCTION public.engine_a_utf8(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_a_planning_digests_v1(
  integer, text, text, text, text, integer, integer, text, text[], text, text, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_a_planning_revision_v1(jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_a_valid_planning_digests(jsonb) TO PUBLIC;

-- Known-answer test of the projection (also in PRECHECK, inline, on the
-- production server before apply).
DO $mig$
BEGIN
  IF public.engine_a_planning_revision_v1(public.engine_a_planning_digests_v1(
       30, 'male', 'muscle_gain', 'beginner', 'gym', 4, 60, 'full_gym',
       ARRAY['door_anchor', 'band', 'band'], E'left knee \\ pain ''old'' \u00fc', '["none"]', NULL))
     IS DISTINCT FROM 'v1:da09b4b05f09fd2fb4baae423a7529e6933513e01acc14b75d5524f82c463b12' THEN
    RAISE EXCEPTION 'precondition failed: projection known-answer test differs';
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. SNAPSHOTS BEFORE ANY TABLE CHANGE.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _m2_catalog_before ON COMMIT DROP AS
SELECT t.name, public.engine_a_table_catalog(('public.' || t.name)::regclass) AS cat
  FROM (VALUES ('profiles'), ('workout_plans'), ('workout_logs'),
               ('engine_a_schedule_revisions'), ('engine_a_releases')) t(name);

CREATE TEMP TABLE _m2_rows_before ON COMMIT DROP AS
SELECT 'profiles'::text AS t, p.id::text AS k, to_jsonb(p) AS j FROM public.profiles p
UNION ALL
SELECT 'workout_plans', w.id::text, to_jsonb(w) FROM public.workout_plans w
UNION ALL
SELECT 'workout_logs', l.id::text, to_jsonb(l) FROM public.workout_logs l;

-- ---------------------------------------------------------------------------
-- 4. public.profiles: planning columns, backfill, maintenance, invariant.
--    No rewrite: plain nullable columns without a default, then an ordinary
--    (MVCC-safe) UPDATE with the user triggers disabled for that statement.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN planning_field_digests jsonb,
  ADD COLUMN planning_revision text;

ALTER TABLE public.profiles DISABLE TRIGGER USER;
UPDATE public.profiles
   SET planning_field_digests = public.engine_a_planning_digests_v1(age, gender, goal,
         experience, location, days_per_week, session_duration, equipment,
         equipment_extras, injuries, health_conditions, priority_muscle),
       planning_revision = public.engine_a_planning_revision_v1(
         public.engine_a_planning_digests_v1(age, gender, goal, experience, location,
           days_per_week, session_duration, equipment, equipment_extras, injuries,
           health_conditions, priority_muscle));
ALTER TABLE public.profiles ENABLE TRIGGER USER;

ALTER TABLE public.profiles
  ALTER COLUMN planning_field_digests SET NOT NULL,
  ALTER COLUMN planning_revision SET NOT NULL;

-- The stored values must equal the projection of the row as written, after
-- every BEFORE trigger: a stale or forged value fails the write.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_planning_fields_valid CHECK (coalesce(
    planning_field_digests = public.engine_a_planning_digests_v1(age, gender, goal,
      experience, location, days_per_week, session_duration, equipment,
      equipment_extras, injuries, health_conditions, priority_muscle)
    AND planning_revision = public.engine_a_planning_revision_v1(planning_field_digests),
    false));

CREATE TRIGGER trg_zz_profile_planning_revision
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_set_planning_revision();

-- ---------------------------------------------------------------------------
-- 5. public.workout_plans: provenance columns and rules.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_plans
  ADD COLUMN plan_source            text,
  ADD COLUMN plan_schema_version    smallint,
  ADD COLUMN content_revision       text,
  ADD COLUMN schedule_revision      integer,
  ADD COLUMN release_id             text,
  ADD COLUMN manifest_sha256        text,
  ADD COLUMN eligibility_id         text,
  ADD COLUMN planning_revision      text,
  ADD COLUMN planning_field_digests jsonb,
  ADD COLUMN attempt_digest         text;

-- plan_source NULL = legacy row (every existing row): all ten NULL.
-- 'current' = a current-path save recorded by M3: planning provenance only.
-- 'engine_a' = an Engine A v2 plan: every field, consistent.
-- Wrapped in coalesce so a NULL anywhere fails instead of passing.
ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_provenance_valid CHECK (coalesce(
    CASE plan_source
      WHEN 'engine_a' THEN
        plan_schema_version = 2
        AND content_revision ~ '^[0-9a-f]{64}$'
        AND schedule_revision >= 1
        AND release_id IS NOT NULL AND manifest_sha256 IS NOT NULL
        AND char_length(eligibility_id) BETWEEN 1 AND 300
        AND public.engine_a_valid_planning_digests(planning_field_digests)
        AND planning_revision = public.engine_a_planning_revision_v1(planning_field_digests)
        AND attempt_digest ~ '^[0-9a-f]{64}$'
        AND user_id IS NOT NULL AND client_attempt_id IS NOT NULL
      WHEN 'current' THEN
        plan_schema_version IS NULL AND content_revision IS NULL
        AND schedule_revision IS NULL AND release_id IS NULL
        AND manifest_sha256 IS NULL AND eligibility_id IS NULL
        AND public.engine_a_valid_planning_digests(planning_field_digests)
        AND planning_revision = public.engine_a_planning_revision_v1(planning_field_digests)
        AND (attempt_digest IS NULL OR attempt_digest ~ '^[0-9a-f]{64}$')
      ELSE
        plan_source IS NULL AND plan_schema_version IS NULL AND content_revision IS NULL
        AND schedule_revision IS NULL AND release_id IS NULL AND manifest_sha256 IS NULL
        AND eligibility_id IS NULL AND planning_revision IS NULL
        AND planning_field_digests IS NULL AND attempt_digest IS NULL
    END, false));

ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_release_fkey
    FOREIGN KEY (release_id, manifest_sha256)
    REFERENCES public.engine_a_releases (release_id, manifest_sha256);

ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_id_content_revision_key UNIQUE (id, content_revision);

ALTER TABLE public.workout_plans DROP CONSTRAINT workout_plans_operation_valid;
ALTER TABLE public.workout_plans
  ADD CONSTRAINT workout_plans_operation_valid CHECK (
    (operation IS NULL)
    OR (operation = ANY (ARRAY['initial_setup'::text, 'feedback_adjustment'::text,
                               'safety_regeneration'::text, 'setup_change'::text])));

CREATE UNIQUE INDEX workout_plans_one_active_per_user
  ON public.workout_plans (user_id) WHERE is_active IS TRUE;

CREATE TRIGGER engine_a_plan_provenance_guard
  BEFORE INSERT OR UPDATE ON public.workout_plans
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_plan_provenance_guard();

-- ---------------------------------------------------------------------------
-- 6. public.workout_logs: Engine A session identity.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_logs
  ADD COLUMN content_revision  text,
  ADD COLUMN schedule_revision integer,
  ADD COLUMN session_index     smallint;

ALTER TABLE public.workout_logs
  ADD CONSTRAINT workout_logs_engine_a_identity_valid CHECK (coalesce(
    (content_revision IS NULL AND schedule_revision IS NULL AND session_index IS NULL)
    OR (content_revision ~ '^[0-9a-f]{64}$' AND schedule_revision >= 1
        AND session_index BETWEEN 0 AND 6 AND plan_id IS NOT NULL),
    false));

CREATE TRIGGER engine_a_log_identity_guard
  BEFORE INSERT OR UPDATE ON public.workout_logs
  FOR EACH ROW EXECUTE FUNCTION public.engine_a_log_identity_guard();

-- ---------------------------------------------------------------------------
-- 7. engine_a_schedule_revisions -> workout_plans (deferred from M1).
-- ---------------------------------------------------------------------------
ALTER TABLE public.engine_a_schedule_revisions
  ADD CONSTRAINT engine_a_schedule_revisions_plan_fkey
    FOREIGN KEY (workout_plan_id, content_revision)
    REFERENCES public.workout_plans (id, content_revision) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 8. LEDGER. Same transaction as the change it certifies (M1 contract).
-- ---------------------------------------------------------------------------
INSERT INTO public.engine_a_migration_events (step, action, evidence)
SELECT 'M2', 'applied', jsonb_build_object(
         'catalog_before', (SELECT jsonb_object_agg(name, cat) FROM _m2_catalog_before),
         'projection', 'v1',
         'projection_fields', jsonb_build_array('age','gender','goal','experience','location',
           'days_per_week','session_duration','equipment','equipment_extras','injuries',
           'health_conditions','priority_muscle'),
         'rows', jsonb_build_object(
           'profiles', (SELECT count(*) FROM public.profiles),
           'workout_plans', (SELECT count(*) FROM public.workout_plans),
           'workout_logs', (SELECT count(*) FROM public.workout_logs)));

-- ---------------------------------------------------------------------------
-- 9. CHECK SET (shared with VERIFY_engine_a_m2.sql), then data and catalog
--    comparisons that only this transaction can make.
-- ---------------------------------------------------------------------------
-- Shared check set: returns one row per problem, none when M2 is installed
-- exactly as intended. Read-only. Owner-only. Valid right after M2 apply and
-- until M3 changes these tables (VERIFY is run right after apply).
CREATE FUNCTION public.engine_a_m2_problems()
RETURNS SETOF text
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  before   jsonb;
  b        jsonb;
  a        jsonb;
  t        text;
  k        text;
  added_cols jsonb := jsonb_build_object(
    'profiles', jsonb_build_array('planning_field_digests','planning_revision'),
    'workout_plans', jsonb_build_array('plan_source','plan_schema_version','content_revision',
      'schedule_revision','release_id','manifest_sha256','eligibility_id','planning_revision',
      'planning_field_digests','attempt_digest'),
    'workout_logs', jsonb_build_array('content_revision','schedule_revision','session_index'),
    'engine_a_schedule_revisions', jsonb_build_array(),
    'engine_a_releases', jsonb_build_array());
  added_cons jsonb := jsonb_build_object(
    'profiles', jsonb_build_array('profiles_planning_fields_valid'),
    'workout_plans', jsonb_build_array('workout_plans_provenance_valid','workout_plans_release_fkey',
      'workout_plans_id_content_revision_key'),
    'workout_logs', jsonb_build_array('workout_logs_engine_a_identity_valid'),
    'engine_a_schedule_revisions', jsonb_build_array('engine_a_schedule_revisions_plan_fkey'),
    'engine_a_releases', jsonb_build_array());
  added_idx jsonb := jsonb_build_object(
    'profiles', jsonb_build_array(),
    'workout_plans', jsonb_build_array('workout_plans_one_active_per_user',
      'workout_plans_id_content_revision_key'),
    'workout_logs', jsonb_build_array(),
    'engine_a_schedule_revisions', jsonb_build_array(),
    'engine_a_releases', jsonb_build_array());
  added_trg jsonb := jsonb_build_object(
    'profiles', jsonb_build_array('trg_zz_profile_planning_revision'),
    'workout_plans', jsonb_build_array('engine_a_plan_provenance_guard'),
    'workout_logs', jsonb_build_array('engine_a_log_identity_guard'),
    'engine_a_schedule_revisions', jsonb_build_array(),
    'engine_a_releases', jsonb_build_array());
  -- Internal RI triggers added by the two new foreign keys, exactly
  -- (function, event bits, enabled), per table and constraint.
  added_ri jsonb := '{"workout_plans": {"workout_plans_release_fkey": [["\"RI_FKey_check_ins\"", 5, "O"], ["\"RI_FKey_check_upd\"", 17, "O"]], "engine_a_schedule_revisions_plan_fkey": [["\"RI_FKey_cascade_del\"", 9, "O"], ["\"RI_FKey_noaction_upd\"", 17, "O"]]}, "engine_a_releases": {"workout_plans_release_fkey": [["\"RI_FKey_noaction_del\"", 9, "O"], ["\"RI_FKey_noaction_upd\"", 17, "O"]]}, "engine_a_schedule_revisions": {"engine_a_schedule_revisions_plan_fkey": [["\"RI_FKey_check_ins\"", 5, "O"], ["\"RI_FKey_check_upd\"", 17, "O"]]}}'::jsonb;
  pure text[] := ARRAY['engine_a_utf8', 'engine_a_planning_digests_v1',
    'engine_a_planning_revision_v1', 'engine_a_valid_planning_digests'];
  r record;
BEGIN
  -- Ledger, by each step's latest action: M2 applied (with the five
  -- catalogs); M3, M4 and M5 not applied.
  SELECT e.evidence -> 'catalog_before' INTO before
    FROM public.engine_a_migration_events e
   WHERE e.step = 'M2' ORDER BY e.id DESC LIMIT 1;
  IF before IS NULL
     OR (SELECT action FROM public.engine_a_migration_events
          WHERE step = 'M2' ORDER BY id DESC LIMIT 1) IS DISTINCT FROM 'applied'
     OR EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (step) step, action
                                 FROM public.engine_a_migration_events
                                WHERE step IN ('M3','M4','M5') ORDER BY step, id DESC) x
                 WHERE x.action = 'applied') THEN
    RETURN NEXT 'ledger: latest M2 row is not applied with a catalog, or a later step is applied';
    RETURN;
  END IF;

  -- Catalog: unchanged except the listed additions and the widened CHECK.
  FOREACH t IN ARRAY ARRAY['profiles','workout_plans','workout_logs','engine_a_schedule_revisions',
                           'engine_a_releases'] LOOP
    b := before -> t;
    a := public.engine_a_table_catalog(('public.' || t)::regclass);
    IF b IS NULL THEN
      RETURN NEXT 'catalog_before missing for ' || t;
      CONTINUE;
    END IF;
    FOREACH k IN ARRAY ARRAY['owner','rls','force_rls','acl','policies'] LOOP
      IF a -> k IS DISTINCT FROM b -> k THEN
        RETURN NEXT t || ': ' || k || ' changed';
      END IF;
    END LOOP;
    IF (a -> 'columns') - ARRAY(SELECT jsonb_array_elements_text(added_cols -> t))
       IS DISTINCT FROM b -> 'columns' THEN
      RETURN NEXT t || ': existing columns changed';
    END IF;
    IF ((a -> 'constraints') - ARRAY(SELECT jsonb_array_elements_text(added_cons -> t)))
         - 'workout_plans_operation_valid'
       IS DISTINCT FROM (b -> 'constraints') - 'workout_plans_operation_valid' THEN
      RETURN NEXT t || ': existing constraints changed';
    END IF;
    IF (a -> 'indexes') - ARRAY(SELECT jsonb_array_elements_text(added_idx -> t))
       IS DISTINCT FROM b -> 'indexes' THEN
      RETURN NEXT t || ': existing indexes changed';
    END IF;
    IF (a -> 'triggers') - ARRAY(SELECT jsonb_array_elements_text(added_trg -> t))
       IS DISTINCT FROM b -> 'triggers' THEN
      RETURN NEXT t || ': existing triggers changed';
    END IF;
    IF a -> 'internal_triggers' IS DISTINCT FROM (b -> 'internal_triggers') || coalesce(added_ri -> t, '{}'::jsonb) THEN
      RETURN NEXT t || ': internal foreign-key triggers differ from the expected set';
    END IF;
    -- Every addition is present.
    FOR r IN SELECT x AS name FROM jsonb_array_elements_text(added_cols -> t) x LOOP
      IF NOT (a -> 'columns') ? r.name THEN RETURN NEXT t || ': missing column ' || r.name; END IF;
    END LOOP;
    FOR r IN SELECT x AS name FROM jsonb_array_elements_text(added_cons -> t) x LOOP
      IF NOT (a -> 'constraints') ? r.name
         OR (a -> 'constraints' -> r.name ->> 'validated') IS DISTINCT FROM 'true' THEN
        RETURN NEXT t || ': missing or unvalidated constraint ' || r.name;
      END IF;
    END LOOP;
    FOR r IN SELECT x AS name FROM jsonb_array_elements_text(added_idx -> t) x LOOP
      IF NOT (a -> 'indexes') ? r.name THEN RETURN NEXT t || ': missing index ' || r.name; END IF;
    END LOOP;
    FOR r IN SELECT x AS name FROM jsonb_array_elements_text(added_trg -> t) x LOOP
      IF (a -> 'triggers' -> r.name ->> 'enabled') IS DISTINCT FROM 'O' THEN
        RETURN NEXT t || ': trigger missing or not enabled ' || r.name;
      END IF;
    END LOOP;
  END LOOP;

  -- Shapes of the additions.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('profiles','planning_field_digests','jsonb','nn'), ('profiles','planning_revision','text','nn'),
      ('workout_plans','plan_source','text',''), ('workout_plans','plan_schema_version','smallint',''),
      ('workout_plans','content_revision','text',''), ('workout_plans','schedule_revision','integer',''),
      ('workout_plans','release_id','text',''), ('workout_plans','manifest_sha256','text',''),
      ('workout_plans','eligibility_id','text',''), ('workout_plans','planning_revision','text',''),
      ('workout_plans','planning_field_digests','jsonb',''), ('workout_plans','attempt_digest','text',''),
      ('workout_logs','content_revision','text',''), ('workout_logs','schedule_revision','integer',''),
      ('workout_logs','session_index','smallint','')) x(tbl, col, typ, gen)
    LEFT JOIN pg_attribute att ON att.attrelid = ('public.' || x.tbl)::regclass
                              AND att.attname = x.col AND NOT att.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = att.attrelid AND d.adnum = att.attnum
   WHERE att.attnum IS NULL
      OR format_type(att.atttypid, att.atttypmod) <> x.typ
      OR att.attnotnull <> (x.gen = 'nn')
      OR att.attgenerated::text <> ''
      OR att.attidentity::text <> ''
      OR att.attacl IS NOT NULL
      OR d.adbin IS NOT NULL) THEN
    RETURN NEXT 'added columns: type, nullability, default, generation or column ACL differs';
  END IF;
  -- profiles maintenance trigger: exact definition, enabled, and the last
  -- BEFORE row trigger on profiles in firing (name, byte) order. The CHECK
  -- profiles_planning_fields_valid guards correctness even if that order
  -- changes later.
  IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
       WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'trg_zz_profile_planning_revision')
     IS DISTINCT FROM 'CREATE TRIGGER trg_zz_profile_planning_revision BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION engine_a_set_planning_revision()'
     OR (SELECT t.tgname FROM pg_trigger t
          WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
            AND (t.tgtype & 2) = 2 AND (t.tgtype & 1) = 1
          ORDER BY t.tgname COLLATE "C" DESC LIMIT 1) IS DISTINCT FROM 'trg_zz_profile_planning_revision' THEN
    RETURN NEXT 'profiles planning trigger differs or is not the last BEFORE row trigger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid IN ('public.profiles'::regclass, 'public.workout_plans'::regclass,
                                  'public.workout_logs'::regclass,
                                  'public.engine_a_schedule_revisions'::regclass,
                                  'public.engine_a_releases'::regclass)
                AND t.tgenabled <> 'O') THEN
    RETURN NEXT 'a trigger (user or internal) on an M2 table is not enabled';
  END IF;
  -- The three new CHECKs, exactly.
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.profiles'::regclass AND c.conname = 'profiles_planning_fields_valid')
     IS DISTINCT FROM 'CHECK (COALESCE(((planning_field_digests = engine_a_planning_digests_v1(age, gender, goal, experience, location, days_per_week, session_duration, equipment, equipment_extras, injuries, health_conditions, priority_muscle)) AND (planning_revision = engine_a_planning_revision_v1(planning_field_digests))), false))' THEN
    RETURN NEXT 'profiles_planning_fields_valid definition differs';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.workout_plans'::regclass AND c.conname = 'workout_plans_provenance_valid')
     IS DISTINCT FROM 'CHECK (COALESCE(
CASE plan_source
    WHEN ''engine_a''::text THEN ((plan_schema_version = 2) AND (content_revision ~ ''^[0-9a-f]{64}$''::text) AND (schedule_revision >= 1) AND (release_id IS NOT NULL) AND (manifest_sha256 IS NOT NULL) AND ((char_length(eligibility_id) >= 1) AND (char_length(eligibility_id) <= 300)) AND engine_a_valid_planning_digests(planning_field_digests) AND (planning_revision = engine_a_planning_revision_v1(planning_field_digests)) AND (attempt_digest ~ ''^[0-9a-f]{64}$''::text) AND (user_id IS NOT NULL) AND (client_attempt_id IS NOT NULL))
    WHEN ''current''::text THEN ((plan_schema_version IS NULL) AND (content_revision IS NULL) AND (schedule_revision IS NULL) AND (release_id IS NULL) AND (manifest_sha256 IS NULL) AND (eligibility_id IS NULL) AND engine_a_valid_planning_digests(planning_field_digests) AND (planning_revision = engine_a_planning_revision_v1(planning_field_digests)) AND ((attempt_digest IS NULL) OR (attempt_digest ~ ''^[0-9a-f]{64}$''::text)))
    ELSE ((plan_source IS NULL) AND (plan_schema_version IS NULL) AND (content_revision IS NULL) AND (schedule_revision IS NULL) AND (release_id IS NULL) AND (manifest_sha256 IS NULL) AND (eligibility_id IS NULL) AND (planning_revision IS NULL) AND (planning_field_digests IS NULL) AND (attempt_digest IS NULL))
END, false))' THEN
    RETURN NEXT 'workout_plans_provenance_valid definition differs';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.workout_logs'::regclass AND c.conname = 'workout_logs_engine_a_identity_valid')
     IS DISTINCT FROM 'CHECK (COALESCE((((content_revision IS NULL) AND (schedule_revision IS NULL) AND (session_index IS NULL)) OR ((content_revision ~ ''^[0-9a-f]{64}$''::text) AND (schedule_revision >= 1) AND ((session_index >= 0) AND (session_index <= 6)) AND (plan_id IS NOT NULL))), false))' THEN
    RETURN NEXT 'workout_logs_engine_a_identity_valid definition differs';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.workout_plans'::regclass AND c.conname = 'workout_plans_operation_valid')
     IS DISTINCT FROM
     'CHECK (((operation IS NULL) OR (operation = ANY (ARRAY[''initial_setup''::text, ''feedback_adjustment''::text, ''safety_regeneration''::text, ''setup_change''::text]))))' THEN
    RETURN NEXT 'workout_plans_operation_valid is not the widened definition';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.workout_plans'::regclass AND c.conname = 'workout_plans_release_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (release_id, manifest_sha256) REFERENCES engine_a_releases(release_id, manifest_sha256)'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
          WHERE c.conrelid = 'public.workout_plans'::regclass AND c.conname = 'workout_plans_id_content_revision_key')
     IS DISTINCT FROM 'UNIQUE (id, content_revision)'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
          WHERE c.conrelid = 'public.engine_a_schedule_revisions'::regclass
            AND c.conname = 'engine_a_schedule_revisions_plan_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (workout_plan_id, content_revision) REFERENCES workout_plans(id, content_revision) ON DELETE CASCADE' THEN
    RETURN NEXT 'a foreign key or the (id, content_revision) key differs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = to_regclass('public.workout_plans_one_active_per_user')
                    AND i.indisunique AND i.indisvalid AND i.indisready
                    AND pg_get_indexdef(i.indexrelid)
                        = 'CREATE UNIQUE INDEX workout_plans_one_active_per_user ON public.workout_plans USING btree (user_id) WHERE (is_active IS TRUE)') THEN
    RETURN NEXT 'workout_plans_one_active_per_user missing, invalid or different';
  END IF;
  IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
       WHERE t.tgrelid = 'public.workout_plans'::regclass AND t.tgname = 'engine_a_plan_provenance_guard')
     IS DISTINCT FROM 'CREATE TRIGGER engine_a_plan_provenance_guard BEFORE INSERT OR UPDATE ON public.workout_plans FOR EACH ROW EXECUTE FUNCTION engine_a_plan_provenance_guard()'
     OR (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
          WHERE t.tgrelid = 'public.workout_logs'::regclass AND t.tgname = 'engine_a_log_identity_guard')
     IS DISTINCT FROM 'CREATE TRIGGER engine_a_log_identity_guard BEFORE INSERT OR UPDATE ON public.workout_logs FOR EACH ROW EXECUTE FUNCTION engine_a_log_identity_guard()' THEN
    RETURN NEXT 'a guard trigger definition differs';
  END IF;

  -- Functions: owner, pinned search_path, not SECURITY DEFINER, exact ACL.
  FOR r IN
    SELECT p.proname, p.oid::regprocedure::text AS sig, p.proowner, p.proconfig, p.prosecdef,
           (SELECT coalesce(jsonb_agg(x.e ORDER BY x.e::text COLLATE "C"), '[]'::jsonb)
              FROM (SELECT jsonb_build_array(
                             CASE WHEN ac.grantee = 0 THEN 'PUBLIC' ELSE ac.grantee::regrole::text END,
                             ac.privilege_type, ac.is_grantable, ac.grantor::regrole::text) AS e
                      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ac) x) AS acl
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('engine_a_utf8','engine_a_planning_digests_v1','engine_a_planning_revision_v1',
                         'engine_a_valid_planning_digests','engine_a_plan_provenance_guard',
                         'engine_a_log_identity_guard','engine_a_table_catalog','engine_a_m2_problems',
                         'engine_a_set_planning_revision')
  LOOP
    IF r.proowner <> 'postgres'::regrole OR r.proconfig IS NULL OR r.prosecdef THEN
      RETURN NEXT 'function owner, search_path or SECURITY DEFINER: ' || r.sig;
    END IF;
    IF r.acl IS DISTINCT FROM
       (CASE WHEN r.proname = ANY (pure)
             THEN '[["PUBLIC", "EXECUTE", false, "postgres"], ["postgres", "EXECUTE", false, "postgres"]]'::jsonb
             ELSE '[["postgres", "EXECUTE", false, "postgres"]]'::jsonb END) THEN
      RETURN NEXT 'function ACL differs: ' || r.sig || ' ' || r.acl::text;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('engine_a_utf8','engine_a_planning_digests_v1','engine_a_planning_revision_v1',
                          'engine_a_valid_planning_digests','engine_a_plan_provenance_guard',
                          'engine_a_log_identity_guard','engine_a_table_catalog','engine_a_m2_problems',
                          'engine_a_set_planning_revision')) <> 9
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('engine_a_utf8','engine_a_planning_digests_v1','engine_a_planning_revision_v1',
                            'engine_a_valid_planning_digests') AND p.provolatile = 'i') <> 4 THEN
    RETURN NEXT 'M2 function count or IMMUTABLE flags differ';
  END IF;

  -- Known-answer test of the projection.
  IF public.engine_a_planning_revision_v1(public.engine_a_planning_digests_v1(
       30, 'male', 'muscle_gain', 'beginner', 'gym', 4, 60, 'full_gym',
       ARRAY['door_anchor', 'band', 'band'], E'left knee \\ pain ''old'' \u00fc', '["none"]', NULL))
     IS DISTINCT FROM 'v1:da09b4b05f09fd2fb4baae423a7529e6933513e01acc14b75d5524f82c463b12' THEN
    RETURN NEXT 'projection known-answer test differs';
  END IF;

  -- No writer exists before M3: every plan and log row is legacy.
  IF EXISTS (SELECT 1 FROM public.workout_plans
              WHERE num_nonnulls(plan_source, plan_schema_version, content_revision,
                      schedule_revision, release_id, manifest_sha256, eligibility_id,
                      planning_revision, planning_field_digests, attempt_digest) <> 0)
     OR EXISTS (SELECT 1 FROM public.workout_logs
                 WHERE num_nonnulls(content_revision, schedule_revision, session_index) <> 0) THEN
    RETURN NEXT 'a plan or log row carries provenance or identity before M3';
  END IF;

  -- Every profile carries valid planning columns.
  IF EXISTS (SELECT 1 FROM public.profiles
              WHERE planning_revision IS NULL OR planning_field_digests IS NULL) THEN
    RETURN NEXT 'a profile has NULL planning columns';
  END IF;

  -- Other invariants.
  IF public.engine_a_routine_baseline()
     IS DISTINCT FROM (SELECT evidence -> 'routines' FROM public.engine_a_migration_events
                        WHERE step = 'M1' AND action = 'applied') THEN
    RETURN NEXT 'plan-writing routines differ from the M1 baseline';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.engine_a_control
                  WHERE id = 1 AND state = 'off' AND NOT admission_enabled) THEN
    RETURN NEXT 'Engine A control is not off';
  END IF;
  RETURN;
END
$fn$;
ALTER FUNCTION public.engine_a_m2_problems() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.engine_a_m2_problems() FROM PUBLIC, anon, authenticated, service_role;


DO $mig$
DECLARE
  v text;
  n bigint;
BEGIN
  SELECT string_agg(p, '; ' ORDER BY p) INTO v FROM public.engine_a_m2_problems() AS p;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: %', v;
  END IF;

  -- Existing values unchanged in every row of the three tables.
  SELECT count(*) INTO n FROM (
    (SELECT t, k, j FROM _m2_rows_before
     EXCEPT
     SELECT 'profiles', p.id::text, to_jsonb(p) - 'planning_field_digests' - 'planning_revision'
       FROM public.profiles p
     EXCEPT
     SELECT 'workout_plans', w.id::text, to_jsonb(w) - 'plan_source' - 'plan_schema_version'
              - 'content_revision' - 'schedule_revision' - 'release_id' - 'manifest_sha256'
              - 'eligibility_id' - 'planning_revision' - 'planning_field_digests' - 'attempt_digest'
       FROM public.workout_plans w
     EXCEPT
     SELECT 'workout_logs', l.id::text, to_jsonb(l) - 'content_revision' - 'schedule_revision'
              - 'session_index'
       FROM public.workout_logs l)
  ) d;
  IF n <> 0 OR EXISTS (SELECT 1 FROM public.workout_plans
                        WHERE num_nonnulls(plan_source, plan_schema_version, content_revision,
                                schedule_revision, release_id, manifest_sha256, eligibility_id,
                                planning_revision, planning_field_digests, attempt_digest) <> 0)
     OR EXISTS (SELECT 1 FROM public.workout_logs
                 WHERE num_nonnulls(content_revision, schedule_revision, session_index) <> 0)
     OR (SELECT count(*) FROM _m2_rows_before)
               <> (SELECT count(*) FROM public.profiles) + (SELECT count(*) FROM public.workout_plans)
                  + (SELECT count(*) FROM public.workout_logs) THEN
    RAISE EXCEPTION 'postcondition failed: % existing rows changed, a legacy row has a provenance or identity value, or row counts differ', n;
  END IF;
END
$mig$;

NOTIFY pgrst, 'reload schema';

COMMIT;
