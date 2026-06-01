import { buildExerciseLibraryBlock, getExercisesForContext } from '../data/coachExerciseLibrary';

function isBeginnerExperience(experience) {
  return String(experience || '').toLowerCase().includes('begin');
}

/** Synchronous exercise library block for prompt injection. */
export function buildCoachReferenceContext({
  location = 'gym',
  experience = 'intermediate',
  equipment = [],
  injuries = '',
  goal = 'maintenance',
} = {}) {
  const beginner = isBeginnerExperience(experience);
  return buildExerciseLibraryBlock({
    location,
    experience,
    equipment,
    injuries,
    maxPerPattern: beginner ? 3 : 2,
  });
}

/** Async version — exercise library only (knowledge comes from buildKnowledgeContext). */
export async function buildCoachReferenceContextAsync(options = {}) {
  return buildExerciseLibraryBlock({
    location: options.location,
    experience: options.experience,
    equipment: options.equipment,
    injuries: options.injuries,
    maxPerPattern: isBeginnerExperience(options.experience) ? 3 : 2,
  });
}

export { getExercisesForContext, buildExerciseLibraryBlock };
