import { buildCoachExerciseContext } from '../data/coachExerciseLibrary';
import { fetchWgerExercises, searchWgerExercises } from '../services/wgerService';

const EXERCISE_QUERY_PATTERN =
  /\b(exercise|exercises|workout|lift|lifting|movement|squat|bench|deadlift|curl|press|row|pull-up|pullup|push-up|pushup|reps|sets|form|technique|muscle|muscles|training|chest|back|legs|arms|shoulders|abs|core|glutes|hamstrings|biceps|triceps|lateral raise|leg press|lat pulldown)\b/i;

const CATEGORY_KEYWORDS = {
  arms: /\b(arms?|biceps?|triceps?|curl|skull crusher|extension)\b/i,
  legs: /\b(legs?|quads?|hamstrings?|glutes?|squat|lunge|leg press|calf)\b/i,
  chest: /\b(chest|pecs?|bench|push.?up|fly|flye)\b/i,
  back: /\b(back|lats?|row|pull.?up|pulldown|deadlift)\b/i,
  shoulders: /\b(shoulders?|delts?|overhead|ohp|lateral raise|front raise)\b/i,
  abs: /\b(abs|abdominal|core|plank|crunch|sit.?up)\b/i,
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

function buildExerciseLibraryBlock(options = {}) {
  return buildCoachExerciseContext({
    setting: normalizeLocation(options.location),
    level: normalizeExperience(options.experience),
  });
}

function formatWgerExerciseForPrompt(exercise) {
  const muscles = exercise.muscles?.length ? exercise.muscles.join(', ') : 'general';
  const equipment = exercise.equipment?.length ? exercise.equipment.join(', ') : 'bodyweight';
  const description = exercise.description
    ? ` — ${exercise.description.slice(0, 120)}${exercise.description.length > 120 ? '…' : ''}`
    : '';
  return `- ${exercise.name} (${exercise.category || 'general'} | ${muscles} | ${equipment})${description}`;
}

export function isExerciseRelatedQuery(message) {
  return EXERCISE_QUERY_PATTERN.test(String(message || ''));
}

export function detectExerciseCategory(message) {
  const text = String(message || '');
  for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
    if (pattern.test(text)) return category;
  }
  return null;
}

/** Fetch top Wger exercises when the user asks about training moves; empty if not relevant or API fails. */
export async function buildWgerExercisePromptContext(message, options = {}) {
  if (!isExerciseRelatedQuery(message)) return '';

  const category = detectExerciseCategory(message);
  const equipment = Array.isArray(options.equipment) ? options.equipment[0] : options.equipment;

  try {
    let exercises = [];

    if (category) {
      exercises = await fetchWgerExercises({
        category,
        equipment,
        limit: 5,
      });
    } else {
      const searchTerm = String(message || '').trim();
      exercises = await searchWgerExercises(searchTerm);
      if (!exercises.length) {
        exercises = await fetchWgerExercises({ limit: 5 });
      }
    }

    exercises = exercises.slice(0, 5);
    if (!exercises.length) return '';

    return `WGER EXERCISE REFERENCE (live API — prefer these names when relevant):\n${exercises.map(formatWgerExerciseForPrompt).join('\n')}`;
  } catch (err) {
    console.warn('Wger exercise context unavailable, using local library only:', err);
    return '';
  }
}

/** Synchronous exercise library block for prompt injection. */
export function buildCoachReferenceContext(options = {}) {
  return buildExerciseLibraryBlock(options);
}

/** Async version — local library plus optional Wger context when userMessage mentions exercises. */
export async function buildCoachReferenceContextAsync(options = {}) {
  const base = buildExerciseLibraryBlock(options);
  const wgerBlock = options.userMessage
    ? await buildWgerExercisePromptContext(options.userMessage, options)
    : '';

  if (wgerBlock) return `${base}\n\n${wgerBlock}`;
  return base;
}

export { buildExerciseLibraryBlock };
