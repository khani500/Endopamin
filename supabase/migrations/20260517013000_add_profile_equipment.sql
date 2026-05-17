ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS equipment JSONB DEFAULT '[]'::jsonb;
