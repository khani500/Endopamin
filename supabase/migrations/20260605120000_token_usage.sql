CREATE TABLE IF NOT EXISTS public.token_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS token_usage_user_id_idx
  ON public.token_usage (user_id);

ALTER TABLE public.token_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'token_usage' AND policyname = 'Users can read own token usage'
  ) THEN
    CREATE POLICY "Users can read own token usage"
      ON public.token_usage FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'token_usage' AND policyname = 'Users can insert own token usage'
  ) THEN
    CREATE POLICY "Users can insert own token usage"
      ON public.token_usage FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'token_usage' AND policyname = 'Users can update own token usage'
  ) THEN
    CREATE POLICY "Users can update own token usage"
      ON public.token_usage FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
