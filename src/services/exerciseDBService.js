const BASE_URL = 'https://exercisedb.dev/api/v1';
const EXERCISES_JSON_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

let allExercisesCache = null;
let bodyPartListCache = null;
const bodyPartCache = new Map();
const searchCache = new Map();

async function fetchExerciseDB(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`ExerciseDB request failed (${response.status}): ${path}`);
  }
  return response.json();
}

export function clearExerciseCache() {
  allExercisesCache = null;
}

export async function fetchAllExercises(limit = 1300) {
  if (allExercisesCache) return allExercisesCache;
  try {
    const response = await fetch(EXERCISES_JSON_URL);
    if (!response.ok) {
      throw new Error(`ExerciseDB request failed (${response.status}): exercises.json`);
    }
    const data = await response.json();
    allExercisesCache = Array.isArray(data) ? data.slice(0, Number(limit) || 1300) : [];
    return allExercisesCache;
  } catch (err) {
    console.error('[ExerciseDB] Failed to fetch exercises.json:', err);
    return [];
  }
}

export async function fetchByBodyPart(bodyPart) {
  const key = String(bodyPart || '').trim().toLowerCase();
  if (!key) return [];
  if (bodyPartCache.has(key)) return bodyPartCache.get(key);
  const encoded = encodeURIComponent(key);
  const data = await fetchExerciseDB(`/exercises/bodyPart/${encoded}`);
  const list = Array.isArray(data) ? data : [];
  bodyPartCache.set(key, list);
  return list;
}

export async function searchExercises(query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return [];
  if (searchCache.has(term)) return searchCache.get(term);
  const encoded = encodeURIComponent(term);
  const data = await fetchExerciseDB(`/exercises/name/${encoded}`);
  const list = Array.isArray(data) ? data : [];
  searchCache.set(term, list);
  return list;
}

export async function fetchBodyPartList() {
  if (bodyPartListCache) return bodyPartListCache;
  const data = await fetchExerciseDB('/exercises/bodyPartList');
  bodyPartListCache = Array.isArray(data) ? data : [];
  return bodyPartListCache;
}

export { BASE_URL, EXERCISES_JSON_URL };
