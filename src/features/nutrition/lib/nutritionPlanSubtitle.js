import { normalizeAthleteGoal } from '../../../lib/gemini';

export function normalizeNutritionGoal(goal) {
  const normalized = normalizeAthleteGoal(goal);
  if (normalized === 'maintain' && !goal) return 'default';
  return normalized;
}

export function getNutritionPlanSubtitle(goal, mealCount = 0) {
  const normalized = normalizeNutritionGoal(goal);
  const meals = Math.max(0, Number(mealCount) || 0);
  const mealLabel = `${meals} meals/day`;

  if (normalized === 'fat_loss') return `High protein deficit plan · ${mealLabel}`;
  if (normalized === 'muscle_gain') return `Lean bulk nutrition plan · ${mealLabel}`;
  if (normalized === 'maintain') return `Balanced maintenance plan · ${mealLabel}`;
  return `Personalized nutrition plan · ${mealLabel}`;
}
