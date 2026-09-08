-- Reconcile the workout_logs identity columns into migration history.
--
-- These five columns and the partial unique index already exist in the current
-- production database. They were applied directly, outside this directory, so a
-- database built from these migrations alone would not have them. This file
-- closes that gap for new environments. It makes no claim about what has or has
-- not been run anywhere.
--
-- Column shapes and the index predicate below were read back from
-- information_schema.columns and pg_indexes rather than copied from the
-- statement that created them, so this file matches the database as it is.
--
-- All five are nullable with no default. Every existing row keeps NULL and
-- nothing is backfilled: a historical log carries no plan reference and
-- inventing one would be a guess.
--
-- What each column is for, once the writers start sending them:
--   plan_id              the workout_plans row a session came from
--   day_index            position in plan_data.days, the canonical day space
--   plan_exercise_index  position in plan_data.days[i].exercises, the canonical
--                        exercise space. Mobile currently derives its index from
--                        a filtered list, which is the defect C110 P0.1 closes.
--   internal_exercise_id the resolved registry id, or null when a name resolves
--                        to a family, a protocol, or nothing at all
--   client_attempt_id    generated once when a session starts, resent on retry
--
-- No foreign key on plan_id. workout_plans has no CREATE TABLE anywhere in this
-- directory, so a fresh environment would not have the table to reference yet.
-- The key can be added once that gap is closed.
--
-- The unique index is partial on purpose. Every existing row has a NULL attempt
-- id, and a plain unique index would carry no meaning for them. Restricting it
-- to non-null values makes a retry with the same id fail on the second insert,
-- which is what makes the write idempotent rather than merely guarded.

ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS day_index smallint,
  ADD COLUMN IF NOT EXISTS plan_exercise_index smallint,
  ADD COLUMN IF NOT EXISTS internal_exercise_id text,
  ADD COLUMN IF NOT EXISTS client_attempt_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS workout_logs_user_attempt_uniq
  ON public.workout_logs (user_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

-- Rollback, for reference only. Not part of this migration:
--   DROP INDEX IF EXISTS public.workout_logs_user_attempt_uniq;
--   ALTER TABLE public.workout_logs
--     DROP COLUMN IF EXISTS client_attempt_id,
--     DROP COLUMN IF EXISTS internal_exercise_id,
--     DROP COLUMN IF EXISTS plan_exercise_index,
--     DROP COLUMN IF EXISTS day_index,
--     DROP COLUMN IF EXISTS plan_id;
