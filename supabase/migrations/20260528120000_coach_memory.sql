-- Aria coach persistent memory (per user, per coach)

CREATE TABLE IF NOT EXISTS public.coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL,
  memory JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, coach_id)
);

CREATE INDEX IF NOT EXISTS coach_memory_user_coach_idx
  ON public.coach_memory (user_id, coach_id);

ALTER TABLE public.coach_memory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'Users can read own coach memory'
  ) THEN
    CREATE POLICY "Users can read own coach memory"
      ON public.coach_memory FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'Users can insert own coach memory'
  ) THEN
    CREATE POLICY "Users can insert own coach memory"
      ON public.coach_memory FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'Users can update own coach memory'
  ) THEN
    CREATE POLICY "Users can update own coach memory"
      ON public.coach_memory FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_memory' AND policyname = 'Users can delete own coach memory'
  ) THEN
    CREATE POLICY "Users can delete own coach memory"
      ON public.coach_memory FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
