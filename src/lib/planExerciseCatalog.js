import { EXERCISE_LIBRARY } from '../data/coachExerciseLibrary';

function levelRank(level) {
  if (level === 'beginner') return 1;
  if (level === 'advanced') return 3;
  return 2;
}

/** Curated exercise names from the validated library for Gemini prompts. */
export function buildExerciseCatalogForPrompt(profile = {}) {
  const setting = profile.location === 'home' || profile.equipment === 'bodyweight' ? 'home' : 'gym';
  const level = profile.experience || 'intermediate';
  const userRank = levelRank(level);

  const filtered = EXERCISE_LIBRARY.filter(ex => {
    if (ex.setting !== setting) return false;
    return levelRank(ex.level) <= userRank + 1;
  });

  const byCategory = {};
  for (const ex of filtered) {
    const key = ex.category || 'general';
    if (!byCategory[key]) byCategory[key] = [];
    if (byCategory[key].length < 8) {
      byCategory[key].push(`${ex.name} (${ex.sets}×${ex.reps}, rest ${ex.rest})`);
    }
  }

  return Object.entries(byCategory)
    .map(([cat, names]) => `${cat}: ${names.join('; ')}`)
    .join('\n');
}
