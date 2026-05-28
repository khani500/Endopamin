const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();

export const SCAN_PROGRESS = {
  IDENTIFYING: 'identifying',
  FETCHING: 'fetching',
  DONE: 'done',
};

export const SCAN_PROGRESS_LABELS = {
  [SCAN_PROGRESS.IDENTIFYING]: 'Identifying food...',
  [SCAN_PROGRESS.FETCHING]: 'Fetching nutrition data...',
  [SCAN_PROGRESS.DONE]: 'Done!',
};

export class ScanFoodError extends Error {
  constructor(userMessage, code = 'UNKNOWN') {
    super(userMessage);
    this.name = 'ScanFoodError';
    this.userMessage = userMessage;
    this.code = code;
  }
}

export function getScanErrorMessage(err) {
  if (err instanceof ScanFoodError) return err.userMessage;
  return 'Could not analyze this image. Try another photo with better lighting.';
}

function isNetworkError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    err instanceof TypeError
    || msg.includes('network')
    || msg.includes('failed to fetch')
    || msg.includes('load failed')
  );
}

function attachBasePortion(result, portionGrams) {
  return {
    ...result,
    base_portion_grams: Math.max(1, Number(portionGrams) || parsePortionGrams(result.serving_size)),
    portion_grams: Math.max(1, Number(portionGrams) || parsePortionGrams(result.serving_size)),
  };
}

export function scaleFoodByPortion(result, portionGrams) {
  const base = Math.max(
    1,
    Number(result.base_portion_grams) || parsePortionGrams(result.serving_size) || 100,
  );
  const target = Math.max(1, Number(portionGrams) || base);
  const factor = target / base;
  const round1 = n => Math.round(n * 10) / 10;

  return {
    ...result,
    calories: Math.round((Number(result.calories) || 0) * factor),
    protein_g: round1((Number(result.protein_g) || 0) * factor),
    carbs_g: round1((Number(result.carbs_g) || 0) * factor),
    fat_g: round1((Number(result.fat_g) || 0) * factor),
    serving_size: `${Math.round(target)}g`,
    portion_grams: Math.round(target),
    base_portion_grams: Math.round(base),
  };
}

export function foodResultToLogEntry(result) {
  return {
    name: result.food_name,
    kcal: Number(result.calories) || 0,
    protein: Number(result.protein_g) || 0,
    carbs: Number(result.carbs_g) || 0,
    fat: Number(result.fat_g) || 0,
  };
}

export async function saveNutritionLog(supabase, { userId, foodName, calories, protein, carbs, fat }) {
  if (!supabase || !userId) {
    return { error: null, skipped: true };
  }

  const { error } = await supabase.from('nutrition_logs').insert({
    user_id: userId,
    meal_name: foodName,
    calories: Math.round(calories),
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    meal_type: 'snack',
    logged_at: new Date().toISOString(),
  });

  return { error, skipped: false };
}

const FOOD_VISION_MODEL = import.meta.env.VITE_GEMINI_FOOD_MODEL?.trim() || 'gemini-1.5-flash';
const FOOD_VISION_FALLBACK_MODEL = 'gemini-2.0-flash';
const USDA_API_KEY = import.meta.env.VITE_USDA_API_KEY?.trim() || 'DEMO_KEY';

export const FOOD_VISION_PROMPT = `Analyze this food image. Identify all visible food items and estimate portions.
If you see a barcode, extract the barcode number.
Return ONLY valid JSON (no markdown, no explanation):
{
  "foods": [
    {
      "name": "food name in English",
      "portion": "estimated portion (e.g. 100g, 1 cup, 1 piece)",
      "barcode": "barcode number or null",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0
    }
  ],
  "totalCalories": 0,
  "totalProtein": 0,
  "totalCarbs": 0,
  "totalFat": 0
}`;

const GEMINI_NUTRITION_PROMPT = (foodName, serving) => `Estimate nutrition for: ${foodName}
Portion: ${serving}

Return ONLY JSON:
{
  "food_name": "${foodName.replace(/"/g, '')}",
  "serving_size": "${String(serving).replace(/"/g, '')}",
  "calories": 0,
  "protein_g": 0,
  "carbs_g": 0,
  "fat_g": 0,
  "fiber_g": 0,
  "confidence": "medium",
  "notes": "AI estimate"
}`;

function useGeminiProxy() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1';
}

function extractText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
}

function extractJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return clean.slice(start, end + 1);
}

function parseJsonSafe(text) {
  const jsonText = extractJson(text);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.7) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function normalizeImageBlob(blob) {
  if (!blob) throw new Error('No image file was provided.');

  try {
    const bitmap = await createImageBitmap(blob);
    const maxSide = 800;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create image canvas.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return (await canvasToBlob(canvas)) || blob;
  } catch (error) {
    console.warn('Could not normalize image to JPEG, using original blob:', error);
    return blob;
  }
}

export async function imageToGeminiPayload(blob) {
  const normalizedBlob = await normalizeImageBlob(blob);
  const base64 = await blobToBase64(normalizedBlob);
  const mimeType = normalizedBlob.type || 'image/jpeg';
  return {
    base64,
    mimeType,
    byteSize: normalizedBlob.size || blob.size || 0,
    originalMimeType: blob.type || 'unknown',
  };
}

export function parsePortionGrams(portion) {
  const text = String(portion || '');
  const grams = text.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (grams) return Math.max(1, Number(grams[1]));
  return 100;
}

function sumFoodMacros(foods) {
  return foods.reduce(
    (a, f) => ({
      calories: a.calories + (Number(f.calories) || 0),
      protein: a.protein + (Number(f.protein) || 0),
      carbs: a.carbs + (Number(f.carbs) || 0),
      fat: a.fat + (Number(f.fat) || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function normalizeBarcode(value) {
  if (value == null || value === 'null' || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

function parseVisionAnalysis(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  if (Array.isArray(parsed.foods) && parsed.foods.length > 0) {
    const foods = parsed.foods.map(item => ({
      name: String(item.name || item.food_name || 'Unknown food').trim(),
      portion: String(item.portion || item.serving || 'Estimated portion').trim(),
      barcode: normalizeBarcode(item.barcode),
      calories: Math.round(Number(item.calories) || 0),
      protein: Math.round((Number(item.protein) || 0) * 10) / 10,
      carbs: Math.round((Number(item.carbs) || 0) * 10) / 10,
      fat: Math.round((Number(item.fat) || 0) * 10) / 10,
      portion_grams: parsePortionGrams(item.portion),
    }));

    const summed = sumFoodMacros(foods);
    const totals = {
      calories: Math.round(Number(parsed.totalCalories) || summed.calories),
      protein: Math.round((Number(parsed.totalProtein) || summed.protein) * 10) / 10,
      carbs: Math.round((Number(parsed.totalCarbs) || summed.carbs) * 10) / 10,
      fat: Math.round((Number(parsed.totalFat) || summed.fat) * 10) / 10,
    };

    const barcode = foods.map(f => f.barcode).find(Boolean) || null;
    const food_name =
      foods.length === 1 ? foods[0].name : foods.map(f => f.name).join(' + ');
    const serving_description =
      foods.length === 1
        ? foods[0].portion
        : foods.map(f => `${f.name} (${f.portion})`).join('; ');

    return {
      foods,
      barcode,
      totals,
      food_name,
      serving_description,
      portion_grams: foods.reduce((s, f) => s + f.portion_grams, 0) || 100,
      is_packaged: Boolean(barcode),
    };
  }

  if (parsed.food_name) {
    return {
      foods: [
        {
          name: String(parsed.food_name).trim(),
          portion: String(parsed.serving_description || parsed.food_name).trim(),
          barcode: normalizeBarcode(parsed.barcode),
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          portion_grams: Math.max(1, Number(parsed.portion_grams) || 100),
        },
      ],
      barcode: normalizeBarcode(parsed.barcode),
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      food_name: String(parsed.food_name).trim(),
      serving_description: String(parsed.serving_description || parsed.food_name).trim(),
      portion_grams: Math.max(1, Number(parsed.portion_grams) || 100),
      is_packaged: Boolean(parsed.is_packaged),
    };
  }

  return null;
}

function normalizeFoodResult(raw, extra = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const result = {
    food_name: String(raw.food_name || raw.name || raw.label || 'Unknown food'),
    serving_size: String(
      raw.serving_size || raw.serving_description || raw.serving || 'Estimated portion',
    ),
    calories: Math.round(Number(raw.calories ?? raw.kcal ?? raw.totalCalories) || 0),
    protein_g: Math.round((Number(raw.protein_g ?? raw.protein ?? raw.totalProtein) || 0) * 10) / 10,
    carbs_g: Math.round((Number(raw.carbs_g ?? raw.carbs ?? raw.totalCarbs) || 0) * 10) / 10,
    fat_g: Math.round((Number(raw.fat_g ?? raw.fat ?? raw.totalFat) || 0) * 10) / 10,
    fiber_g: Math.round((Number(raw.fiber_g ?? raw.fiber) || 0) * 10) / 10,
    confidence: String(raw.confidence || 'medium').toLowerCase(),
    notes: String(raw.notes || extra.notes || 'Nutrition estimate.'),
    source: extra.source || raw.source || 'gemini',
    barcode: extra.barcode || raw.barcode || null,
  };
  if (Array.isArray(raw.foods)) {
    result.foods = raw.foods;
  }
  return result;
}

function visionAnalysisToResult(analysis, extra = {}) {
  return normalizeFoodResult(
    {
      food_name: analysis.food_name,
      serving_size: analysis.serving_description,
      calories: analysis.totals.calories,
      protein_g: analysis.totals.protein,
      carbs_g: analysis.totals.carbs,
      fat_g: analysis.totals.fat,
      foods: analysis.foods,
      confidence: 'medium',
    },
    extra,
  );
}

async function callGeminiVision(base64, mimeType, prompt, model = FOOD_VISION_MODEL) {
  const isProduction = useGeminiProxy();
  const apiKey = GEMINI_API_KEY;

  if (!isProduction && !apiKey) {
    throw new Error('Gemini API key missing. Add VITE_GEMINI_API_KEY to .env.local and restart Vite.');
  }

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };

  let response;
  if (isProduction) {
    response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model, action: 'generateContent' }),
    });
  } else {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Gemini vision failed (${response.status})`);
  }

  const text = extractText(data);
  if (!text) throw new Error('Gemini returned an empty vision response.');
  return text;
}

async function runVisionAnalysis(base64, mimeType) {
  let lastError;
  for (const model of [FOOD_VISION_MODEL, FOOD_VISION_FALLBACK_MODEL]) {
    try {
      const text = await callGeminiVision(base64, mimeType, FOOD_VISION_PROMPT, model);
      const parsed = parseJsonSafe(text);
      const analysis = parseVisionAnalysis(parsed);
      if (analysis) {
        return { ...analysis, vision_model: model, raw_text: text };
      }
      lastError = new Error('Could not parse vision JSON.');
    } catch (err) {
      lastError = err;
      console.warn(`Vision analyze failed (${model}):`, err.message);
    }
  }
  throw lastError || new Error('Food vision analysis failed.');
}

function scalePer100g(per100, grams) {
  const factor = grams / 100;
  return {
    calories: Math.round((per100.calories || 0) * factor),
    protein_g: Math.round((per100.protein_g || 0) * factor * 10) / 10,
    carbs_g: Math.round((per100.carbs_g || 0) * factor * 10) / 10,
    fat_g: Math.round((per100.fat_g || 0) * factor * 10) / 10,
    fiber_g: Math.round((per100.fiber_g || 0) * factor * 10) / 10,
  };
}

export async function fetchOpenFoodFacts(barcode) {
  const code = String(barcode || '').replace(/\D/g, '');
  if (code.length < 8) return null;

  const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const n = p.nutriments || {};
  const per100 = {
    calories: Number(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
    protein_g: Number(n.proteins_100g ?? 0),
    carbs_g: Number(n.carbohydrates_100g ?? 0),
    fat_g: Number(n.fat_100g ?? 0),
    fiber_g: Number(n.fiber_100g ?? 0),
  };

  const servingGrams = Number(p.serving_quantity) || 100;
  const scaled = scalePer100g(per100, servingGrams);

  return normalizeFoodResult(
    {
      food_name: p.product_name || p.generic_name || 'Packaged food',
      serving_size: p.serving_size || `${servingGrams}g serving`,
      ...scaled,
      confidence: 'high',
      notes: `Open Food Facts · ${p.brands || 'packaged product'}`,
    },
    { source: 'openfoodfacts', barcode: code },
  );
}

function usdaNutrient(food, nutrientId) {
  const list = food.foodNutrients || [];
  const hit = list.find(n => n.nutrientId === nutrientId || n.nutrientNumber === String(nutrientId));
  return Number(hit?.value ?? hit?.amount ?? 0) || 0;
}

export async function fetchUSDAFood(foodName, portionGrams = 100) {
  const query = encodeURIComponent(String(foodName || '').trim());
  if (!query) return null;

  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${query}&pageSize=1&api_key=${USDA_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const food = data.foods?.[0];
  if (!food) return null;

  const per100 = {
    calories: usdaNutrient(food, 1008),
    protein_g: usdaNutrient(food, 1003),
    carbs_g: usdaNutrient(food, 1005),
    fat_g: usdaNutrient(food, 1004),
    fiber_g: usdaNutrient(food, 1079) || usdaNutrient(food, 2033),
  };

  const servingText = food.servingSize
    ? `${food.servingSize}${food.servingSizeUnit ? ` ${food.servingSizeUnit}` : ''}`
    : `${portionGrams}g portion`;

  const baseGrams = Number(food.servingSize) || portionGrams || 100;
  const targetGrams = portionGrams || baseGrams;
  const scaled = scalePer100g(per100, targetGrams);

  return normalizeFoodResult(
    {
      food_name: food.description || foodName,
      serving_size: servingText,
      ...scaled,
      confidence: 'high',
      notes: 'USDA FoodData Central',
    },
    { source: 'usda' },
  );
}

async function callGeminiText(prompt, model = FOOD_VISION_FALLBACK_MODEL) {
  const isProduction = useGeminiProxy();
  const apiKey = GEMINI_API_KEY;

  if (!isProduction && !apiKey) {
    throw new Error('Gemini API key missing. Add VITE_GEMINI_API_KEY to .env.local and restart Vite.');
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
  };

  let response;
  if (isProduction) {
    response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model, action: 'generateContent' }),
    });
  } else {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || 'Gemini text request failed.');
  }
  return extractText(data);
}

async function geminiNutritionFallback(foodName, servingDescription) {
  const prompt = GEMINI_NUTRITION_PROMPT(foodName, servingDescription);
  const text = await callGeminiText(prompt);
  const parsed = parseJsonSafe(text);
  if (!parsed) throw new Error('Could not parse Gemini nutrition JSON.');
  return normalizeFoodResult(parsed, { source: 'gemini', notes: 'AI nutrition estimate' });
}

async function resolveNutrition(vision) {
  const barcode = vision.barcode;
  const hasVisionMacros = vision.totals.calories > 0;
  let warning = null;
  let result = null;

  if (barcode) {
    try {
      const off = await fetchOpenFoodFacts(barcode);
      if (off) {
        if (vision.foods.length === 1) {
          result = { ...off, foods: vision.foods };
        } else {
          const offItem = vision.foods.find(f => f.barcode === barcode) || vision.foods[0];
          const otherFoods = vision.foods.filter(f => f.barcode !== barcode);
          const otherTotals = sumFoodMacros(otherFoods);
          result = normalizeFoodResult(
            {
              food_name: vision.food_name,
              serving_size: vision.serving_description,
              calories: off.calories + otherTotals.calories,
              protein_g: off.protein_g + otherTotals.protein,
              carbs_g: off.carbs_g + otherTotals.carbs,
              fat_g: off.fat_g + otherTotals.fat,
              foods: vision.foods,
              confidence: 'high',
              notes: `Open Food Facts (${offItem.name}) + vision estimate for other items`,
            },
            { source: 'openfoodfacts', barcode },
          );
        }
      } else {
        warning = 'Barcode not found in database';
      }
    } catch (err) {
      console.warn('Open Food Facts failed:', err);
      warning = isNetworkError(err) ? 'Network error — using AI estimate' : 'Barcode not found in database';
    }
  }

  if (!result) {
    try {
      const usda = await fetchUSDAFood(vision.food_name, vision.portion_grams);
      if (usda) {
        result = { ...usda, foods: vision.foods };
      }
    } catch (err) {
      console.warn('USDA lookup failed:', err);
      if (!warning && isNetworkError(err)) {
        warning = 'Network error — using AI estimate';
      }
    }
  }

  if (!result && hasVisionMacros) {
    result = visionAnalysisToResult(vision, {
      source: 'gemini',
      notes: 'Gemini vision estimate',
      barcode,
    });
  }

  if (!result) {
    try {
      const fallback = await geminiNutritionFallback(vision.food_name, vision.serving_description);
      result = { ...fallback, foods: vision.foods };
      if (!warning) warning = 'Network error — using AI estimate';
    } catch (err) {
      console.warn('Gemini nutrition fallback failed:', err);
      if (hasVisionMacros) {
        result = visionAnalysisToResult(vision, {
          source: 'gemini',
          notes: 'Gemini vision estimate',
          barcode,
        });
      }
    }
  }

  if (!result) {
    throw new ScanFoodError('No food detected', 'NO_FOOD');
  }

  return attachBasePortion({ ...result, warning }, vision.portion_grams);
}

export const scanFood = async (imageFile, { onProgress } = {}) => {
  const report = phase => {
    if (phase) onProgress?.(phase);
  };

  report(SCAN_PROGRESS.IDENTIFYING);

  const { base64, mimeType } = await imageToGeminiPayload(imageFile);
  console.log('Scanning food, image size:', base64.length, 'mime:', mimeType);

  let vision;
  try {
    vision = await runVisionAnalysis(base64, mimeType);
  } catch (err) {
    console.warn('Vision failed, trying Gemini text fallback:', err);
    try {
      const fallback = await geminiNutritionFallback('meal in photo', 'estimated portion');
      report(SCAN_PROGRESS.FETCHING);
      report(SCAN_PROGRESS.DONE);
      return attachBasePortion(
        {
          ...fallback,
          warning: 'Network error — using AI estimate',
          source: 'gemini',
        },
        100,
      );
    } catch {
      throw new ScanFoodError('No food detected', 'NO_FOOD');
    }
  }

  console.log('Vision analysis:', vision);

  const hasValidFood =
    vision.foods?.length > 0
    && vision.foods.some(f => f.name && !/^unknown/i.test(f.name));

  if (!hasValidFood) {
    try {
      const fallback = await geminiNutritionFallback(vision.food_name || 'meal', vision.serving_description);
      report(SCAN_PROGRESS.FETCHING);
      report(SCAN_PROGRESS.DONE);
      return attachBasePortion({ ...fallback, warning: null, foods: vision.foods }, vision.portion_grams);
    } catch {
      throw new ScanFoodError('No food detected', 'NO_FOOD');
    }
  }

  report(SCAN_PROGRESS.FETCHING);
  const result = await resolveNutrition(vision);
  report(SCAN_PROGRESS.DONE);
  return result;
};

/** @deprecated Use scanFood — kept for compatibility */
export const analyzeFoodImage = async (base64Image, { mimeType = 'image/jpeg' } = {}) => {
  const blob = await (await fetch(`data:${mimeType};base64,${base64Image}`)).blob();
  return scanFood(blob);
};
