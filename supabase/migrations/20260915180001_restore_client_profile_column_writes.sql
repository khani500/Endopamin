-- ROLLBACK for 20260915180000_restrict_client_profile_column_writes.sql
--
-- Restores the table-level INSERT and UPDATE grants that anon and
-- authenticated held before that migration, and removes the column-level
-- grants it created.
--
-- Run this ONLY to undo. It reopens the hole that lets any logged-in client
-- write is_pro, the Stripe columns and every prescription input directly.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Drop the column-level grants created by the forward migration.
REVOKE INSERT (id, display_name)
  ON public.profiles FROM anon, authenticated;

REVOKE UPDATE (
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
) ON public.profiles FROM anon, authenticated;

-- Restore the original table-level grants.
GRANT INSERT, UPDATE ON public.profiles TO anon, authenticated;

COMMIT;