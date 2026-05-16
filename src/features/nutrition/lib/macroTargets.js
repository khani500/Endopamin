/**
 * Client-side macro / calorie estimate from goal + activity (replace with server TDEE when API exists).
 * @param {{ goal: 'cut'|'bulk'|'maintain'; activity: string; currentWeightKg: number }} input
 */
export function estimateDailyTargets({ goal, activity, currentWeightKg }) {
  const w = Math.max(40, Number(currentWeightKg) || 70);
  const factors = { sedentary: 1.2, light: 1.35, moderate: 1.5, active: 1.65, athlete: 1.8 };
  const f = factors[activity] ?? 1.5;
  const bmrApprox = 10 * w + 6.25 * 175 - 5 * 28 + 5; // rough constant height/age — tune via API
  let tdee = bmrApprox * f;
  if (goal === 'cut') tdee -= 400;
  if (goal === 'bulk') tdee += 350;
  const kcal = Math.round(Math.max(1400, tdee));
  const protein = Math.round(w * (goal === 'bulk' ? 2.1 : goal === 'cut' ? 2.0 : 1.75));
  const fat = Math.round((kcal * 0.28) / 9);
  let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  carbs = Math.max(90, carbs);
  return {
    targetCalories: kcal,
    targetProtein: protein,
    targetCarbs: carbs,
    targetFat: fat,
  };
}
