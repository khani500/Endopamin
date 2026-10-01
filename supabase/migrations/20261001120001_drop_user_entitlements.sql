-- 20261001120001_drop_user_entitlements.sql
-- Run this ONLY to undo 20261001120000_user_entitlements.sql.
-- UNEXECUTED. Manual rollback only. Do not supabase db push. Do not apply this
-- file together with the forward migration. Apply in the SQL Editor only to
-- undo 20261001120000, after review.
-- The reverse file must NEVER be executed as part of a sequential migration
-- run. This repo's production migrations are applied one at a time by hand
-- in the SQL Editor. supabase db push is never run against production.
--
-- DEPLOY ORDER: roll the api/ that contains api/_entitlement.js back FIRST.
-- After this file the reconciling webhook and api/entitlement-sync cannot
-- write and will return 500 / 503.
--
-- DATA LOSS ON ROLLBACK: every public.user_entitlements row is dropped. The
-- rows are a projection of RevenueCat and are rebuilt by reconciliation after
-- the forward migration is applied again. public.profiles is NOT touched:
-- is_pro and pro_expires_at keep their current values.
--
-- ATOMIC. One explicit transaction. Any raised exception rolls back everything
-- this file did in the same run.
--
-- IDEMPOTENT. If public.user_entitlements is already absent, nothing is
-- dropped and the AFTER assertion still runs.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- No CASCADE: an unexpected dependent object aborts the rollback instead of
-- being dropped silently. The policy goes with the table.
DROP TABLE IF EXISTS public.user_entitlements;

DO $mig$
BEGIN
  IF to_regclass('public.user_entitlements') IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: public.user_entitlements still exists';
  END IF;
END
$mig$;

NOTIFY pgrst, 'reload schema';

COMMIT;
