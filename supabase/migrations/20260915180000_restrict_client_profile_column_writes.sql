-- M2 commit 6 — restrict client writes to generation-relevant profile columns.
--
-- RLS protects the ROW (auth.uid() = id) but not the COLUMN, so any logged-in
-- client can currently write is_pro, the Stripe columns, and every prescription
-- input directly with the anon key. /api/save-profile is the only sanctioned
-- writer for prescription columns; it uses SUPABASE_SERVICE_ROLE_KEY and is
-- unaffected by anything below.
--
-- A table-level grant defeats a column-level REVOKE silently, so INSERT and
-- UPDATE are revoked WHOLESALE first, then granted back column by column.
-- This is an allow-list: any column omitted below is locked.
--
-- NOTE: a Postgres column privilege is checked when the column is MENTIONED,
-- not when its value changes. Sending a key with an explicit null still
-- requires the privilege.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Remove the table-level grants that would mask column-level control.
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;

-- 2. INSERT: only what signup needs to create the row.
GRANT INSERT (id, display_name)
  ON public.profiles TO anon, authenticated;

-- 3. UPDATE: only columns the client legitimately owns.
--    Excluded on purpose: all prescription inputs, is_pro, the Stripe
--    columns, field_provenance, plan_setup, last_notification_at, and the
--    four coach_* columns (their only writer was the paused PWA).
GRANT UPDATE (
  display_name,
  dopa_xp,
  dopa_level,
  streak_count,
  last_active,
  onboarding_completed,
  fcm_token,
  last_feedback_week,
  steps_goal,
  active_calories_goal
) ON public.profiles TO anon, authenticated;

-- SELECT and DELETE are deliberately untouched; RLS already scopes them.
-- service_role and postgres are deliberately untouched.

COMMIT;