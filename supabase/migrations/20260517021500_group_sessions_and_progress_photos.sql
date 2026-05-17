CREATE TABLE IF NOT EXISTS public.group_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) UNIQUE,
  name TEXT,
  workout_type TEXT,
  coach_persona TEXT,
  host_id UUID REFERENCES public.profiles(id),
  scheduled_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_session_members (
  session_id UUID REFERENCES public.group_sessions(id),
  user_id UUID REFERENCES public.profiles(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);

ALTER TABLE public.body_metrics
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

ALTER TABLE public.group_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_session_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'group_sessions' AND policyname = 'Users can manage hosted group sessions') THEN
    CREATE POLICY "Users can manage hosted group sessions" ON public.group_sessions
      FOR ALL USING (auth.uid() = host_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'group_session_members' AND policyname = 'Users can manage own group membership') THEN
    CREATE POLICY "Users can manage own group membership" ON public.group_session_members
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;
