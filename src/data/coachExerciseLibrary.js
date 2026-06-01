// ============================================================
// ENDOPAMIN — Comprehensive Exercise Library
// 250+ exercises | Gym · Home · Desk Break
// Fields: id, name, category, subcategory, muscleGroups,
//         equipment, level, setting, regressions, progressions,
//         cues, sets, reps, rest, calories_est
// ============================================================

export const EXERCISE_SETTINGS = {
  GYM: 'gym',
  HOME: 'home',
  DESK: 'desk'
};

export const LEVELS = {
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced'
};

export const EXERCISE_LIBRARY = [

  // ============================================================
  // 🏋️ GYM EXERCISES (Machine + Free Weight + Cable)
  // ============================================================

  // --- SQUAT PATTERN ---
  {
    id: 'gym_sq_001', name: 'Leg Press (Machine)', category: 'squat', subcategory: 'machine',
    muscleGroups: ['quads', 'glutes', 'hamstrings'], equipment: ['leg press machine'],
    level: 'beginner', setting: 'gym',
    regressions: ['sit_to_stand'], progressions: ['gym_sq_002', 'gym_sq_003'],
    cues: ['Feet shoulder-width on plate', 'Lower to 90° knee angle', 'Drive through heels', 'Don\'t lock knees at top'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_sq_002', name: 'Goblet Squat (Dumbbell)', category: 'squat', subcategory: 'free_weight',
    muscleGroups: ['quads', 'glutes', 'core'], equipment: ['dumbbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_sq_001'], progressions: ['gym_sq_003', 'gym_sq_004'],
    cues: ['Hold DB at chest', 'Elbows inside knees at bottom', 'Chest up', 'Full depth'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 7
  },
  {
    id: 'gym_sq_003', name: 'Barbell Back Squat', category: 'squat', subcategory: 'free_weight',
    muscleGroups: ['quads', 'glutes', 'hamstrings', 'core', 'upper_back'], equipment: ['barbell', 'squat rack'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_sq_002'], progressions: ['gym_sq_004', 'gym_sq_005'],
    cues: ['Bar on traps', 'Brace core', 'Break at hips and knees simultaneously', 'Drive knees out'],
    sets: '4', reps: '6-10', rest: '90s', calories_est: 9
  },
  {
    id: 'gym_sq_004', name: 'Barbell Front Squat', category: 'squat', subcategory: 'free_weight',
    muscleGroups: ['quads', 'core', 'upper_back'], equipment: ['barbell', 'squat rack'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_sq_003'], progressions: ['gym_sq_005'],
    cues: ['Elbows high', 'Upright torso', 'Full depth', 'Drive knees out'],
    sets: '4', reps: '5-8', rest: '120s', calories_est: 10
  },
  {
    id: 'gym_sq_005', name: 'Hack Squat (Machine)', category: 'squat', subcategory: 'machine',
    muscleGroups: ['quads', 'glutes'], equipment: ['hack squat machine'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_sq_001'], progressions: ['gym_sq_004'],
    cues: ['Feet low on platform for quads', 'Full range of motion', 'Control descent'],
    sets: '3', reps: '10-12', rest: '75s', calories_est: 8
  },
  {
    id: 'gym_sq_006', name: 'Bulgarian Split Squat', category: 'squat', subcategory: 'free_weight',
    muscleGroups: ['quads', 'glutes', 'hamstrings'], equipment: ['dumbbell', 'bench'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_lu_001'], progressions: ['gym_sq_003'],
    cues: ['Rear foot elevated', 'Front foot far enough forward', 'Vertical shin', 'Lower knee toward floor'],
    sets: '3', reps: '8-10 each', rest: '75s', calories_est: 8
  },
  {
    id: 'gym_sq_007', name: 'Smith Machine Squat', category: 'squat', subcategory: 'machine',
    muscleGroups: ['quads', 'glutes'], equipment: ['smith machine'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_sq_001'], progressions: ['gym_sq_003'],
    cues: ['Feet slightly forward', 'Control the descent', 'Full range of motion'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 7
  },
  {
    id: 'gym_sq_008', name: 'Sumo Squat (Dumbbell)', category: 'squat', subcategory: 'free_weight',
    muscleGroups: ['inner_thighs', 'glutes', 'quads'], equipment: ['dumbbell'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_sq_001'], progressions: ['gym_sq_002'],
    cues: ['Wide stance, toes out', 'Hold DB between legs', 'Keep chest up', 'Push knees out'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_sq_009', name: 'Sissy Squat', category: 'squat', subcategory: 'bodyweight',
    muscleGroups: ['quads'], equipment: ['support pole'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_sq_005'], progressions: [],
    cues: ['Lean back as you lower', 'Knees travel forward', 'Control entire range'],
    sets: '3', reps: '8-12', rest: '90s', calories_est: 7
  },

  // --- HINGE PATTERN ---
  {
    id: 'gym_hi_001', name: 'Romanian Deadlift (Dumbbell)', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['hamstrings', 'glutes', 'lower_back'], equipment: ['dumbbell'],
    level: 'beginner', setting: 'gym',
    regressions: ['home_gl_001'], progressions: ['gym_hi_002', 'gym_hi_003'],
    cues: ['Soft knee bend', 'Push hips back', 'Bar close to legs', 'Feel stretch in hamstrings'],
    sets: '3', reps: '10-12', rest: '75s', calories_est: 7
  },
  {
    id: 'gym_hi_002', name: 'Barbell Romanian Deadlift', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['hamstrings', 'glutes', 'lower_back'], equipment: ['barbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hi_001'], progressions: ['gym_hi_003'],
    cues: ['Double overhand grip', 'Proud chest', 'Hinge at hips', 'Control descent'],
    sets: '4', reps: '8-10', rest: '90s', calories_est: 9
  },
  {
    id: 'gym_hi_003', name: 'Conventional Deadlift', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['hamstrings', 'glutes', 'lower_back', 'traps', 'core'], equipment: ['barbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hi_002'], progressions: ['gym_hi_004'],
    cues: ['Bar over mid-foot', 'Hips hinge back', 'Lats tight', 'Drive floor away'],
    sets: '4', reps: '5-8', rest: '120s', calories_est: 11
  },
  {
    id: 'gym_hi_004', name: 'Sumo Deadlift', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['inner_thighs', 'glutes', 'hamstrings', 'lower_back'], equipment: ['barbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hi_003'], progressions: ['gym_hi_005'],
    cues: ['Wide stance', 'Toes pointed out', 'Hips close to bar', 'Drive knees out'],
    sets: '4', reps: '5-8', rest: '120s', calories_est: 11
  },
  {
    id: 'gym_hi_005', name: 'Trap Bar Deadlift', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['quads', 'glutes', 'hamstrings', 'traps'], equipment: ['trap bar'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_hi_001'], progressions: ['gym_hi_003'],
    cues: ['Stand inside bar', 'Neutral spine', 'Push floor away', 'Stand tall at top'],
    sets: '3', reps: '8-10', rest: '90s', calories_est: 10
  },
  {
    id: 'gym_hi_006', name: 'Good Morning (Barbell)', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['hamstrings', 'glutes', 'lower_back'], equipment: ['barbell'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_hi_002'], progressions: [],
    cues: ['Bar on traps', 'Soft knees', 'Hinge until parallel', 'Drive hips forward to stand'],
    sets: '3', reps: '8-10', rest: '90s', calories_est: 8
  },
  {
    id: 'gym_hi_007', name: 'Single-Leg Romanian Deadlift', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['hamstrings', 'glutes', 'core'], equipment: ['dumbbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hi_001'], progressions: ['gym_hi_002'],
    cues: ['Hip-width stance', 'Hinge as rear leg rises', 'Keep hips square', 'Slight knee bend'],
    sets: '3', reps: '8-10 each', rest: '75s', calories_est: 7
  },
  {
    id: 'gym_hi_008', name: 'Kettlebell Swing', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['glutes', 'hamstrings', 'core', 'shoulders'], equipment: ['kettlebell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hi_001'], progressions: ['gym_hi_009'],
    cues: ['Hike KB back', 'Explosive hip snap', 'Arms float from hip drive', 'Squeeze glutes at top'],
    sets: '4', reps: '15-20', rest: '60s', calories_est: 12
  },
  {
    id: 'gym_hi_009', name: 'Kettlebell Clean', category: 'hinge', subcategory: 'free_weight',
    muscleGroups: ['glutes', 'hamstrings', 'core', 'traps'], equipment: ['kettlebell'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_hi_008'], progressions: [],
    cues: ['Pull KB close to body', 'Rotate elbow around KB', 'Catch in rack position', 'Absorb with hips'],
    sets: '3', reps: '5-8 each', rest: '90s', calories_est: 10
  },

  // --- HORIZONTAL PUSH ---
  {
    id: 'gym_hp_001', name: 'Chest Press (Machine)', category: 'horizontal_push', subcategory: 'machine',
    muscleGroups: ['chest', 'triceps', 'shoulders'], equipment: ['chest press machine'],
    level: 'beginner', setting: 'gym',
    regressions: ['home_pu_001'], progressions: ['gym_hp_002', 'gym_hp_003'],
    cues: ['Seat height so handles at chest', 'Drive through palms', 'Full extension without locking', 'Control return'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_hp_002', name: 'Dumbbell Bench Press', category: 'horizontal_push', subcategory: 'free_weight',
    muscleGroups: ['chest', 'triceps', 'shoulders'], equipment: ['dumbbell', 'bench'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hp_001'], progressions: ['gym_hp_003'],
    cues: ['DBs at chest width', 'Retract scapula', 'Lower with control', 'Press to slight arch path'],
    sets: '3', reps: '10-12', rest: '75s', calories_est: 7
  },
  {
    id: 'gym_hp_003', name: 'Barbell Bench Press', category: 'horizontal_push', subcategory: 'free_weight',
    muscleGroups: ['chest', 'triceps', 'anterior_deltoid'], equipment: ['barbell', 'bench', 'rack'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hp_002'], progressions: ['gym_hp_004'],
    cues: ['5-point contact', 'Bar to lower chest', 'Elbows 45-75° from torso', 'Leg drive'],
    sets: '4', reps: '6-10', rest: '90s', calories_est: 8
  },
  {
    id: 'gym_hp_004', name: 'Incline Dumbbell Press', category: 'horizontal_push', subcategory: 'free_weight',
    muscleGroups: ['upper_chest', 'triceps', 'shoulders'], equipment: ['dumbbell', 'incline bench'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hp_002'], progressions: ['gym_hp_005'],
    cues: ['30-45° incline', 'Press to top of chest line', 'Slight arc path', 'Control descent'],
    sets: '3', reps: '10-12', rest: '75s', calories_est: 7
  },
  {
    id: 'gym_hp_005', name: 'Cable Fly (Chest)', category: 'horizontal_push', subcategory: 'cable',
    muscleGroups: ['chest', 'anterior_deltoid'], equipment: ['cable machine'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hp_002'], progressions: [],
    cues: ['Slight forward lean', 'Slight elbow bend', 'Big hugging motion', 'Squeeze at center'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 5
  },
  {
    id: 'gym_hp_006', name: 'Dips (Chest)', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['chest', 'triceps', 'shoulders'], equipment: ['dip bars'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hp_003'], progressions: ['gym_hp_007'],
    cues: ['Lean forward for chest emphasis', 'Lower until stretch in chest', 'Drive up to start'],
    sets: '3', reps: '8-12', rest: '75s', calories_est: 8
  },
  {
    id: 'gym_hp_007', name: 'Weighted Dips', category: 'horizontal_push', subcategory: 'free_weight',
    muscleGroups: ['chest', 'triceps'], equipment: ['dip bars', 'weight belt'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_hp_006'], progressions: [],
    cues: ['Add load via belt', 'Full range', 'Control descent'],
    sets: '4', reps: '6-10', rest: '90s', calories_est: 10
  },
  {
    id: 'gym_hp_008', name: 'Decline Bench Press', category: 'horizontal_push', subcategory: 'free_weight',
    muscleGroups: ['lower_chest', 'triceps'], equipment: ['barbell', 'decline bench'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hp_003'], progressions: [],
    cues: ['Secure feet', 'Bar to lower chest', 'Drive up explosively'],
    sets: '3', reps: '8-12', rest: '90s', calories_est: 8
  },
  {
    id: 'gym_hp_009', name: 'Pec Deck (Machine Fly)', category: 'horizontal_push', subcategory: 'machine',
    muscleGroups: ['chest'], equipment: ['pec deck machine'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: ['gym_hp_005'],
    cues: ['Elbows at shoulder height', 'Squeeze at center', 'Slow return'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 5
  },

  // --- HORIZONTAL PULL ---
  {
    id: 'gym_hpu_001', name: 'Seated Cable Row', category: 'horizontal_pull', subcategory: 'cable',
    muscleGroups: ['lats', 'rhomboids', 'biceps', 'rear_deltoid'], equipment: ['cable machine'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_hpu_002'], progressions: ['gym_hpu_003'],
    cues: ['Tall posture', 'Drive elbows back', 'Squeeze shoulder blades', 'Don\'t lean back excessively'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_hpu_002', name: 'Seated Row Machine', category: 'horizontal_pull', subcategory: 'machine',
    muscleGroups: ['lats', 'rhomboids', 'biceps'], equipment: ['row machine'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: ['gym_hpu_001'],
    cues: ['Chest against pad', 'Pull handles to torso', 'Retract scapula fully'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 5
  },
  {
    id: 'gym_hpu_003', name: 'Bent-Over Barbell Row', category: 'horizontal_pull', subcategory: 'free_weight',
    muscleGroups: ['lats', 'rhomboids', 'biceps', 'lower_back'], equipment: ['barbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hpu_001'], progressions: ['gym_hpu_004'],
    cues: ['45° torso', 'Pull bar to lower chest', 'Drive elbows back', 'Control descent'],
    sets: '4', reps: '8-10', rest: '90s', calories_est: 9
  },
  {
    id: 'gym_hpu_004', name: 'T-Bar Row', category: 'horizontal_pull', subcategory: 'free_weight',
    muscleGroups: ['lats', 'rhomboids', 'middle_traps'], equipment: ['t-bar'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_hpu_003'], progressions: [],
    cues: ['Chest on pad if available', 'Neutral grip', 'Pull to chest', 'Squeeze at top'],
    sets: '4', reps: '8-10', rest: '90s', calories_est: 9
  },
  {
    id: 'gym_hpu_005', name: 'Dumbbell Single-Arm Row', category: 'horizontal_pull', subcategory: 'free_weight',
    muscleGroups: ['lats', 'rhomboids', 'biceps'], equipment: ['dumbbell', 'bench'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_hpu_002'], progressions: ['gym_hpu_003'],
    cues: ['Brace on bench', 'Pull elbow to hip', 'No rotation', 'Full stretch at bottom'],
    sets: '3', reps: '10-12 each', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_hpu_006', name: 'Face Pull (Cable)', category: 'horizontal_pull', subcategory: 'cable',
    muscleGroups: ['rear_deltoid', 'external_rotators', 'rhomboids'], equipment: ['cable machine', 'rope attachment'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: [],
    cues: ['Cable at face height', 'Pull to forehead', 'Elbows high', 'External rotate at end'],
    sets: '3', reps: '15-20', rest: '45s', calories_est: 4
  },
  {
    id: 'gym_hpu_007', name: 'Chest-Supported Row (Machine)', category: 'horizontal_pull', subcategory: 'machine',
    muscleGroups: ['rhomboids', 'lats', 'biceps'], equipment: ['chest-supported row machine'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_hpu_002'], progressions: ['gym_hpu_003'],
    cues: ['Chest firmly on pad', 'Pull to hips', 'Retract fully'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 5
  },
  {
    id: 'gym_hpu_008', name: 'Meadows Row', category: 'horizontal_pull', subcategory: 'free_weight',
    muscleGroups: ['lats', 'teres_major'], equipment: ['barbell (landmine)'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_hpu_005'], progressions: [],
    cues: ['Stagger stance', 'Pull bar to hip', 'Huge stretch at bottom', 'Drive elbow up and back'],
    sets: '3', reps: '8-10 each', rest: '75s', calories_est: 7
  },

  // --- VERTICAL PULL ---
  {
    id: 'gym_vp_001', name: 'Lat Pulldown (Machine)', category: 'vertical_pull', subcategory: 'machine',
    muscleGroups: ['lats', 'biceps', 'rear_deltoid'], equipment: ['lat pulldown machine'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: ['gym_vp_002', 'gym_vp_003'],
    cues: ['Slight back lean', 'Pull bar to upper chest', 'Drive elbows to hips', 'Squeeze lats'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_vp_002', name: 'Pull-Up (Bodyweight)', category: 'vertical_pull', subcategory: 'bodyweight',
    muscleGroups: ['lats', 'biceps', 'core'], equipment: ['pull-up bar'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_vp_001', 'gym_vp_004'], progressions: ['gym_vp_005'],
    cues: ['Full hang start', 'Drive elbows to hips', 'Chin over bar', 'Control descent'],
    sets: '3', reps: '5-10', rest: '90s', calories_est: 8
  },
  {
    id: 'gym_vp_003', name: 'Chin-Up (Bodyweight)', category: 'vertical_pull', subcategory: 'bodyweight',
    muscleGroups: ['lats', 'biceps'], equipment: ['pull-up bar'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_vp_001'], progressions: ['gym_vp_005'],
    cues: ['Supinated grip', 'Elbows close to body', 'Full range'],
    sets: '3', reps: '5-10', rest: '90s', calories_est: 8
  },
  {
    id: 'gym_vp_004', name: 'Assisted Pull-Up (Machine)', category: 'vertical_pull', subcategory: 'machine',
    muscleGroups: ['lats', 'biceps'], equipment: ['assisted pull-up machine'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_vp_001'], progressions: ['gym_vp_002'],
    cues: ['Same cues as pull-up', 'Reduce assistance over time'],
    sets: '3', reps: '8-12', rest: '75s', calories_est: 6
  },
  {
    id: 'gym_vp_005', name: 'Weighted Pull-Up', category: 'vertical_pull', subcategory: 'free_weight',
    muscleGroups: ['lats', 'biceps', 'core'], equipment: ['pull-up bar', 'weight belt'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_vp_002'], progressions: [],
    cues: ['Add load via belt or vest', 'Full range', 'Slow eccentric'],
    sets: '4', reps: '5-8', rest: '120s', calories_est: 10
  },
  {
    id: 'gym_vp_006', name: 'Single-Arm Lat Pulldown (Cable)', category: 'vertical_pull', subcategory: 'cable',
    muscleGroups: ['lats', 'biceps'], equipment: ['cable machine'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_vp_001'], progressions: ['gym_vp_002'],
    cues: ['Pull handle to shoulder', 'Full stretch overhead', 'No rotation'],
    sets: '3', reps: '10-12 each', rest: '60s', calories_est: 6
  },

  // --- VERTICAL PUSH ---
  {
    id: 'gym_vpush_001', name: 'Overhead Press (Dumbbell)', category: 'vertical_push', subcategory: 'free_weight',
    muscleGroups: ['shoulders', 'triceps', 'upper_traps'], equipment: ['dumbbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_vpush_003'], progressions: ['gym_vpush_002'],
    cues: ['DBs at shoulder height', 'Press overhead', 'Slight forward lean allowed', 'Lock out at top'],
    sets: '3', reps: '10-12', rest: '75s', calories_est: 7
  },
  {
    id: 'gym_vpush_002', name: 'Barbell Overhead Press', category: 'vertical_push', subcategory: 'free_weight',
    muscleGroups: ['shoulders', 'triceps', 'core', 'upper_traps'], equipment: ['barbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_vpush_001'], progressions: ['gym_vpush_004'],
    cues: ['Bar at upper chest', 'Brace core', 'Press bar in slight arc', 'Full lockout'],
    sets: '4', reps: '6-10', rest: '90s', calories_est: 8
  },
  {
    id: 'gym_vpush_003', name: 'Shoulder Press (Machine)', category: 'vertical_push', subcategory: 'machine',
    muscleGroups: ['shoulders', 'triceps'], equipment: ['shoulder press machine'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: ['gym_vpush_001'],
    cues: ['Adjust seat height', 'Full range', 'Control descent'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_vpush_004', name: 'Push Press', category: 'vertical_push', subcategory: 'free_weight',
    muscleGroups: ['shoulders', 'triceps', 'quads', 'glutes'], equipment: ['barbell'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_vpush_002'], progressions: [],
    cues: ['Dip and drive with legs', 'Transfer force to press', 'Lock out overhead', 'Receive bar with slight knee bend'],
    sets: '4', reps: '5-6', rest: '120s', calories_est: 10
  },
  {
    id: 'gym_vpush_005', name: 'Arnold Press', category: 'vertical_push', subcategory: 'free_weight',
    muscleGroups: ['anterior_deltoid', 'medial_deltoid', 'triceps'], equipment: ['dumbbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_vpush_003'], progressions: ['gym_vpush_001'],
    cues: ['Start palms facing you', 'Rotate as you press', 'Full extension overhead'],
    sets: '3', reps: '10-12', rest: '75s', calories_est: 7
  },
  {
    id: 'gym_vpush_006', name: 'Lateral Raise (Dumbbell)', category: 'vertical_push', subcategory: 'free_weight',
    muscleGroups: ['medial_deltoid'], equipment: ['dumbbell'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: ['gym_vpush_007'],
    cues: ['Slight forward lean', 'Lead with elbows', 'Stop at shoulder height', 'Control descent'],
    sets: '3', reps: '15-20', rest: '45s', calories_est: 4
  },
  {
    id: 'gym_vpush_007', name: 'Cable Lateral Raise', category: 'vertical_push', subcategory: 'cable',
    muscleGroups: ['medial_deltoid'], equipment: ['cable machine'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_vpush_006'], progressions: [],
    cues: ['Cable at hip height', 'Lead with elbow', 'Constant tension throughout'],
    sets: '3', reps: '15-20', rest: '45s', calories_est: 4
  },

  // --- LUNGE PATTERN ---
  {
    id: 'gym_lu_001', name: 'Reverse Lunge (Bodyweight)', category: 'lunge', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'hamstrings'], equipment: [],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_sq_001'], progressions: ['gym_lu_002'],
    cues: ['Step back far enough', 'Front shin vertical', 'Lower rear knee toward floor', 'Drive through front heel'],
    sets: '3', reps: '10-12 each', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_lu_002', name: 'Dumbbell Walking Lunge', category: 'lunge', subcategory: 'free_weight',
    muscleGroups: ['quads', 'glutes', 'hamstrings'], equipment: ['dumbbell'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_lu_001'], progressions: ['gym_lu_003'],
    cues: ['Long stride', 'Front knee tracks toes', 'Upright torso', 'Drive through front heel'],
    sets: '3', reps: '10-12 each', rest: '75s', calories_est: 8
  },
  {
    id: 'gym_lu_003', name: 'Barbell Lunge', category: 'lunge', subcategory: 'free_weight',
    muscleGroups: ['quads', 'glutes', 'hamstrings', 'core'], equipment: ['barbell'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_lu_002'], progressions: [],
    cues: ['Bar on traps', 'Core tight', 'Long controlled step', 'Knee stays over ankle'],
    sets: '3', reps: '8-10 each', rest: '90s', calories_est: 9
  },
  {
    id: 'gym_lu_004', name: 'Step-Up (Weighted)', category: 'lunge', subcategory: 'free_weight',
    muscleGroups: ['quads', 'glutes'], equipment: ['dumbbell', 'box'],
    level: 'intermediate', setting: 'gym',
    regressions: ['home_lu_001'], progressions: ['gym_lu_002'],
    cues: ['Full foot on box', 'Drive through heel', 'Don\'t push off back foot', 'Control descent'],
    sets: '3', reps: '10-12 each', rest: '60s', calories_est: 7
  },
  {
    id: 'gym_lu_005', name: 'Curtsy Lunge', category: 'lunge', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'inner_thighs', 'quads'], equipment: [],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_lu_001'], progressions: ['gym_lu_002'],
    cues: ['Step back and across', 'Keep hips square', 'Front knee tracks toes'],
    sets: '3', reps: '10-12 each', rest: '60s', calories_est: 6
  },

  // --- ISOLATION / ARMS ---
  {
    id: 'gym_arm_001', name: 'Barbell Bicep Curl', category: 'arms', subcategory: 'free_weight',
    muscleGroups: ['biceps', 'brachialis'], equipment: ['barbell'],
    level: 'beginner', setting: 'gym',
    regressions: ['gym_arm_002'], progressions: ['gym_arm_003'],
    cues: ['Elbows pinned to sides', 'Full range of motion', 'Squeeze at top', 'Slow descent'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 5
  },
  {
    id: 'gym_arm_002', name: 'Dumbbell Bicep Curl', category: 'arms', subcategory: 'free_weight',
    muscleGroups: ['biceps'], equipment: ['dumbbell'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: ['gym_arm_001'],
    cues: ['Alternate or both', 'Full extension at bottom', 'Supinate wrist', 'Control tempo'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 5
  },
  {
    id: 'gym_arm_003', name: 'Preacher Curl (Machine)', category: 'arms', subcategory: 'machine',
    muscleGroups: ['biceps'], equipment: ['preacher curl machine'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_arm_002'], progressions: [],
    cues: ['Full stretch at bottom', 'Don\'t swing', 'Squeeze at top'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 4
  },
  {
    id: 'gym_arm_004', name: 'Hammer Curl', category: 'arms', subcategory: 'free_weight',
    muscleGroups: ['brachialis', 'brachioradialis'], equipment: ['dumbbell'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: [],
    cues: ['Neutral grip', 'Elbows at sides', 'Control the movement'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 5
  },
  {
    id: 'gym_arm_005', name: 'Tricep Pushdown (Cable)', category: 'arms', subcategory: 'cable',
    muscleGroups: ['triceps'], equipment: ['cable machine', 'rope attachment'],
    level: 'beginner', setting: 'gym',
    regressions: [], progressions: ['gym_arm_006'],
    cues: ['Elbows at sides', 'Full extension', 'Squeeze at bottom', 'Control up'],
    sets: '3', reps: '12-15', rest: '45s', calories_est: 4
  },
  {
    id: 'gym_arm_006', name: 'Skull Crusher (EZ Bar)', category: 'arms', subcategory: 'free_weight',
    muscleGroups: ['triceps'], equipment: ['ez bar', 'bench'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_arm_005'], progressions: [],
    cues: ['Upper arms vertical', 'Lower bar to forehead', 'Only forearms move', 'Full extension'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 5
  },
  {
    id: 'gym_arm_007', name: 'Overhead Tricep Extension (Cable)', category: 'arms', subcategory: 'cable',
    muscleGroups: ['triceps_long_head'], equipment: ['cable machine', 'rope attachment'],
    level: 'intermediate', setting: 'gym',
    regressions: ['gym_arm_005'], progressions: [],
    cues: ['Face away from cable', 'Elbows by ears', 'Full extension overhead', 'Control return'],
    sets: '3', reps: '12-15', rest: '60s', calories_est: 4
  },

  // --- GYM CORE ---
  {
    id: 'gym_co_001', name: 'Cable Woodchop', category: 'core', subcategory: 'cable',
    muscleGroups: ['obliques', 'core', 'shoulders'], equipment: ['cable machine'],
    level: 'intermediate', setting: 'gym',
    regressions: ['home_co_002'], progressions: [],
    cues: ['Rotate from hips', 'Arms mostly straight', 'Resist the return', 'Both high-to-low and low-to-high'],
    sets: '3', reps: '12-15 each', rest: '45s', calories_est: 5
  },
  {
    id: 'gym_co_002', name: 'Ab Rollout (Wheel)', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['core', 'lats', 'shoulders'], equipment: ['ab wheel'],
    level: 'advanced', setting: 'gym',
    regressions: ['home_co_001'], progressions: [],
    cues: ['Brace hard', 'Roll out to full extension', 'Pull back with lats', 'Don\'t let hips sag'],
    sets: '3', reps: '8-12', rest: '60s', calories_est: 7
  },
  {
    id: 'gym_co_003', name: 'Hanging Leg Raise', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['lower_abs', 'hip_flexors'], equipment: ['pull-up bar'],
    level: 'intermediate', setting: 'gym',
    regressions: ['home_co_003'], progressions: ['gym_co_004'],
    cues: ['Dead hang start', 'Posterior pelvic tilt', 'Raise legs to 90°+', 'Control descent'],
    sets: '3', reps: '10-15', rest: '60s', calories_est: 6
  },
  {
    id: 'gym_co_004', name: 'Toes to Bar', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['lower_abs', 'hip_flexors', 'lats'], equipment: ['pull-up bar'],
    level: 'advanced', setting: 'gym',
    regressions: ['gym_co_003'], progressions: [],
    cues: ['Full ROM', 'Control the swing', 'Hollow body position'],
    sets: '3', reps: '8-12', rest: '75s', calories_est: 8
  },
  {
    id: 'gym_co_005', name: 'Pallof Press (Cable)', category: 'core', subcategory: 'cable',
    muscleGroups: ['obliques', 'transverse_abdominis'], equipment: ['cable machine'],
    level: 'intermediate', setting: 'gym',
    regressions: [], progressions: [],
    cues: ['Stand sideways to cable', 'Brace core', 'Press and hold', 'Resist rotation'],
    sets: '3', reps: '10-12 each side', rest: '45s', calories_est: 4
  },

  // ============================================================
  // 🏠 HOME EXERCISES (No equipment or minimal)
  // ============================================================

  // --- SQUAT / LOWER BODY ---
  {
    id: 'home_sq_001', name: 'Sit-to-Stand', category: 'squat', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes'], equipment: ['chair'],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_sq_002', 'home_lu_001'],
    cues: ['Scoot to edge of chair', 'Lean forward', 'Drive through heels', 'Stand tall'],
    sets: '3', reps: '10-15', rest: '45s', calories_est: 4
  },
  {
    id: 'home_sq_002', name: 'Bodyweight Squat', category: 'squat', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'hamstrings'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: ['home_sq_001'], progressions: ['home_sq_003', 'home_sq_004'],
    cues: ['Feet shoulder width', 'Toes slightly out', 'Chest up', 'Break parallel'],
    sets: '3', reps: '15-20', rest: '45s', calories_est: 5
  },
  {
    id: 'home_sq_003', name: 'Jump Squat', category: 'squat', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'calves'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_sq_002'], progressions: ['home_sq_005'],
    cues: ['Squat to parallel', 'Explode upward', 'Land softly', 'Absorb with knees'],
    sets: '3', reps: '10-15', rest: '60s', calories_est: 10
  },
  {
    id: 'home_sq_004', name: 'Pause Squat (Bodyweight)', category: 'squat', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_sq_002'], progressions: ['home_sq_005'],
    cues: ['2-3 second pause at bottom', 'Maintain tension', 'Drive up explosively'],
    sets: '3', reps: '10-12', rest: '60s', calories_est: 6
  },
  {
    id: 'home_sq_005', name: 'Pistol Squat (Assisted)', category: 'squat', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'core'], equipment: ['TRX or door frame'],
    level: 'advanced', setting: 'home',
    regressions: ['home_sq_003'], progressions: ['home_sq_006'],
    cues: ['Hold support', 'One leg extended', 'Lower under control', 'Drive through heel'],
    sets: '3', reps: '5-8 each', rest: '90s', calories_est: 8
  },
  {
    id: 'home_sq_006', name: 'Pistol Squat (Freestanding)', category: 'squat', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'core'], equipment: [],
    level: 'advanced', setting: 'home',
    regressions: ['home_sq_005'], progressions: [],
    cues: ['Arms counterbalance', 'Heel stays down', 'Full depth', 'Control throughout'],
    sets: '3', reps: '3-6 each', rest: '120s', calories_est: 9
  },

  // --- HINGE / GLUTES ---
  {
    id: 'home_gl_001', name: 'Glute Bridge', category: 'hinge', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'hamstrings'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_gl_002', 'home_gl_003'],
    cues: ['Feet flat, knees bent', 'Drive hips up', 'Squeeze glutes at top', 'Hold 2 seconds'],
    sets: '3', reps: '15-20', rest: '45s', calories_est: 4
  },
  {
    id: 'home_gl_002', name: 'Single-Leg Glute Bridge', category: 'hinge', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'hamstrings', 'core'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_gl_001'], progressions: ['home_gl_003'],
    cues: ['One foot elevated or straight', 'Drive hips up', 'Keep hips level', 'Squeeze at top'],
    sets: '3', reps: '12-15 each', rest: '45s', calories_est: 5
  },
  {
    id: 'home_gl_003', name: 'Hip Thrust (Using Couch)', category: 'hinge', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'hamstrings'], equipment: ['couch or bench'],
    level: 'intermediate', setting: 'home',
    regressions: ['home_gl_001'], progressions: ['gym_hi_002'],
    cues: ['Shoulder blades on couch edge', 'Feet flat', 'Drive hips to ceiling', 'Full extension'],
    sets: '3', reps: '15-20', rest: '60s', calories_est: 6
  },
  {
    id: 'home_gl_004', name: 'Donkey Kick', category: 'hinge', subcategory: 'bodyweight',
    muscleGroups: ['glutes'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_gl_005'],
    cues: ['Tabletop position', 'Keep hip square', 'Drive heel to ceiling', 'Squeeze at top'],
    sets: '3', reps: '15-20 each', rest: '45s', calories_est: 4
  },
  {
    id: 'home_gl_005', name: 'Fire Hydrant', category: 'hinge', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'hip_abductors'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: [],
    cues: ['Tabletop position', 'Keep core tight', 'Open hip to side', 'Slow and controlled'],
    sets: '3', reps: '15 each', rest: '45s', calories_est: 3
  },
  {
    id: 'home_gl_006', name: 'Clamshell', category: 'hinge', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'hip_abductors'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_gl_007'],
    cues: ['Side lying, hips stacked', 'Open top knee like clamshell', 'Feet stay together', 'Control return'],
    sets: '3', reps: '15-20 each', rest: '30s', calories_est: 3
  },
  {
    id: 'home_gl_007', name: 'Resistance Band Clamshell', category: 'hinge', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'hip_abductors'], equipment: ['resistance band'],
    level: 'intermediate', setting: 'home',
    regressions: ['home_gl_006'], progressions: [],
    cues: ['Band just above knees', 'Open against resistance', 'Don\'t let pelvis rock'],
    sets: '3', reps: '15-20 each', rest: '30s', calories_est: 4
  },

  // --- PUSH ---
  {
    id: 'home_pu_001', name: 'Wall Push-Up', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['chest', 'triceps', 'shoulders'], equipment: ['wall'],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_pu_002'],
    cues: ['Arms shoulder-width', 'Body in straight line', 'Chest to wall', 'Full extension'],
    sets: '3', reps: '15-20', rest: '30s', calories_est: 3
  },
  {
    id: 'home_pu_002', name: 'Incline Push-Up', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['chest', 'triceps', 'shoulders'], equipment: ['chair or table'],
    level: 'beginner', setting: 'home',
    regressions: ['home_pu_001'], progressions: ['home_pu_003'],
    cues: ['Hands on elevated surface', 'Straight body', 'Chest to surface', 'Full extension'],
    sets: '3', reps: '12-15', rest: '45s', calories_est: 4
  },
  {
    id: 'home_pu_003', name: 'Knee Push-Up', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['chest', 'triceps'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: ['home_pu_002'], progressions: ['home_pu_004'],
    cues: ['Knees on floor', 'Straight line from knees to shoulders', 'Full range of motion'],
    sets: '3', reps: '10-15', rest: '45s', calories_est: 4
  },
  {
    id: 'home_pu_004', name: 'Standard Push-Up', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['chest', 'triceps', 'core', 'shoulders'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_pu_003'], progressions: ['home_pu_005', 'home_pu_006'],
    cues: ['Hands slightly wider than shoulders', 'Plank position', 'Chest to floor', 'Full extension'],
    sets: '3', reps: '15-20', rest: '60s', calories_est: 7
  },
  {
    id: 'home_pu_005', name: 'Diamond Push-Up', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['triceps', 'inner_chest'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_pu_004'], progressions: ['home_pu_007'],
    cues: ['Hands form diamond shape', 'Elbows close to body', 'Full range'],
    sets: '3', reps: '10-15', rest: '60s', calories_est: 7
  },
  {
    id: 'home_pu_006', name: 'Wide Push-Up', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['outer_chest', 'shoulders'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_pu_004'], progressions: ['home_pu_007'],
    cues: ['Hands wider than shoulders', 'Elbows flare out', 'Chest to floor'],
    sets: '3', reps: '10-15', rest: '60s', calories_est: 7
  },
  {
    id: 'home_pu_007', name: 'Archer Push-Up', category: 'horizontal_push', subcategory: 'bodyweight',
    muscleGroups: ['chest', 'triceps', 'core'], equipment: [],
    level: 'advanced', setting: 'home',
    regressions: ['home_pu_005'], progressions: ['home_pu_008'],
    cues: ['One arm wide, one close', 'Lower to close-arm side', 'Alternate sides'],
    sets: '3', reps: '6-10 each', rest: '75s', calories_est: 9
  },
  {
    id: 'home_pu_008', name: 'Pike Push-Up', category: 'vertical_push', subcategory: 'bodyweight',
    muscleGroups: ['shoulders', 'triceps'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_pu_004'], progressions: ['home_pu_009'],
    cues: ['Inverted V position', 'Lower head toward floor', 'Elbows track back', 'Drive up'],
    sets: '3', reps: '8-12', rest: '60s', calories_est: 7
  },
  {
    id: 'home_pu_009', name: 'Elevated Pike Push-Up', category: 'vertical_push', subcategory: 'bodyweight',
    muscleGroups: ['shoulders', 'triceps'], equipment: ['chair'],
    level: 'advanced', setting: 'home',
    regressions: ['home_pu_008'], progressions: [],
    cues: ['Feet elevated', 'More vertical angle', 'Lower head to floor'],
    sets: '3', reps: '8-12', rest: '75s', calories_est: 8
  },

  // --- PULL (HOME) ---
  {
    id: 'home_pu_010', name: 'Inverted Row (Under Table)', category: 'horizontal_pull', subcategory: 'bodyweight',
    muscleGroups: ['lats', 'rhomboids', 'biceps'], equipment: ['sturdy table'],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_pu_011'],
    cues: ['Body straight', 'Pull chest to table edge', 'Squeeze shoulder blades', 'Lower with control'],
    sets: '3', reps: '10-15', rest: '60s', calories_est: 6
  },
  {
    id: 'home_pu_011', name: 'Feet-Elevated Inverted Row', category: 'horizontal_pull', subcategory: 'bodyweight',
    muscleGroups: ['lats', 'rhomboids', 'biceps'], equipment: ['table', 'chair'],
    level: 'intermediate', setting: 'home',
    regressions: ['home_pu_010'], progressions: [],
    cues: ['Feet elevated increases difficulty', 'Full range of motion', 'Control descent'],
    sets: '3', reps: '8-12', rest: '60s', calories_est: 7
  },
  {
    id: 'home_pu_012', name: 'Pull-Up (Doorframe Bar)', category: 'vertical_pull', subcategory: 'bodyweight',
    muscleGroups: ['lats', 'biceps'], equipment: ['doorframe pull-up bar'],
    level: 'intermediate', setting: 'home',
    regressions: ['home_pu_010'], progressions: ['gym_vp_005'],
    cues: ['Full hang', 'Drive elbows down', 'Chin over bar', 'Control descent'],
    sets: '3', reps: '5-10', rest: '90s', calories_est: 8
  },

  // --- LUNGE (HOME) ---
  {
    id: 'home_lu_001', name: 'Step-Up (Bodyweight)', category: 'lunge', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes'], equipment: ['stair or box'],
    level: 'beginner', setting: 'home',
    regressions: ['home_sq_001'], progressions: ['gym_lu_004'],
    cues: ['Full foot on step', 'Drive through heel', 'Don\'t push off back foot', 'Stand tall at top'],
    sets: '3', reps: '10-12 each', rest: '45s', calories_est: 5
  },
  {
    id: 'home_lu_002', name: 'Reverse Lunge (Bodyweight)', category: 'lunge', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'hamstrings'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: ['home_sq_002'], progressions: ['home_lu_003'],
    cues: ['Step back far', 'Front shin vertical', 'Lower rear knee', 'Drive through front heel'],
    sets: '3', reps: '10-12 each', rest: '45s', calories_est: 5
  },
  {
    id: 'home_lu_003', name: 'Lateral Lunge', category: 'lunge', subcategory: 'bodyweight',
    muscleGroups: ['inner_thighs', 'quads', 'glutes'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_lu_002'], progressions: [],
    cues: ['Wide step to side', 'Sit into bending leg', 'Other leg straight', 'Push back to center'],
    sets: '3', reps: '10-12 each', rest: '60s', calories_est: 6
  },
  {
    id: 'home_lu_004', name: 'Walking Lunge (Bodyweight)', category: 'lunge', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'hamstrings'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_lu_002'], progressions: ['gym_lu_002'],
    cues: ['Long stride', 'Front knee over ankle', 'Upright torso', 'Drive through front heel'],
    sets: '3', reps: '10-12 each', rest: '60s', calories_est: 7
  },
  {
    id: 'home_lu_005', name: 'Jump Lunge (Split Jump)', category: 'lunge', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'calves'], equipment: [],
    level: 'advanced', setting: 'home',
    regressions: ['home_lu_004'], progressions: [],
    cues: ['Lunge position', 'Jump and switch legs', 'Land softly', 'Keep chest up'],
    sets: '3', reps: '10-12 each', rest: '75s', calories_est: 12
  },

  // --- CORE (HOME) ---
  {
    id: 'home_co_001', name: 'Dead Bug', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['transverse_abdominis', 'core'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_co_002'],
    cues: ['Lower back pressed to floor', 'Opposite arm and leg lower', 'Exhale as you extend', 'Never lose lower back contact'],
    sets: '3', reps: '8-10 each side', rest: '45s', calories_est: 3
  },
  {
    id: 'home_co_002', name: 'Bird Dog', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['erector_spinae', 'glutes', 'core'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_co_003'],
    cues: ['Tabletop position', 'Opposite arm/leg extend', 'Hips level', 'Slow and controlled'],
    sets: '3', reps: '8-10 each side', rest: '30s', calories_est: 3
  },
  {
    id: 'home_co_003', name: 'Plank', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['core', 'transverse_abdominis', 'shoulders'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: ['home_co_002'], progressions: ['home_co_004', 'home_co_005'],
    cues: ['Forearms or hands', 'Straight line head to heels', 'Brace abs', 'Don\'t hold breath'],
    sets: '3', reps: '30-60s', rest: '45s', calories_est: 4
  },
  {
    id: 'home_co_004', name: 'Side Plank', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['obliques', 'core', 'hip_abductors'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_co_003'], progressions: ['home_co_006'],
    cues: ['Side of foot or knee', 'Hips stacked', 'Don\'t let hip drop', 'Hold position'],
    sets: '3', reps: '20-40s each', rest: '45s', calories_est: 4
  },
  {
    id: 'home_co_005', name: 'Plank with Shoulder Tap', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['core', 'anti_rotation', 'shoulders'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_co_003'], progressions: [],
    cues: ['Wide foot stance', 'Touch opposite shoulder', 'Minimize hip rotation', 'Brace hard'],
    sets: '3', reps: '10-15 each', rest: '45s', calories_est: 5
  },
  {
    id: 'home_co_006', name: 'Side Plank with Hip Dip', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['obliques', 'core'], equipment: [],
    level: 'advanced', setting: 'home',
    regressions: ['home_co_004'], progressions: [],
    cues: ['From side plank', 'Dip hip to floor', 'Drive up high', 'Control tempo'],
    sets: '3', reps: '12-15 each', rest: '45s', calories_est: 5
  },
  {
    id: 'home_co_007', name: 'Mountain Climber', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['core', 'hip_flexors', 'shoulders'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_co_003'], progressions: ['home_co_008'],
    cues: ['Push-up position', 'Drive knees to chest alternately', 'Hips level', 'Quick tempo'],
    sets: '3', reps: '20-30', rest: '45s', calories_est: 8
  },
  {
    id: 'home_co_008', name: 'Cross-Body Mountain Climber', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['obliques', 'core', 'hip_flexors'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_co_007'], progressions: [],
    cues: ['Drive knee to opposite elbow', 'Rotate from core', 'Fast tempo'],
    sets: '3', reps: '20-30', rest: '45s', calories_est: 9
  },
  {
    id: 'home_co_009', name: 'Hollow Body Hold', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['core', 'hip_flexors', 'lower_abs'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_co_003'], progressions: ['home_co_010'],
    cues: ['Press lower back to floor', 'Arms overhead, legs low', 'Brace everything', 'Breathe shallow'],
    sets: '3', reps: '20-40s', rest: '45s', calories_est: 5
  },
  {
    id: 'home_co_010', name: 'Hollow Body Rock', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['core', 'hip_flexors'], equipment: [],
    level: 'advanced', setting: 'home',
    regressions: ['home_co_009'], progressions: [],
    cues: ['Maintain hollow shape', 'Rock forward and back', 'No shape breakdown'],
    sets: '3', reps: '15-20', rest: '45s', calories_est: 5
  },
  {
    id: 'home_co_011', name: 'Bicycle Crunch', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['obliques', 'abs'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_co_007'],
    cues: ['Elbow to opposite knee', 'Rotate from core not neck', 'Extend other leg', 'Slow and controlled'],
    sets: '3', reps: '15-20 each', rest: '45s', calories_est: 5
  },
  {
    id: 'home_co_012', name: 'V-Up', category: 'core', subcategory: 'bodyweight',
    muscleGroups: ['abs', 'hip_flexors'], equipment: [],
    level: 'advanced', setting: 'home',
    regressions: ['home_co_009'], progressions: [],
    cues: ['Lift arms and legs simultaneously', 'Touch toes at top', 'Control descent'],
    sets: '3', reps: '10-15', rest: '60s', calories_est: 6
  },

  // --- MOBILITY (HOME) ---
  {
    id: 'home_mo_001', name: 'Cat-Camel Stretch', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['spine', 'core', 'hip_flexors'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: [],
    cues: ['Tabletop position', 'Round spine to ceiling', 'Then arch and look up', 'Slow and controlled'],
    sets: '2', reps: '10-15 cycles', rest: '30s', calories_est: 2
  },
  {
    id: 'home_mo_002', name: 'Hip Circle (Standing)', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['hips', 'lower_back'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: [],
    cues: ['Hands on hips', 'Big slow circles', 'Both directions', 'Full range'],
    sets: '2', reps: '10 each direction', rest: '30s', calories_est: 2
  },
  {
    id: 'home_mo_003', name: 'World\'s Greatest Stretch', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['hip_flexors', 'thoracic_spine', 'hamstrings'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_mo_005'], progressions: [],
    cues: ['Lunge position', 'Front hand inside front foot', 'Rotate up with same arm', 'Hold 2s at top'],
    sets: '2', reps: '5-8 each side', rest: '30s', calories_est: 3
  },
  {
    id: 'home_mo_004', name: 'Thoracic Rotation (Seated)', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['thoracic_spine', 'obliques'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: [],
    cues: ['Seated cross-legged or in chair', 'Hands behind head', 'Rotate to each side', 'Hold 2s'],
    sets: '2', reps: '10 each side', rest: '30s', calories_est: 2
  },
  {
    id: 'home_mo_005', name: 'Hip Flexor Stretch (Kneeling)', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['hip_flexors', 'quads'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_mo_003'],
    cues: ['Kneeling lunge', 'Drive hip forward', 'Squeeze rear glute', 'Tall posture'],
    sets: '2', reps: '30-45s each', rest: '30s', calories_est: 2
  },
  {
    id: 'home_mo_006', name: 'Pigeon Pose', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['hip_external_rotators', 'glutes', 'piriformis'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_mo_007'], progressions: [],
    cues: ['Front shin horizontal', 'Square hips', 'Fold forward', 'Breathe and relax'],
    sets: '2', reps: '45-60s each', rest: '30s', calories_est: 2
  },
  {
    id: 'home_mo_007', name: 'Figure-Four Stretch (Supine)', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['hip_external_rotators', 'glutes'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_mo_006'],
    cues: ['Lying on back', 'Cross ankle over opposite knee', 'Pull thigh toward chest', 'Feel in glute'],
    sets: '2', reps: '30-45s each', rest: '30s', calories_est: 2
  },
  {
    id: 'home_mo_008', name: 'Ankle Circles', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['ankle', 'calves'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: [],
    cues: ['Seated or standing', 'Big slow circles', 'Both directions', 'Full range'],
    sets: '2', reps: '10 each direction', rest: '20s', calories_est: 1
  },
  {
    id: 'home_mo_009', name: 'Thoracic Extension over Foam Roller', category: 'mobility', subcategory: 'bodyweight',
    muscleGroups: ['thoracic_spine', 'chest'], equipment: ['foam roller'],
    level: 'beginner', setting: 'home',
    regressions: ['home_mo_004'], progressions: [],
    cues: ['Roller perpendicular to spine', 'Support head', 'Extend over roller', 'Move up/down spine'],
    sets: '2', reps: '30-60s per segment', rest: '30s', calories_est: 2
  },

  // --- CARDIO (HOME) ---
  {
    id: 'home_ca_001', name: 'Jumping Jacks', category: 'cardio', subcategory: 'bodyweight',
    muscleGroups: ['full_body', 'cardiovascular'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: [], progressions: ['home_ca_002'],
    cues: ['Arms and legs out simultaneously', 'Soft landing', 'Maintain rhythm'],
    sets: '3', reps: '30-60s', rest: '30s', calories_est: 10
  },
  {
    id: 'home_ca_002', name: 'High Knees', category: 'cardio', subcategory: 'bodyweight',
    muscleGroups: ['hip_flexors', 'core', 'cardiovascular'], equipment: [],
    level: 'beginner', setting: 'home',
    regressions: ['home_ca_001'], progressions: ['home_ca_003'],
    cues: ['Drive knees to hip height', 'Pump arms', 'Stay on toes', 'Fast tempo'],
    sets: '3', reps: '30-45s', rest: '30s', calories_est: 11
  },
  {
    id: 'home_ca_003', name: 'Burpee', category: 'cardio', subcategory: 'bodyweight',
    muscleGroups: ['full_body', 'cardiovascular'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_ca_002'], progressions: ['home_ca_004'],
    cues: ['Squat down, jump back', 'Push-up', 'Jump forward', 'Jump and clap overhead'],
    sets: '3', reps: '10-15', rest: '60s', calories_est: 15
  },
  {
    id: 'home_ca_004', name: 'Burpee with Push-Up', category: 'cardio', subcategory: 'bodyweight',
    muscleGroups: ['full_body', 'chest', 'cardiovascular'], equipment: [],
    level: 'advanced', setting: 'home',
    regressions: ['home_ca_003'], progressions: [],
    cues: ['Full push-up at bottom', 'Explosive jump', 'Maintain form throughout'],
    sets: '3', reps: '8-12', rest: '75s', calories_est: 16
  },
  {
    id: 'home_ca_005', name: 'Box Jump (onto stairs)', category: 'cardio', subcategory: 'bodyweight',
    muscleGroups: ['quads', 'glutes', 'calves', 'cardiovascular'], equipment: ['stair'],
    level: 'intermediate', setting: 'home',
    regressions: ['home_sq_003'], progressions: [],
    cues: ['Squat and swing arms', 'Land softly with bent knees', 'Step down (don\'t jump down)'],
    sets: '3', reps: '8-10', rest: '60s', calories_est: 12
  },
  {
    id: 'home_ca_006', name: 'Skater Hops', category: 'cardio', subcategory: 'bodyweight',
    muscleGroups: ['glutes', 'inner_thighs', 'cardiovascular'], equipment: [],
    level: 'intermediate', setting: 'home',
    regressions: ['home_ca_001'], progressions: ['home_ca_003'],
    cues: ['Bound side to side', 'One-leg landing', 'Reach toward foot', 'Swing arms for momentum'],
    sets: '3', reps: '10-15 each', rest: '60s', calories_est: 11
  },

  // ============================================================
  // 💻 DESK BREAK EXERCISES (Office / Seated / Standing)
  // ============================================================

  {
    id: 'desk_001', name: 'Seated Neck Rolls', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['neck', 'traps'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Slow controlled circles', 'Both directions', 'Never full back extension', 'Breathe'],
    sets: '1', reps: '5 each direction', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_002', name: 'Shoulder Rolls', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['traps', 'shoulders'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Big circles', 'Both directions', 'Squeeze at top and back'],
    sets: '1', reps: '10 each direction', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_003', name: 'Chest Opener Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['chest', 'anterior_deltoid', 'biceps'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Hands behind back or doorframe', 'Open chest', 'Look slightly up', 'Breathe deep'],
    sets: '1', reps: '30-45s', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_004', name: 'Seated Spinal Twist', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['thoracic_spine', 'obliques'], equipment: ['chair'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Sit tall', 'Rotate from thoracic spine', 'Use chair back for leverage', 'Hold 20s each side'],
    sets: '1', reps: '20-30s each side', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_005', name: 'Seated Figure-Four Hip Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['hip_external_rotators', 'glutes'], equipment: ['chair'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Cross ankle over knee', 'Lean forward', 'Feel stretch in glute', 'Hold 30s'],
    sets: '1', reps: '30s each side', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_006', name: 'Standing Calf Raises', category: 'desk_break', subcategory: 'strength',
    muscleGroups: ['calves'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Rise on toes', 'Hold 1s at top', 'Slow descent', 'Can hold desk for balance'],
    sets: '2', reps: '15-20', rest: '0s', calories_est: 2
  },
  {
    id: 'desk_007', name: 'March in Place', category: 'desk_break', subcategory: 'cardio',
    muscleGroups: ['hip_flexors', 'cardiovascular'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Drive knees up', 'Swing arms naturally', 'Maintain upright posture'],
    sets: '1', reps: '30-60s', rest: '0s', calories_est: 4
  },
  {
    id: 'desk_008', name: 'Standing Hip Circles', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['hips', 'lower_back'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Hands on hips', 'Big slow circles', 'Both directions', 'Full range'],
    sets: '1', reps: '8-10 each direction', rest: '0s', calories_est: 2
  },
  {
    id: 'desk_009', name: 'Desk Push-Up', category: 'desk_break', subcategory: 'strength',
    muscleGroups: ['chest', 'triceps', 'shoulders'], equipment: ['desk'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Hands on desk edge', 'Body straight', 'Lower chest to desk', 'Full extension'],
    sets: '2', reps: '10-15', rest: '0s', calories_est: 3
  },
  {
    id: 'desk_010', name: 'Seated Leg Extensions', category: 'desk_break', subcategory: 'strength',
    muscleGroups: ['quads'], equipment: ['chair'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Sit tall', 'Extend one leg', 'Hold 2s', 'Lower with control', 'Alternate'],
    sets: '2', reps: '15 each', rest: '0s', calories_est: 2
  },
  {
    id: 'desk_011', name: 'Chair Sit-to-Stand', category: 'desk_break', subcategory: 'strength',
    muscleGroups: ['quads', 'glutes'], equipment: ['chair'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['No hands', 'Drive through heels', 'Stand fully tall', 'Lower with control'],
    sets: '2', reps: '10-15', rest: '0s', calories_est: 4
  },
  {
    id: 'desk_012', name: 'Wall Angels', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['thoracic_spine', 'shoulders', 'lats'], equipment: ['wall'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Back flat against wall', 'Arms in goalpost', 'Slide arms up and down', 'Keep contact throughout'],
    sets: '2', reps: '10-12', rest: '0s', calories_est: 2
  },
  {
    id: 'desk_013', name: 'Standing Back Extension', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['lower_back', 'thoracic_spine'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Hands on lower back', 'Gently arch backward', 'Hold 2s', 'Counteracts sitting posture'],
    sets: '1', reps: '8-10', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_014', name: 'Wrist Flexor Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['wrist_flexors', 'forearms'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Extend arm', 'Pull fingers back', 'Hold 20s', 'Essential for keyboard users'],
    sets: '1', reps: '20-30s each', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_015', name: 'Wrist Extensor Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['wrist_extensors', 'forearms'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Extend arm', 'Pull fingers down', 'Hold 20s', 'Pair with flexor stretch'],
    sets: '1', reps: '20-30s each', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_016', name: 'Eye Palming (20-20-20 Rule)', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['eye_muscles'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Every 20 min', 'Look 20 feet away', 'Hold 20 seconds', 'Reduces eye strain'],
    sets: '1', reps: '20s', rest: '0s', calories_est: 0
  },
  {
    id: 'desk_017', name: 'Standing Hip Flexor Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['hip_flexors'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Step one foot forward', 'Lunge position', 'Tuck pelvis', 'Feel stretch in rear hip'],
    sets: '1', reps: '30s each side', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_018', name: 'Seated Glute Squeeze', category: 'desk_break', subcategory: 'strength',
    muscleGroups: ['glutes'], equipment: ['chair'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Sit tall', 'Squeeze glutes as hard as possible', 'Hold 5s', 'Release and repeat'],
    sets: '2', reps: '10-15', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_019', name: 'Standing Doorframe Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['chest', 'anterior_deltoid'], equipment: ['doorframe'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Arms on doorframe', 'Step through', 'Open chest forward', 'Hold 30s'],
    sets: '1', reps: '30s', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_020', name: 'Seated Ankle Alphabet', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['ankle', 'calves'], equipment: ['chair'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Lift foot off floor', 'Trace alphabet with toe', 'Both feet', 'Great for circulation'],
    sets: '1', reps: 'Full alphabet each foot', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_021', name: 'Standing Quad Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['quads', 'hip_flexors'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Hold foot behind', 'Knees together', 'Tuck pelvis', 'Hold desk for balance if needed'],
    sets: '1', reps: '30s each', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_022', name: 'Standing Hamstring Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['hamstrings'], equipment: ['chair or desk'],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Heel on chair', 'Hinge forward from hips', 'Flat back', 'Hold 30s'],
    sets: '1', reps: '30s each', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_023', name: 'Box Breathing', category: 'desk_break', subcategory: 'recovery',
    muscleGroups: ['diaphragm', 'nervous_system'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Inhale 4s', 'Hold 4s', 'Exhale 4s', 'Hold 4s', 'Reduces cortisol'],
    sets: '1', reps: '4-6 cycles', rest: '0s', calories_est: 0
  },
  {
    id: 'desk_024', name: 'Trapezius Stretch (Neck Side Bend)', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['traps', 'neck'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Tilt ear to shoulder', 'Gently pull with opposite hand', 'Hold 20s', 'Releases desk tension'],
    sets: '1', reps: '20s each side', rest: '0s', calories_est: 1
  },
  {
    id: 'desk_025', name: 'Standing Lateral Stretch', category: 'desk_break', subcategory: 'mobility',
    muscleGroups: ['obliques', 'lats', 'intercostals'], equipment: [],
    level: 'beginner', setting: 'desk',
    regressions: [], progressions: [],
    cues: ['Arms overhead', 'Lean to one side', 'Feel stretch down side body', 'Hold 20s each'],
    sets: '1', reps: '20s each side', rest: '0s', calories_est: 1
  }
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getExercisesByLevel(level) {
  return EXERCISE_LIBRARY.filter(e => e.level === level);
}

export function getExercisesBySetting(setting) {
  return EXERCISE_LIBRARY.filter(e => e.setting === setting);
}

export function getExercisesByCategory(category) {
  return EXERCISE_LIBRARY.filter(e => e.category === category);
}

export function getExercisesByMuscle(muscle) {
  return EXERCISE_LIBRARY.filter(e => e.muscleGroups.includes(muscle));
}

export function getBeginnерSafeExercises(setting = null) {
  const forbidden = [
    'barbell squat', 'goblet squat', 'box squat', 'split squat',
    'deadlift', 'barbell bench', 'overhead press', 'pull-up'
  ];
  return EXERCISE_LIBRARY.filter(e => {
    if (e.level !== 'beginner') return false;
    if (setting && e.setting !== setting) return false;
    return !forbidden.some(f => e.name.toLowerCase().includes(f));
  });
}

export function getExerciseById(id) {
  return EXERCISE_LIBRARY.find(e => e.id === id);
}

export function buildWorkoutPlan({ setting, level, categories, count = 6 }) {
  let pool = EXERCISE_LIBRARY.filter(e => {
    if (setting && e.setting !== setting) return false;
    if (level && e.level !== level) return false;
    if (categories && !categories.includes(e.category)) return false;
    return true;
  });
  // Shuffle and pick
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function formatExerciseForPrompt(exercise) {
  return `• ${exercise.name} (${exercise.level}) — ${exercise.muscleGroups.join(', ')} | ${exercise.sets}×${exercise.reps} | Rest: ${exercise.rest}\n  Cues: ${exercise.cues.join(' · ')}`;
}

export function buildCoachExerciseContext({ setting, level, categories }) {
  const exercises = buildWorkoutPlan({ setting, level, categories, count: 8 });
  if (!exercises.length) return '';
  return `EXERCISE LIBRARY (${setting?.toUpperCase() || 'ALL'} | ${level?.toUpperCase() || 'ALL LEVELS'}):\n` +
    exercises.map(formatExerciseForPrompt).join('\n');
}

// Stats
export const LIBRARY_STATS = {
  total: EXERCISE_LIBRARY.length,
  gym: EXERCISE_LIBRARY.filter(e => e.setting === 'gym').length,
  home: EXERCISE_LIBRARY.filter(e => e.setting === 'home').length,
  desk: EXERCISE_LIBRARY.filter(e => e.setting === 'desk').length,
  beginner: EXERCISE_LIBRARY.filter(e => e.level === 'beginner').length,
  intermediate: EXERCISE_LIBRARY.filter(e => e.level === 'intermediate').length,
  advanced: EXERCISE_LIBRARY.filter(e => e.level === 'advanced').length,
};
