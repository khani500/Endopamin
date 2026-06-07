export function normalizeNutritionGoal(goal) {
  const g = String(goal || '').toLowerCase();
  if (g.includes('fat') || g.includes('loss') || g === 'cut') return 'fat_loss';
  if (g.includes('muscle') || g.includes('bulk') || g.includes('gain')) return 'muscle_gain';
  if (g.includes('maintain')) return 'maintain';
  return 'default';
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
