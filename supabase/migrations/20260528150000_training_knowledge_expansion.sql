-- Expand training_knowledge with NASM, ACE, ISSN, and beginner-safety entries.

INSERT INTO public.training_knowledge (id, content, category)
VALUES
  ('nasm_opt_phase1', 'NASM OPT Phase 1 (Stabilization Endurance): 12 to 20 reps, 1 to 3 sets, slow tempo, low load. Prioritize postural control, balance, and full ROM before any heavy bilateral loading. First 4 to 8 weeks = movement quality, not max strength.', 'NASM'),
  ('nasm_beginner_squat_progression', 'Beginners do NOT start with barbell, goblet, or loaded squats. Progression: sit-to-stand → supported partial squat → step-up → box squat (bodyweight only) → goblet squat after 4+ weeks of clean patterns. Use leg press or hack squat machine before free-weight squat when available.', 'NASM'),
  ('nasm_opt_phase2', 'NASM OPT Phase 2 (Strength Endurance): moderate loads, 8 to 12 reps, supersets or circuits allowed. Introduce loaded squat/hinge patterns only after Phase 1 stability benchmarks — no pain, controlled tempo, symmetrical ROM.', 'NASM'),
  ('ace_ift_beginner', 'ACE IFT model: establish stability and mobility first, then integrated movement, then load. Beginners train movement patterns (push, pull, squat, hinge, rotate, gait) with bodyweight and bands before barbells. Session RPE 4 to 6 for first month.', 'ACE'),
  ('nsca_beginner_resistance', 'NSCA beginner guidelines: 2 to 3 non-consecutive days per week, full-body or upper/lower split, 8 to 15 reps, 1 to 3 sets. Machines and dumbbells preferred over barbells for novices. No 1RM testing until 8 to 12 weeks of consistent training.', 'NSCA'),
  ('issn_recovery', 'ISSN position: 1.6 to 2.2 g protein per kg bodyweight for active adults; sleep 7 to 9 h; 48 to 72 h between hard sessions for same muscle groups. Recovery is programming — not optional add-on.', 'ISSN'),
  ('acsm_neuromotor', 'ACSM neuromotor training: include balance and proprioception 2 to 3 days per week for beginners and older adults — single-leg stands, tandem walk, controlled step-ups before advanced unilateral loading.', 'ACSM'),
  ('nsca_exercise_variety', 'Rotate exercises within the same movement pattern every 3 to 4 weeks while keeping progressive overload on key lifts. Avoid prescribing identical exercise lists session after session — vary accessories, angles, and unilateral work while maintaining periodization structure.', 'NSCA'),
  ('acsm_warmup_protocol', 'General warm-up 5 to 10 min: raise heart rate, dynamic mobility for session patterns, activation drills (glute bridges before hinges, band pull-aparts before pulls). Specific warm-up sets before working loads. Cool-down 5 min static stretch for worked muscles.', 'ACSM'),
  ('who_desk_breaks', 'WHO: reduce sedentary time; break sitting every 30 to 60 minutes. Desk programs = hip flexor stretch, thoracic rotation, scapular retraction, diaphragmatic breathing, march in place — never heavy squat or deadlift in desk breaks.', 'WHO')
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  category = EXCLUDED.category;
