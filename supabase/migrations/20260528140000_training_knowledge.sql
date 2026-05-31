-- Curated training-science knowledge base for coach prompt injection.

CREATE TABLE IF NOT EXISTS public.training_knowledge (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  topics TEXT[] NOT NULL DEFAULT '{}',
  environments TEXT[] NOT NULL DEFAULT '{}',
  levels TEXT[] NOT NULL DEFAULT '{}',
  goal_tags TEXT[] NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.training_knowledge ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_knowledge'
      AND policyname = 'Authenticated users can read training knowledge'
  ) THEN
    CREATE POLICY "Authenticated users can read training knowledge"
      ON public.training_knowledge FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

INSERT INTO public.training_knowledge (id, source, topics, environments, levels, goal_tags, summary)
VALUES
  ('nsca_periodization', 'NSCA', ARRAY['periodization','programming','progressive_overload'], ARRAY['gym','home'], ARRAY['beginner','intermediate','advanced'], ARRAY['strength_gain','maintenance','weight_loss'], 'Use 4 to 6 week mesocycles with planned progression: accumulate volume, then intensity, then deload. Each session should advance a clear variable — load, reps, sets, tempo, or rest — not random exercise swaps.'),
  ('nsca_rpe_loading', 'NSCA', ARRAY['rpe','intensity','autoregulation'], ARRAY['gym','home'], ARRAY['intermediate','advanced'], ARRAY['strength_gain','maintenance'], 'Prescribe working sets using RPE 6 to 9 or RIR 1 to 3 for intermediates and advanced athletes. Beginners stay RPE 6 to 7 with technique focus. Reduce load when bar speed drops or form breaks — autoregulate within the block.'),
  ('nasm_opt_progression', 'NASM', ARRAY['progression','stabilization','movement_quality'], ARRAY['gym','home'], ARRAY['beginner','intermediate'], ARRAY['weight_loss','maintenance','strength_gain'], 'Progress stability before load: master posture and range of motion, then add resistance, then power or speed. Beginners need regressions — reduce range, slow tempo, or unilateral support — before advancing to heavy bilateral lifts.'),
  ('nasm_corrective', 'NASM', ARRAY['injury','mobility','activation'], ARRAY['gym','home','desk'], ARRAY['beginner','intermediate','advanced'], ARRAY['maintenance','weight_loss','strength_gain'], 'Warm-ups should include tissue mobility and activation for the session pattern — hip hinge days need glute and hamstring activation; push days need scapular stability. Substitute movements that aggravate reported injuries.'),
  ('acsm_volume', 'ACSM', ARRAY['volume','frequency','hypertrophy'], ARRAY['gym','home'], ARRAY['beginner','intermediate','advanced'], ARRAY['weight_loss','maintenance','strength_gain'], 'Most adults need 150 min moderate or 75 min vigorous activity weekly plus 2 strength sessions. Hypertrophy: 6 to 20 reps per set, 2 to 4 sets, 48 to 72 h recovery per muscle group. Match weekly volume to experience and recovery capacity.'),
  ('acsm_beginner', 'ACSM', ARRAY['beginner','safety','progression'], ARRAY['gym','home'], ARRAY['beginner'], ARRAY['weight_loss','maintenance','strength_gain'], 'Novices adapt to motor learning first — 2 to 3 full-body sessions weekly, 8 to 15 reps, moderate load. Avoid maximal singles and advanced plyometrics until technique and work capacity are established over 4 to 8 weeks.'),
  ('acsm_desk_sedentary', 'ACSM', ARRAY['desk','sedentary','mobility','neat'], ARRAY['desk'], ARRAY['beginner','intermediate','advanced'], ARRAY['weight_loss','maintenance'], 'Break prolonged sitting every 30 to 60 minutes with 2 to 5 minutes of standing, walking, or mobility. Desk sessions target hip flexors, thoracic spine, posterior chain, and breathing — not high-intensity lifting.'),
  ('who_activity', 'WHO', ARRAY['desk','health','recovery'], ARRAY['desk','home'], ARRAY['beginner','intermediate','advanced'], ARRAY['weight_loss','maintenance'], 'Any movement is better than none — short bouts accumulate. For desk workers, prioritize daily low-intensity activity plus brief strength or mobility snacks. Sleep and stress management are part of the training plan, not optional.'),
  ('nsca_home_adaptation', 'NSCA', ARRAY['home','equipment','progression'], ARRAY['home'], ARRAY['beginner','intermediate','advanced'], ARRAY['strength_gain','maintenance','weight_loss'], 'Home training uses leverage, tempo, pauses, and unilateral work to progress without barbells. Bands and dumbbells enable row, hinge, squat, and push patterns. Track reps and difficulty — not just exercise names.'),
  ('nsca_strength_peaking', 'NSCA', ARRAY['strength','periodization','loading'], ARRAY['gym'], ARRAY['advanced'], ARRAY['strength_gain'], 'Advanced strength blocks use specific intensities — 70 to 85 percent for volume work, 85 to 95 percent for peaking phases — with planned deloads every 4 to 6 weeks. Accessories support weak links in the competition or primary lifts.')
ON CONFLICT (id) DO UPDATE SET
  source = EXCLUDED.source,
  topics = EXCLUDED.topics,
  environments = EXCLUDED.environments,
  levels = EXCLUDED.levels,
  goal_tags = EXCLUDED.goal_tags,
  summary = EXCLUDED.summary,
  updated_at = NOW();
