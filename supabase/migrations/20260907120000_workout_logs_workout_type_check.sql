-- Reconcile the workout_logs.workout_type vocabulary constraint into migration
-- history.
--
-- The constraint already exists in the current production database and is
-- validated there. It was added outside this directory, so a database built
-- from these migrations alone would not have it. This file closes that gap for
-- new environments; it makes no claim about what has or has not been run
-- anywhere.
--
-- The guard is deliberate: where the constraint is already present this file
-- must not drop or rebuild it, because doing so would take an ACCESS EXCLUSIVE
-- lock and briefly leave the table unprotected. NOT VALID followed by a
-- separate VALIDATE keeps the first statement's lock short and lets the scan
-- run under SHARE UPDATE EXCLUSIVE, which does not block readers or writers.
--
-- workout_type stays nullable. Every row written before the column was used
-- carries NULL and must remain valid. No default, no backfill, no UPDATE, no
-- DELETE, no RLS change and no index change.
--
-- Vocabulary: strength, cardio, mobility, hiit are countable training types;
-- desk_break is stored but is excluded from workout counts by the Progress
-- read filters rather than by this constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.workout_logs'::regclass
      AND conname = 'workout_logs_workout_type_check'
  ) THEN
    ALTER TABLE public.workout_logs
      ADD CONSTRAINT workout_logs_workout_type_check
      CHECK (
        workout_type IS NULL
        OR workout_type IN (
          'strength',
          'cardio',
          'mobility',
          'hiit',
          'desk_break'
        )
      )
      NOT VALID;
  END IF;
END
$$;

-- Safe to repeat: validating an already validated constraint is a no-op.
ALTER TABLE public.workout_logs
  VALIDATE CONSTRAINT workout_logs_workout_type_check;

-- Rollback, for reference only. Not part of this migration:
--   ALTER TABLE public.workout_logs
--     DROP CONSTRAINT workout_logs_workout_type_check;
