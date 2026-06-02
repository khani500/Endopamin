import { EXERCISE_LIBRARY } from '../data/coachExerciseLibrary';

const EQUIPMENT_MAP = {
  full_gym:    ['barbell', 'dumbbell', 'cable', 'machine', 'leg press machine', 'squat rack', 'pull-up bar', 'bench', 'kettlebell', 'resistance band'],
  home_basic:  ['dumbbell', 'resistance band', 'pull-up bar', 'bench'],
  bodyweight:  ['bodyweight', 'pull-up bar'],
  home_full:   ['dumbbell', 'barbell', 'resistance band', 'pull-up bar', 'bench', 'kettlebell'],
};

const RISK_OVERRIDES = {
  beginner_return: ['gym_sq_003', 'gym_hl_003'],
};

export function getFilteredExercises({ setting = 'gym', fitnessLevel, availableEquipment = 'full_gym', isReturning = false }) {
  const allowedEquipment = EQUIPMENT_MAP[availableEquipment] || EQUIPMENT_MAP['full_gym'];

  const levelMap = {
    beginner:     ['beginner'],
    intermediate: ['beginner', 'intermediate'],
    advanced:     ['beginner', 'intermediate', 'advanced'],
  };
  const allowedLevels = levelMap[fitnessLevel] || ['beginner'];

  return EXERCISE_LIBRARY.filter(ex => {
    if (ex.setting !== setting && setting !== 'all') return false;
    if (!allowedLevels.includes(ex.level)) return false;
    if (isReturning && RISK_OVERRIDES.beginner_return.includes(ex.id)) return false;
    const hasEquipment = ex.equipment.some(e => allowedEquipment.includes(e) || e === 'bodyweight');
    if (!hasEquipment) return false;
    return true;
  });
}

export function buildExerciseSummary(exercises) {
  const byCategory = {};
  exercises.forEach(ex => {
    if (!byCategory[ex.category]) byCategory[ex.category] = [];
    byCategory[ex.category].push(`${ex.name} (${ex.level})`);
  });

  return Object.entries(byCategory)
    .map(([cat, names]) => `${cat}: ${names.slice(0, 5).join(', ')}`)
    .join('\n');
}
