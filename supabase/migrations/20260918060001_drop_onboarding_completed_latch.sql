-- Rollback for 20260918060000_protect_onboarding_completed_latch.sql
--
-- NOT EXECUTED. Kept so the latch can be removed deliberately rather than by
-- editing production by hand. Dropping it makes onboarding_completed clearable
-- by any athlete JWT again, which is what trapped an athlete in onboarding on
-- build 1.0.2 (14). Do not run this to "unblock" a client write; fix the
-- client, or move the column to /api/save-profile as recorded in the forward
-- migration.

drop trigger if exists trg_protect_onboarding_completed_latch on public.profiles;
drop function if exists public.protect_onboarding_completed_latch();
