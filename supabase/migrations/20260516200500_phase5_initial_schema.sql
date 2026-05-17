-- Endopamin Phase 5 — Supabase initial production schema.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  display_name TEXT,
  age INTEGER,
  experience TEXT CHECK (experience IN ('beginner', 'intermediate', 'advanced')),
  goal TEXT CHECK (goal IN ('weight_loss', 'strength_gain', 'maintenance')),
  days_per_week INTEGER,
  time_available TEXT,
  coach_persona TEXT CHECK (coach_persona IN ('elias', 'maya', 'rex')),
  dopa_level INTEGER DEFAULT 1,
  dopa_xp INTEGER DEFAULT 0,
  streak_count INTEGER DEFAULT 0,
  last_active DATE,
  is_pro BOOLEAN DEFAULT false,
  job_type TEXT CHECK (job_type IN ('active', 'desk_worker', 'mixed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workout_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  workout_type TEXT,
  duration_minutes INTEGER,
  exercises JSONB,
  calories_burned INTEGER,
  notes TEXT,
  coach_feedback TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personal_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  exercise_name TEXT,
  weight_kg DECIMAL,
  reps INTEGER,
  estimated_1rm DECIMAL,
  recorded_at DATE DEFAULT CURRENT_DATE,
  UNIQUE(user_id, exercise_name, recorded_at)
);

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  meal_name TEXT,
  calories INTEGER,
  protein_g DECIMAL,
  carbs_g DECIMAL,
  fat_g DECIMAL,
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  image_url TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  energy_level INTEGER CHECK (energy_level BETWEEN 1 AND 5),
  sleep_quality BOOLEAN,
  mood TEXT,
  coach_response TEXT,
  checkin_date DATE DEFAULT CURRENT_DATE,
  UNIQUE(user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  weight_kg DECIMAL,
  body_fat_percent DECIMAL,
  recorded_at DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id UUID REFERENCES profiles(id) PRIMARY KEY,
  fcm_token TEXT,
  streak_reminder BOOLEAN DEFAULT true,
  streak_reminder_time TIME DEFAULT '19:00',
  morning_coach BOOLEAN DEFAULT true,
  morning_time TIME DEFAULT '08:00',
  desk_breaks BOOLEAN DEFAULT false,
  desk_break_interval INTEGER DEFAULT 60,
  group_session_reminder BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS workout_logs_user_logged_at_idx
  ON workout_logs (user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS nutrition_logs_user_logged_at_idx
  ON nutrition_logs (user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS daily_checkins_user_date_idx
  ON daily_checkins (user_id, checkin_date DESC);

CREATE INDEX IF NOT EXISTS body_metrics_user_recorded_at_idx
  ON body_metrics (user_id, recorded_at DESC);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users see own data') THEN
    CREATE POLICY "Users see own data" ON profiles FOR ALL USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workout_logs' AND policyname = 'Users see own data') THEN
    CREATE POLICY "Users see own data" ON workout_logs FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'personal_records' AND policyname = 'Users see own data') THEN
    CREATE POLICY "Users see own data" ON personal_records FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nutrition_logs' AND policyname = 'Users see own data') THEN
    CREATE POLICY "Users see own data" ON nutrition_logs FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_checkins' AND policyname = 'Users see own data') THEN
    CREATE POLICY "Users see own data" ON daily_checkins FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'body_metrics' AND policyname = 'Users see own data') THEN
    CREATE POLICY "Users see own data" ON body_metrics FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_settings' AND policyname = 'Users see own data') THEN
    CREATE POLICY "Users see own data" ON notification_settings FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

