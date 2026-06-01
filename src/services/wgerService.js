const BASE_URL = 'https://wger.de/api/v2';

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

function mapImages(images = []) {
  return images
    .map(img => img.image || img.image_url || null)
    .filter(Boolean);
}

function normalizeExercise(row, language = 2) {
  const translation = pickTranslation(row.translations, language);
  const categoryId = row.category?.id ?? row.category;
  const inlineImages = mapImages(row.images);

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
    images: inlineImages,
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
  return (data.results || []).map(row => normalizeExercise(row, language));
}

export async function fetchExerciseImages(exerciseId) {
  if (!exerciseId) return [];

  const detail = await fetchJson(`${BASE_URL}/exerciseinfo/${exerciseId}/?format=json`);
  const inlineImages = mapImages(detail.images);
  if (inlineImages.length) return inlineImages;

  const data = await fetchJson(
    `${BASE_URL}/exerciseimage/?exercise_base=${encodeURIComponent(exerciseId)}&format=json`,
  );

  return (data.results || [])
    .filter(img => img.exercise === Number(exerciseId) || img.exercise_uuid === detail.uuid)
    .map(img => img.image)
    .filter(Boolean);
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
    return (data.results || []).map(row => normalizeExercise(row, 2));
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
        images: [],
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
    exercise.images = await fetchExerciseImages(exerciseId);
  }

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
