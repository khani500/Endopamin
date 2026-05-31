/**
 * Coach exercise library — movement patterns, regressions/progressions,
 * filtered by environment, level, and equipment.
 */

export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'core',
  'mobility',
];

export const COACH_EXERCISE_LIBRARY = [
  // ── SQUAT PATTERN ──
  {
    id: 'sit_to_stand',
    name: 'Sit to Stand',
    pattern: 'squat',
    environments: ['home', 'desk'],
    levels: ['beginner'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: ['box_squat', 'goblet_squat'],
    prescription: '3 x 10 to 15, controlled tempo',
    contraindications: [],
  },
  {
    id: 'box_squat',
    name: 'Box Squat',
    pattern: 'squat',
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate'],
    equipment: ['bodyweight', 'bench', 'dumbbell', 'barbell', 'squat_rack'],
    regressions: ['sit_to_stand'],
    progressions: ['goblet_squat', 'barbell_back_squat'],
    prescription: '3 to 4 x 8 to 12',
    contraindications: ['acute_knee'],
  },
  {
    id: 'goblet_squat',
    name: 'Goblet Squat',
    pattern: 'squat',
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate'],
    equipment: ['dumbbell', 'kettlebell'],
    regressions: ['box_squat'],
    progressions: ['front_squat', 'barbell_back_squat'],
    prescription: '3 to 4 x 8 to 12 @ RPE 7',
    contraindications: ['acute_knee'],
  },
  {
    id: 'barbell_back_squat',
    name: 'Barbell Back Squat',
    pattern: 'squat',
    environments: ['gym'],
    levels: ['intermediate', 'advanced'],
    equipment: ['barbell', 'squat_rack'],
    regressions: ['goblet_squat', 'box_squat'],
    progressions: ['front_squat', 'pause_squat'],
    prescription: '4 x 5 to 8 @ RPE 7 to 8',
    contraindications: ['acute_knee', 'acute_lower_back'],
  },
  {
    id: 'split_squat',
    name: 'Bulgarian Split Squat',
    pattern: 'squat',
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['bodyweight', 'dumbbell', 'bench'],
    regressions: ['reverse_lunge'],
    progressions: ['weighted_split_squat'],
    prescription: '3 x 8 to 10 each leg',
    contraindications: ['acute_knee'],
  },
  // ── HINGE ──
  {
    id: 'hip_hinge_wall',
    name: 'Wall Hip Hinge Drill',
    pattern: 'hinge',
    environments: ['home', 'desk', 'gym'],
    levels: ['beginner'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: ['glute_bridge', 'romanian_deadlift'],
    prescription: '2 x 10 slow reps',
    contraindications: [],
  },
  {
    id: 'glute_bridge',
    name: 'Glute Bridge',
    pattern: 'hinge',
    environments: ['home', 'gym'],
    levels: ['beginner', 'intermediate'],
    equipment: ['bodyweight', 'barbell', 'dumbbell'],
    regressions: ['hip_hinge_wall'],
    progressions: ['hip_thrust', 'romanian_deadlift'],
    prescription: '3 x 12 to 15',
    contraindications: [],
  },
  {
    id: 'romanian_deadlift',
    name: 'Romanian Deadlift',
    pattern: 'hinge',
    environments: ['gym', 'home'],
    levels: ['intermediate', 'advanced'],
    equipment: ['barbell', 'dumbbell', 'kettlebell'],
    regressions: ['glute_bridge', 'hip_hinge_wall'],
    progressions: ['conventional_deadlift', 'single_leg_rdl'],
    prescription: '3 to 4 x 6 to 10 @ RPE 7',
    contraindications: ['acute_lower_back'],
  },
  {
    id: 'conventional_deadlift',
    name: 'Conventional Deadlift',
    pattern: 'hinge',
    environments: ['gym'],
    levels: ['intermediate', 'advanced'],
    equipment: ['barbell'],
    regressions: ['romanian_deadlift', 'trap_bar_deadlift'],
    progressions: ['deficit_deadlift'],
    prescription: '3 to 5 x 3 to 6 @ RPE 7 to 8',
    contraindications: ['acute_lower_back'],
  },
  // ── HORIZONTAL PUSH ──
  {
    id: 'incline_push_up',
    name: 'Incline Push-Up',
    pattern: 'horizontal_push',
    environments: ['home', 'gym', 'desk'],
    levels: ['beginner'],
    equipment: ['bodyweight', 'bench'],
    regressions: ['wall_push_up'],
    progressions: ['push_up', 'dumbbell_bench'],
    prescription: '3 x 8 to 15',
    contraindications: ['acute_shoulder'],
  },
  {
    id: 'push_up',
    name: 'Push-Up',
    pattern: 'horizontal_push',
    environments: ['home', 'gym', 'desk'],
    levels: ['beginner', 'intermediate'],
    equipment: ['bodyweight'],
    regressions: ['incline_push_up'],
    progressions: ['dumbbell_bench', 'barbell_bench'],
    prescription: '3 to 4 x 8 to 20',
    contraindications: ['acute_shoulder', 'acute_wrist'],
  },
  {
    id: 'dumbbell_bench',
    name: 'Dumbbell Bench Press',
    pattern: 'horizontal_push',
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['dumbbell', 'bench'],
    regressions: ['push_up'],
    progressions: ['barbell_bench'],
    prescription: '3 to 4 x 6 to 12',
    contraindications: ['acute_shoulder'],
  },
  {
    id: 'barbell_bench',
    name: 'Barbell Bench Press',
    pattern: 'horizontal_push',
    environments: ['gym'],
    levels: ['intermediate', 'advanced'],
    equipment: ['barbell', 'bench'],
    regressions: ['dumbbell_bench', 'push_up'],
    progressions: ['close_grip_bench'],
    prescription: '4 x 5 to 8 @ RPE 7 to 8',
    contraindications: ['acute_shoulder'],
  },
  // ── VERTICAL PUSH ──
  {
    id: 'scapular_wall_slide',
    name: 'Scapular Wall Slide',
    pattern: 'vertical_push',
    environments: ['desk', 'home', 'gym'],
    levels: ['beginner'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: ['dumbbell_shoulder_press', 'overhead_press'],
    prescription: '2 x 10 slow',
    contraindications: [],
  },
  {
    id: 'dumbbell_shoulder_press',
    name: 'Dumbbell Shoulder Press',
    pattern: 'vertical_push',
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['dumbbell'],
    regressions: ['scapular_wall_slide', 'pike_push_up'],
    progressions: ['overhead_press'],
    prescription: '3 to 4 x 6 to 12',
    contraindications: ['acute_shoulder'],
  },
  {
    id: 'overhead_press',
    name: 'Barbell Overhead Press',
    pattern: 'vertical_push',
    environments: ['gym'],
    levels: ['intermediate', 'advanced'],
    equipment: ['barbell', 'squat_rack'],
    regressions: ['dumbbell_shoulder_press'],
    progressions: ['push_press'],
    prescription: '4 x 5 to 8 @ RPE 7',
    contraindications: ['acute_shoulder'],
  },
  // ── HORIZONTAL PULL ──
  {
    id: 'band_row',
    name: 'Band Row',
    pattern: 'horizontal_pull',
    environments: ['home', 'desk', 'gym'],
    levels: ['beginner', 'intermediate'],
    equipment: ['resistance', 'bodyweight'],
    regressions: [],
    progressions: ['dumbbell_row', 'cable_row'],
    prescription: '3 x 12 to 15',
    contraindications: [],
  },
  {
    id: 'dumbbell_row',
    name: 'Dumbbell Row',
    pattern: 'horizontal_pull',
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['dumbbell', 'bench'],
    regressions: ['band_row'],
    progressions: ['cable_row', 'barbell_row'],
    prescription: '3 to 4 x 8 to 12 each arm',
    contraindications: ['acute_lower_back'],
  },
  {
    id: 'cable_row',
    name: 'Cable Seated Row',
    pattern: 'horizontal_pull',
    environments: ['gym'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['cables'],
    regressions: ['band_row', 'dumbbell_row'],
    progressions: ['chest_supported_row'],
    prescription: '3 to 4 x 8 to 12',
    contraindications: [],
  },
  // ── VERTICAL PULL ──
  {
    id: 'lat_pulldown',
    name: 'Lat Pulldown',
    pattern: 'vertical_pull',
    environments: ['gym'],
    levels: ['beginner', 'intermediate'],
    equipment: ['cables', 'pull_up'],
    regressions: ['band_pulldown'],
    progressions: ['pull_up'],
    prescription: '3 to 4 x 8 to 12',
    contraindications: ['acute_shoulder'],
  },
  {
    id: 'pull_up',
    name: 'Pull-Up',
    pattern: 'vertical_pull',
    environments: ['gym', 'home'],
    levels: ['intermediate', 'advanced'],
    equipment: ['pull_up', 'bodyweight'],
    regressions: ['lat_pulldown', 'band_pulldown'],
    progressions: ['weighted_pull_up'],
    prescription: '4 x 4 to 8 @ RPE 7',
    contraindications: ['acute_shoulder'],
  },
  // ── CARRY ──
  {
    id: 'farmers_carry',
    name: 'Farmer Carry',
    pattern: 'carry',
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['dumbbell', 'kettlebell'],
    regressions: ['suitcase_carry'],
    progressions: ['heavy_farmers_carry'],
    prescription: '3 x 20 to 40 m',
    contraindications: ['acute_lower_back'],
  },
  // ── CORE ──
  {
    id: 'dead_bug',
    name: 'Dead Bug',
    pattern: 'core',
    environments: ['home', 'gym', 'desk'],
    levels: ['beginner', 'intermediate'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: ['plank', 'pallof_press'],
    prescription: '3 x 8 each side',
    contraindications: [],
  },
  {
    id: 'plank',
    name: 'Plank',
    pattern: 'core',
    environments: ['home', 'gym', 'desk'],
    levels: ['beginner', 'intermediate'],
    equipment: ['bodyweight'],
    regressions: ['dead_bug'],
    progressions: ['rkc_plank', 'ab_wheel'],
    prescription: '3 x 30 to 60 s',
    contraindications: ['acute_shoulder'],
  },
  {
    id: 'pallof_press',
    name: 'Pallof Press',
    pattern: 'core',
    environments: ['gym', 'home'],
    levels: ['intermediate', 'advanced'],
    equipment: ['cables', 'resistance'],
    regressions: ['dead_bug'],
    progressions: ['heavier_pallof'],
    prescription: '3 x 10 each side',
    contraindications: [],
  },
  // ── MOBILITY / DESK ──
  {
    id: 'hip_flexor_stretch',
    name: 'Half-Kneeling Hip Flexor Stretch',
    pattern: 'mobility',
    environments: ['desk', 'home', 'gym'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: [],
    prescription: '2 x 30 s each side',
    contraindications: ['acute_knee'],
  },
  {
    id: 'thoracic_rotation',
    name: 'Quadruped Thoracic Rotation',
    pattern: 'mobility',
    environments: ['desk', 'home', 'gym'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: [],
    prescription: '2 x 8 each side',
    contraindications: [],
  },
  {
    id: 'desk_sit_stand',
    name: 'Sit-Stand Desk Break',
    pattern: 'mobility',
    environments: ['desk'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: ['desk_march', 'desk_squat'],
    prescription: '10 sit-stand reps every 60 min',
    contraindications: [],
  },
  {
    id: 'desk_march',
    name: 'March in Place',
    pattern: 'mobility',
    environments: ['desk'],
    levels: ['beginner', 'intermediate', 'advanced'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: ['desk_bodyweight_squat'],
    prescription: '2 min light march',
    contraindications: [],
  },
  {
    id: 'band_pulldown',
    name: 'Band Lat Pulldown',
    pattern: 'vertical_pull',
    environments: ['home'],
    levels: ['beginner'],
    equipment: ['resistance'],
    regressions: [],
    progressions: ['lat_pulldown', 'pull_up'],
    prescription: '3 x 12 to 15',
    contraindications: [],
  },
  {
    id: 'wall_push_up',
    name: 'Wall Push-Up',
    pattern: 'horizontal_push',
    environments: ['desk', 'home'],
    levels: ['beginner'],
    equipment: ['bodyweight'],
    regressions: [],
    progressions: ['incline_push_up', 'push_up'],
    prescription: '3 x 10 to 15',
    contraindications: [],
  },
  {
    id: 'reverse_lunge',
    name: 'Reverse Lunge',
    pattern: 'squat',
    environments: ['home', 'gym'],
    levels: ['beginner', 'intermediate'],
    equipment: ['bodyweight', 'dumbbell'],
    regressions: ['sit_to_stand'],
    progressions: ['split_squat', 'walking_lunge'],
    prescription: '3 x 8 each leg',
    contraindications: ['acute_knee'],
  },
  {
    id: 'front_squat',
    name: 'Front Squat',
    pattern: 'squat',
    environments: ['gym'],
    levels: ['advanced'],
    equipment: ['barbell', 'squat_rack'],
    regressions: ['goblet_squat'],
    progressions: [],
    prescription: '4 x 4 to 6 @ RPE 8',
    contraindications: ['acute_knee', 'acute_wrist'],
  },
];

const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

const INJURY_KEYWORDS = {
  acute_knee: ['knee', 'acl', 'meniscus', 'patella'],
  acute_lower_back: ['back', 'lumbar', 'disc', 'spine'],
  acute_shoulder: ['shoulder', 'rotator', 'impingement'],
  acute_wrist: ['wrist', 'carpal'],
};

function normalizeLocation(location) {
  const loc = String(location || 'gym').toLowerCase();
  if (loc.includes('desk') || loc.includes('office')) return 'desk';
  if (loc.includes('home')) return 'home';
  return 'gym';
}

function normalizeExperience(experience) {
  const exp = String(experience || 'intermediate').toLowerCase();
  if (exp.includes('begin')) return 'beginner';
  if (exp.includes('adv')) return 'advanced';
  return 'intermediate';
}

function parseInjuryFlags(injuries) {
  const text = Array.isArray(injuries)
    ? injuries.join(' ').toLowerCase()
    : String(injuries || '').toLowerCase();
  if (!text || text.includes('none')) return new Set();

  const flags = new Set();
  Object.entries(INJURY_KEYWORDS).forEach(([flag, keywords]) => {
    if (keywords.some(kw => text.includes(kw))) flags.add(flag);
  });
  return flags;
}

function hasEquipment(exercise, available) {
  const avail = new Set(
    (Array.isArray(available) ? available : [available])
      .filter(Boolean)
      .map(item => String(item).toLowerCase()),
  );
  if (!avail.size) return exercise.equipment.includes('bodyweight');

  return exercise.equipment.some(eq => {
    if (eq === 'bodyweight') return true;
    return [...avail].some(a => a.includes(eq) || eq.includes(a));
  });
}

function levelAllowed(exercise, athleteLevel) {
  const rank = LEVEL_RANK[athleteLevel] ?? 1;
  return exercise.levels.some(l => (LEVEL_RANK[l] ?? 1) <= rank + 1 && (LEVEL_RANK[l] ?? 1) >= rank - 1)
    || exercise.levels.includes(athleteLevel);
}

/** Filter library for athlete context; returns up to maxPerPattern exercises per pattern. */
export function getExercisesForContext({
  location = 'gym',
  experience = 'intermediate',
  equipment = [],
  injuries = '',
  maxPerPattern = 2,
} = {}) {
  const env = normalizeLocation(location);
  const lvl = normalizeExperience(experience);
  const injuryFlags = parseInjuryFlags(injuries);

  const filtered = COACH_EXERCISE_LIBRARY.filter(exercise => {
    if (!exercise.environments.includes(env)) return false;
    if (!levelAllowed(exercise, lvl)) return false;
    if (!hasEquipment(exercise, equipment)) return false;
    if (exercise.contraindications.some(c => injuryFlags.has(c))) return false;
    return true;
  });

  const byPattern = {};
  filtered.forEach(exercise => {
    if (!byPattern[exercise.pattern]) byPattern[exercise.pattern] = [];
    if (byPattern[exercise.pattern].length < maxPerPattern) {
      byPattern[exercise.pattern].push(exercise);
    }
  });

  return Object.values(byPattern).flat();
}

export function resolveExerciseChain(exerciseId) {
  const exercise = COACH_EXERCISE_LIBRARY.find(e => e.id === exerciseId);
  if (!exercise) return null;

  const regressions = exercise.regressions
    .map(id => COACH_EXERCISE_LIBRARY.find(e => e.id === id)?.name)
    .filter(Boolean);
  const progressions = exercise.progressions
    .map(id => COACH_EXERCISE_LIBRARY.find(e => e.id === id)?.name)
    .filter(Boolean);

  return { exercise, regressions, progressions };
}

export function formatExerciseLibraryForPrompt(exercises) {
  if (!exercises?.length) {
    return `EXERCISE LIBRARY: No matching exercises for this environment/equipment — use bodyweight regressions from NASM/NSCA progression models.`;
  }

  const lines = exercises.map(exercise => {
    const reg = exercise.regressions
      .map(id => COACH_EXERCISE_LIBRARY.find(e => e.id === id)?.name)
      .filter(Boolean)
      .join(', ');
    const prog = exercise.progressions
      .map(id => COACH_EXERCISE_LIBRARY.find(e => e.id === id)?.name)
      .filter(Boolean)
      .join(', ');

    return `- ${exercise.name} (${exercise.pattern}): ${exercise.prescription}. Regress: ${reg || 'none'}. Progress: ${prog || 'none'}.`;
  });

  return `APPROVED EXERCISE LIBRARY (prescribe ONLY from this list for today's environment, level, and equipment — use regressions/progressions as needed):
${lines.join('\n')}`;
}

export function buildExerciseLibraryBlock(options = {}) {
  const exercises = getExercisesForContext(options);
  return formatExerciseLibraryForPrompt(exercises);
}
