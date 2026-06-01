const BASE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist';
const IMAGE_BASE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

let allExercisesCache = null;
let bodyPartListCache = null;
const bodyPartCache = new Map();
const searchCache = new Map();

async function fetchExerciseDB(path = '/exercises.json') {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`ExerciseDB request failed (${response.status}): ${path}`);
  }
  return response.json();
}

function toImageUrl(imagePath) {
  if (!imagePath) return null;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  return `${IMAGE_BASE_URL}/${imagePath}`;
}

function mapLevel(level) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'beginner') return 'beginner';
  if (normalized === 'intermediate') return 'intermediate';
  if (normalized === 'expert') return 'expert';
  return 'intermediate';
}

function normalizeExercise(exercise = {}) {
  const category = String(exercise.category || '').toLowerCase();
  const images = Array.isArray(exercise.images)
    ? exercise.images.map(toImageUrl).filter(Boolean)
    : [];

  return {
    ...exercise,
    bodyPart: null,
    category,
    level: mapLevel(exercise.level),
    target: Array.isArray(exercise.primaryMuscles) ? exercise.primaryMuscles[0] : null,
    muscles: Array.isArray(exercise.primaryMuscles) ? exercise.primaryMuscles : [],
    muscles_secondary: Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [],
    images,
    thumbnailUrl: images[0] || null,
    hoverImageUrl: images[1] || null,
  };
}

export async function fetchAllExercises(limit = 1300) {
  if (allExercisesCache) return allExercisesCache;
  const data = await fetchExerciseDB('/exercises.json');
  const normalized = Array.isArray(data) ? data.map(normalizeExercise) : [];
  console.log('ExerciseDB dataset fields sample (first 3):', normalized.slice(0, 3));
  console.log('ExerciseDB categories:', Array.from(new Set(normalized.map(ex => ex.category))).sort());
  console.log('ExerciseDB bodyPart values:', Array.from(new Set(normalized.map(ex => ex.bodyPart))).sort());
  allExercisesCache = normalized.slice(0, Number(limit) || 1300);
  return allExercisesCache;
}

export async function fetchByBodyPart(bodyPart) {
  const key = String(bodyPart || '').trim().toLowerCase();
  if (!key) return [];
  if (bodyPartCache.has(key)) return bodyPartCache.get(key);
  const all = await fetchAllExercises();
  const list = all.filter(ex => String(ex.bodyPart || '').toLowerCase() === key);
  bodyPartCache.set(key, list);
  return list;
}

export async function searchExercises(query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return [];
  if (searchCache.has(term)) return searchCache.get(term);
  const all = await fetchAllExercises();
  const list = all.filter(ex => String(ex.name || '').toLowerCase().includes(term));
  searchCache.set(term, list);
  return list;
}

export async function fetchBodyPartList() {
  if (bodyPartListCache) return bodyPartListCache;
  const all = await fetchAllExercises();
  bodyPartListCache = Array.from(
    new Set(
      all
        .map(ex => String(ex.bodyPart || '').toLowerCase())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
  return bodyPartListCache;
}

export { BASE_URL };
