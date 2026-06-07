CREATE TABLE IF NOT EXISTS public.nutrition_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_data JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nutrition_plans_user_active_idx
  ON public.nutrition_plans (user_id, is_active, generated_at DESC);

ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nutrition_plans' AND policyname = 'Users manage own nutrition plans'
  ) THEN
    CREATE POLICY "Users manage own nutrition plans"
      ON public.nutrition_plans FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;
