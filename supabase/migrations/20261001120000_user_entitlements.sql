-- 20261001120000_user_entitlements.sql
-- UNEXECUTED. This file is in the tree for review. It has not been applied to
-- any database. Do not supabase db push. Apply in the SQL Editor after review.
-- Reverse: 20261001120001_drop_user_entitlements.sql
-- The reverse file must NEVER be executed as a sequential follow-on. This
-- repo's production migrations are applied one at a time by hand in the SQL
-- Editor. supabase db push is never run against production.
-- Post-apply check: VERIFY_user_entitlements.sql (read-only).
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the api/ that contains
-- api/_entitlement.js. The reconciling webhook writes this table first; without
-- it every RevenueCat webhook call fails and returns 500.
--
-- Creates public.user_entitlements: the server-written projection of each
-- user's current RevenueCat "pro" entitlement. One row per user.
--   writes: service_role only (the Vercel API). No client write path exists:
--           no INSERT/UPDATE/DELETE policy and no such grant.
--   reads:  an authenticated user can SELECT only their own row.
-- It never stores raw RevenueCat payloads, tokens, or secrets.
--
-- Effective access = active AND (access_expires_at IS NULL OR
-- access_expires_at > now()). access_expires_at already includes any grace
-- period; the API computes it.
--
-- public.profiles is NOT touched: no column, grant, trigger, or policy changes.
-- No existing row in any table is written.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back
-- everything this file did in the same run.
--
-- NOT IDEMPOTENT ON PURPOSE. If public.user_entitlements already exists the
-- file fails closed before changing anything.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------
-- 1. PRESENT STATE, FAIL CLOSED.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  r text;
BEGIN
  IF to_regclass('public.user_entitlements') IS NOT NULL THEN
    RAISE EXCEPTION 'precondition failed: public.user_entitlements already exists';
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'precondition failed: auth.users does not exist';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'precondition failed: auth.uid() does not exist; the select-own policy has no caller identity';
  END IF;

  FOREACH r IN ARRAY ARRAY['service_role', 'anon', 'authenticated'] LOOP
    IF to_regrole(quote_ident(r)) IS NULL THEN
      RAISE EXCEPTION 'precondition failed: role % does not exist', r;
    END IF;
  END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. TABLE.
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_entitlements (
  user_id             uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  entitlement         text        NOT NULL DEFAULT 'pro' CHECK (entitlement = 'pro'),
  active              boolean     NOT NULL,
  access_expires_at   timestamptz NULL,
  store               text        NULL,
  environment         text        NULL CHECK (environment IN ('production', 'sandbox')),
  product_id          text        NULL,
  subscription_status text        NULL,
  last_sync_source    text        NOT NULL CHECK (last_sync_source IN ('webhook', 'app_sync')),
  last_event_type     text        NULL,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY AND PRIVILEGES.
--    The REVOKE removes whatever the project's default privileges handed to
--    PUBLIC, anon and authenticated when the table was created.
--    service_role bypasses RLS but still needs table privileges; they are
--    granted explicitly so the API's writes never depend on default privileges.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_entitlements FROM PUBLIC;
REVOKE ALL ON TABLE public.user_entitlements FROM anon;
REVOKE ALL ON TABLE public.user_entitlements FROM authenticated;

GRANT SELECT ON TABLE public.user_entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_entitlements TO service_role;

CREATE POLICY "user_entitlements_select_own"
  ON public.user_entitlements
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. AFTER ASSERTIONS.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  rel_oid oid := to_regclass('public.user_entitlements');
  rel     record;
  pol     record;
  n       integer;
  priv    text;
BEGIN
  IF rel_oid IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: public.user_entitlements is absent';
  END IF;

  SELECT c.relkind, c.relrowsecurity INTO rel FROM pg_class c WHERE c.oid = rel_oid;
  IF rel.relkind <> 'r' THEN
    RAISE EXCEPTION 'postcondition failed: user_entitlements has relkind %, expected an ordinary table', rel.relkind;
  END IF;
  IF NOT rel.relrowsecurity THEN
    RAISE EXCEPTION 'postcondition failed: row level security is not enabled on public.user_entitlements';
  END IF;

  SELECT count(*) INTO n
    FROM pg_attribute a
   WHERE a.attrelid = rel_oid AND a.attnum > 0 AND NOT a.attisdropped;
  IF n <> 13 THEN
    RAISE EXCEPTION 'postcondition failed: public.user_entitlements has % columns, expected 13', n;
  END IF;

  -- Exactly one policy: select-own, for authenticated only.
  SELECT count(*) INTO n FROM pg_policy p WHERE p.polrelid = rel_oid;
  IF n <> 1 THEN
    RAISE EXCEPTION 'postcondition failed: % policies on public.user_entitlements, expected exactly one', n;
  END IF;

  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles, p.polwithcheck,
         pg_get_expr(p.polqual, p.polrelid) AS qual
    INTO pol
    FROM pg_policy p
   WHERE p.polrelid = rel_oid;

  IF pol.polname <> 'user_entitlements_select_own'
     OR pol.polcmd <> 'r'
     OR NOT pol.polpermissive
     OR pol.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
     OR pol.polwithcheck IS NOT NULL
     OR pol.qual IS NULL THEN
    RAISE EXCEPTION 'postcondition failed: policy is % (cmd %, roles %, qual %), expected user_entitlements_select_own FOR SELECT TO authenticated',
      pol.polname, pol.polcmd, pol.polroles, pol.qual;
  END IF;

  -- No grant to PUBLIC.
  SELECT count(*) INTO n
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = rel_oid AND a.grantee = 0;
  IF n <> 0 THEN
    RAISE EXCEPTION 'postcondition failed: % privilege(s) on public.user_entitlements are granted to PUBLIC', n;
  END IF;

  -- anon: nothing. authenticated: SELECT only.
  FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', rel_oid, priv) THEN
      RAISE EXCEPTION 'postcondition failed: anon has % on public.user_entitlements', priv;
    END IF;
    IF priv <> 'SELECT' AND has_table_privilege('authenticated', rel_oid, priv) THEN
      RAISE EXCEPTION 'postcondition failed: authenticated has % on public.user_entitlements', priv;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('authenticated', rel_oid, 'SELECT') THEN
    RAISE EXCEPTION 'postcondition failed: authenticated lacks SELECT on public.user_entitlements';
  END IF;

  -- The server can read and write.
  FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT has_table_privilege('service_role', rel_oid, priv) THEN
      RAISE EXCEPTION 'postcondition failed: service_role lacks % on public.user_entitlements', priv;
    END IF;
  END LOOP;
END
$mig$;

-- PostgREST caches the schema; the new table is invisible to /rest/v1 until
-- it reloads. NOTIFY is transactional: delivered only when this commits.
NOTIFY pgrst, 'reload schema';

COMMIT;
