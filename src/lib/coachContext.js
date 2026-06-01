import { buildCoachExerciseContext } from '../data/coachExerciseLibrary';

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

function buildExerciseLibraryBlock(options = {}) {
  return buildCoachExerciseContext({
    setting: normalizeLocation(options.location),
    level: normalizeExperience(options.experience),
  });
}

/** Synchronous exercise library block for prompt injection. */
export function buildCoachReferenceContext(options = {}) {
  return buildExerciseLibraryBlock(options);
}

/** Async version — exercise library context for prompts. */
export async function buildCoachReferenceContextAsync(options = {}) {
  return buildExerciseLibraryBlock(options);
}

export { buildExerciseLibraryBlock };
