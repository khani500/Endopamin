const API_KEY = import.meta.env.VITE_EXERCISEDB_KEY;
const cache = {};

// Wger.de — completely free, no API key needed, has real exercise images
const WGER_IDS = {
  'barbell back squat': 8,
  'flat bench press': 192,
  'romanian deadlift': 91,
  'weighted pull-ups': 31,
  'overhead press': 72,
  'cable row': 61,
  'hack squat': 355,
  'incline dumbbell press': 265,
  'lat pulldown': 59,
  'tricep pushdown': 29,
  'calf raises': 53,
  'diamond push-ups': 22,
  'jump squats': 95,
  'burpees': 364,
  'mountain climbers': 213,
  'pike push-ups': 22,
  'glute bridge march': 99,
  'hollow body hold': 213,
  'bear crawl': 213,
  'deep squat hold': 8,
  'pistol squat': 95,
  'hack squat': 355,
  'face pulls': 61,
};

const NAME_MAP = {
  'barbell back squat': 'barbell squat',
  'flat bench press': 'barbell bench press',
  'romanian deadlift': 'romanian deadlift',
  'weighted pull-ups': 'pull up',
  'overhead press': 'barbell overhead press',
  'cable row': 'cable seated row',
  'hack squat': 'hack squat',
  'incline dumbbell press': 'dumbbell incline press',
  'lat pulldown': 'cable pulldown',
  'tricep pushdown': 'cable pushdown',
  'face pulls': 'cable rear delt row',
  'calf raises': 'calf raise',
  'diamond push-ups': 'push up',
  'jump squats': 'jump squat',
  'burpees': 'burpee',
  'pistol squat': 'pistol squat',
  'mountain climbers': 'mountain climber',
  'pike push-ups': 'pike push up',
  'plank to push-up': 'push up',
  'glute bridge march': 'glute bridge',
  'hollow body hold': 'hollow body hold',
  'bear crawl': 'bear crawl',
  'deep squat hold': 'squat',
};

async function getWgerImage(exerciseName) {
  const wgerId = WGER_IDS[exerciseName];
  if (!wgerId) return null;
  try {
    const res = await fetch(`https://wger.de/api/v2/exerciseimage/?exercise_base=${wgerId}&format=json&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0]?.image || null;
  } catch { return null; }
}

export async function getExerciseData(exerciseName) {
  const key = exerciseName.toLowerCase();
  if (cache[key]) return cache[key];

  let gifUrl = null;
  let instructions = [];
  let target = '';
  let bodyPart = '';
  let equipment = '';
  let secondaryMuscles = [];

  // Get image from Wger (free, no key needed)
  gifUrl = await getWgerImage(key);

  // Get instructions from ExerciseDB API
  if (API_KEY) {
    try {
      const mapped = NAME_MAP[key] || key;
      const res = await fetch(`/exercisedb/exercises/name/${encodeURIComponent(mapped)}?limit=1`, {
        headers: {
          'X-RapidAPI-Key': API_KEY,
          'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.[0]) {
          instructions = data[0].instructions || [];
          target = data[0].target || '';
          bodyPart = data[0].bodyPart || '';
          equipment = data[0].equipment || '';
          secondaryMuscles = data[0].secondaryMuscles || [];
          if (data[0].gifUrl?.startsWith('http')) {
            gifUrl = data[0].gifUrl;
          }
        }
      }
    } catch { /* use wger fallback */ }
  }

  const result = { gifUrl, target, bodyPart, equipment, instructions, secondaryMuscles };
  cache[key] = result;
  return result;
}
