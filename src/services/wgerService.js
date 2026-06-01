const BASE_URL = 'https://wger.de/api/v2';
const MEDIA_BASE_URL = 'https://wger.de';

const CATEGORY_MAP = {
  8: 'arms',
  9: 'legs',
  10: 'abs',
  11: 'chest',
  12: 'back',
  13: 'shoulders',
  14: 'calves',
};

const EQUIPMENT_MAP = {
  1: 'barbell',
  2: 'sj_barbell',
  3: 'dumbbell',
  4: 'gym_mat',
  5: 'swiss_ball',
  6: 'pull_up_bar',
  7: 'none',
  8: 'bench',
  9: 'incline_bench',
  10: 'kettlebell',
};

const APP_CATEGORY_TO_WGER_ID = Object.fromEntries(
  Object.entries(CATEGORY_MAP).map(([id, name]) => [name, Number(id)]),
);

const APP_EQUIPMENT_TO_WGER_ID = Object.fromEntries(
  Object.entries(EQUIPMENT_MAP).map(([id, name]) => [name, Number(id)]),
);

function resolveCategoryId(category) {
  if (category == null || category === '') return null;
  if (typeof category === 'number') return category;
  const asNum = Number(category);
  if (Number.isFinite(asNum) && CATEGORY_MAP[asNum]) return asNum;
  return APP_CATEGORY_TO_WGER_ID[String(category).toLowerCase()] ?? null;
}

function resolveEquipmentId(equipment) {
  if (equipment == null || equipment === '') return null;
  if (typeof equipment === 'number') return equipment;
  const asNum = Number(equipment);
  if (Number.isFinite(asNum) && EQUIPMENT_MAP[asNum]) return asNum;
  const key = String(equipment).toLowerCase().replace(/\s+/g, '_');
  return APP_EQUIPMENT_TO_WGER_ID[key] ?? null;
}

function pickTranslation(translations = [], language = 2) {
  if (!Array.isArray(translations) || !translations.length) return null;
  return (
    translations.find(t => t.language === language)
    || translations.find(t => t.language === 2)
    || translations[0]
  );
}

function mapMuscles(muscles = []) {
  return muscles.map(m => m.name_en || m.name).filter(Boolean);
}

function mapEquipment(equipment = []) {
  return equipment.map(item => {
    const mapped = EQUIPMENT_MAP[item.id];
    return mapped || item.name || String(item.id);
  });
}

function resolveWgerMediaUrl(url) {
  if (!url) return null;
  if (typeof url !== 'string') return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${MEDIA_BASE_URL}${url}`;
  return url;
}

function parseWgerImages(images = []) {
  const all = [];
  let mainImage = null;

  for (const img of images || []) {
    const rawUrl = img?.image || img?.image_url || null;
    const resolved = resolveWgerMediaUrl(rawUrl);
    if (!resolved) continue;

    if (img?.is_main && !mainImage) mainImage = resolved;
    all.push(resolved);
  }

  // De-dupe while preserving order (and keeping main first)
  const deduped = Array.from(new Set(all));
  const resolvedImages = mainImage
    ? [mainImage, ...deduped.filter(u => u !== mainImage)]
    : deduped;

  return { images: resolvedImages, mainImage: resolvedImages[0] || null };
}

function parseWgerVideos(videos = []) {
  const all = [];
  for (const v of videos || []) {
    const resolved = resolveWgerMediaUrl(v?.video);
    if (resolved) all.push(resolved);
  }
  return Array.from(new Set(all));
}

function normalizeExercise(row, language = 2) {
  const translation = pickTranslation(row.translations, language);
  const categoryId = row.category?.id ?? row.category;
  const { images: inlineImages, mainImage } = parseWgerImages(row.images);

  return {
    id: row.id,
    name: translation?.name || row.name || 'Unknown exercise',
    description: (translation?.description || translation?.description_source || '').trim(),
    category: CATEGORY_MAP[categoryId] || row.category?.name?.toLowerCase() || null,
    categoryId,
    muscles: [
      ...mapMuscles(row.muscles),
      ...mapMuscles(row.muscles_secondary),
    ],
    equipment: mapEquipment(row.equipment),
    mainImage,
    images: inlineImages,
    videos: [],
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Wger API request failed (${response.status}): ${url}`);
  }
  return response.json();
}

function buildExerciseInfoUrl({ language, limit, category, equipment, extra = {} } = {}) {
  const params = new URLSearchParams({
    format: 'json',
    language: String(language),
    limit: String(limit),
  });

  const categoryId = resolveCategoryId(category);
  if (categoryId) params.set('category', String(categoryId));

  const equipmentId = resolveEquipmentId(equipment);
  if (equipmentId) params.set('equipment', String(equipmentId));

  Object.entries(extra).forEach(([key, value]) => {
    if (value != null && value !== '') params.set(key, String(value));
  });

  return `${BASE_URL}/exerciseinfo/?${params.toString()}`;
}

export async function fetchWgerExercises({
  category,
  equipment,
  language = 2,
  limit = 100,
} = {}) {
  const url = buildExerciseInfoUrl({ language, limit, category, equipment });
  const data = await fetchJson(url);

  const exercises = (data.results || []).map(row => normalizeExercise(row, language));
  await attachVideosToExercises(exercises);
  return exercises;
}

// Media caches to avoid re-fetching per exercise across renders and searches.
const imagesCache = new Map(); // exerciseId -> { images: string[], mainImage: string | null }
const videosCache = new Map(); // exerciseId -> string[]

export async function fetchExerciseImages(exerciseId) {
  if (!exerciseId) return [];
  if (imagesCache.has(exerciseId)) return imagesCache.get(exerciseId).images;

  const detail = await fetchJson(`${BASE_URL}/exerciseinfo/${exerciseId}/?format=json`);
  const parsedInline = parseWgerImages(detail.images);
  if (parsedInline.images.length) {
    imagesCache.set(exerciseId, parsedInline);
    return parsedInline.images;
  }

  const data = await fetchJson(
    `${BASE_URL}/exerciseimage/?exercise_base=${encodeURIComponent(exerciseId)}&format=json`,
  );

  const results = (data.results || []).filter(
    img => img.exercise === Number(exerciseId) || img.exercise_uuid === detail.uuid,
  );
  const parsed = parseWgerImages(results);
  imagesCache.set(exerciseId, parsed);
  return parsed.images;
}

export async function fetchExerciseVideos(exerciseId) {
  if (!exerciseId) return [];
  if (videosCache.has(exerciseId)) return videosCache.get(exerciseId);

  const data = await fetchJson(
    `${BASE_URL}/video/?exercise_base=${encodeURIComponent(exerciseId)}&format=json`,
  );
  const parsed = parseWgerVideos(data.results || []);
  videosCache.set(exerciseId, parsed);
  return parsed;
}

async function attachVideosToExercises(exercises) {
  const withVideos = exercises.filter(ex => !ex.videos || !ex.videos.length);
  if (!withVideos.length) return exercises;

  const chunkSize = 10;
  for (let i = 0; i < withVideos.length; i += chunkSize) {
    const chunk = withVideos.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async ex => {
        ex.videos = await fetchExerciseVideos(ex.id);
      }),
    );
  }

  return exercises;
}

export async function searchWgerExercises(query) {
  const term = String(query || '').trim();
  if (!term) return [];

  const url = buildExerciseInfoUrl({
    language: 2,
    limit: 50,
    extra: { name__search: term },
  });

  try {
    const data = await fetchJson(url);
    const exercises = (data.results || []).map(row => normalizeExercise(row, 2));
    await attachVideosToExercises(exercises);
    return exercises;
  } catch (err) {
    console.warn('Wger name__search failed, falling back to legacy search endpoint:', err);

    try {
      const legacy = await fetchJson(
        `${BASE_URL}/exercise/search/?term=${encodeURIComponent(term)}&language=english&format=json`,
      );
      const suggestions = legacy.suggestions || legacy.results || [];
      return suggestions.map(item => ({
        id: item.data?.id || item.id,
        name: item.value || item.label || item.data?.name || '',
        description: item.data?.description || '',
        category: CATEGORY_MAP[item.data?.category] || null,
        categoryId: item.data?.category ?? null,
        muscles: [],
        equipment: [],
        mainImage: null,
        images: [],
        videos: [],
      }));
    } catch {
      return [];
    }
  }
}

export async function getWgerExerciseById(exerciseId, language = 2) {
  if (!exerciseId) return null;

  const row = await fetchJson(
    `${BASE_URL}/exerciseinfo/${encodeURIComponent(exerciseId)}/?format=json&language=${language}`,
  );
  const exercise = normalizeExercise(row, language);

  if (!exercise.images.length) {
    const images = await fetchExerciseImages(exerciseId);
    exercise.images = images;
    exercise.mainImage = imagesCache.get(exerciseId)?.mainImage || null;
  }

  exercise.videos = await fetchExerciseVideos(exerciseId);
  return exercise;
}

export {
  BASE_URL,
  CATEGORY_MAP,
  EQUIPMENT_MAP,
  normalizeExercise,
  resolveCategoryId,
  resolveEquipmentId,
};
