import { searchFoodDatabase, macrosForGrams } from '../data/foodDatabase.js';

export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.5) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function normalizeImageBlob(blob) {
  if (!blob) throw new Error('No image file was provided.');

  try {
    const bitmap = await createImageBitmap(blob);
    const maxSide = 320;
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
    return (await canvasToBlob(canvas, 'image/jpeg', 0.4)) || blob;
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

const HUB_SCAN_SYSTEM =
  'You are a nutrition vision API. You MUST always respond with valid JSON. '
  + 'The response MUST contain an "items" array — even for a single food, wrap it in an array with one object. '
  + 'List EVERY visually distinct food separately (e.g. a plate with apple slices, walnuts, and cashews = 3 items). '
  + 'Never merge different foods into one entry. Never duplicate the same food name. '
  + 'Scan the entire plate including sides and corners, not only the largest item. '
  + 'Each item needs: name, weight (grams), calories, protein, carbs, fat — all positive numbers.';

const HUB_SCAN_USER =
  'Analyze this food photo. Return JSON only: '
  + '{"items":[{"name":"Apple slices","weight":180,"calories":95,"protein":0.5,"carbs":25,"fat":0.3},'
  + '{"name":"Walnuts","weight":25,"calories":163,"protein":3.6,"carbs":3.5,"fat":16.3},'
  + '{"name":"Cashews","weight":20,"calories":111,"protein":3.6,"carbs":6,"fat":8.9}],'
  + '"confidence":"high"}';

const FOOD_SCAN_NUTRITION_PROMPT =
  'Analyze this food image. Identify EVERY distinct food item visible. '
  + 'Reply with ONE JSON object only (no markdown). ALWAYS use an "items" array — even for one food. '
  + '{"items":[{"name":"Grilled Chicken","weight":150,"calories":248,"protein":46,"carbs":0,"fat":5}],'
  + '"confidence":"medium"}';

const FOOD_ITEMS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          weight: { type: 'NUMBER' },
          calories: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
        },
        required: ['name', 'weight', 'calories', 'protein', 'carbs', 'fat'],
      },
    },
    confidence: { type: 'STRING' },
  },
  required: ['items'],
};

function parseNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const str = String(value ?? '').replace(/,/g, '').trim();
  if (!str) return 0;
  const match = str.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function parseWeightGrams(servingSize) {
  const direct = parseNumericValue(servingSize);
  if (direct > 0 && /g\b|gram/i.test(String(servingSize || ''))) return direct;
  if (direct > 0 && !/oz|ml|cup|slice|piece/i.test(String(servingSize || ''))) return direct;
  const str = String(servingSize || '').toLowerCase();
  const gMatch = str.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gMatch) return parseFloat(gMatch[1]);
  const ozMatch = str.match(/(\d+(?:\.\d+)?)\s*oz/);
  if (ozMatch) return Math.round(parseFloat(ozMatch[1]) * 28.35);
  return direct > 0 ? direct : 0;
}

function lookupFoodEntry(name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;

  const matches = searchFoodDatabase(q);
  if (matches.length === 0) {
    const words = q.split(/\s+/).filter(w => w.length > 3);
    for (const word of words) {
      const wordMatches = searchFoodDatabase(word);
      if (wordMatches.length > 0) return wordMatches[0];
    }
    return null;
  }

  const exact = matches.find(f => f.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = matches.find(
    f => f.name.toLowerCase().startsWith(q) || q.startsWith(f.name.toLowerCase()),
  );
  return partial || matches[0];
}

function estimateFromLookup(foodName, weightG = 150) {
  const weight = Math.max(1, Math.round(parseNumericValue(weightG) || 150));
  const entry = lookupFoodEntry(foodName);
  if (!entry) {
    return {
      weight,
      calories: Math.max(80, Math.round(weight * 1.1)),
      protein: Math.max(3, Math.round(weight * 0.07 * 10) / 10),
      carbs: Math.max(5, Math.round(weight * 0.15 * 10) / 10),
      fat: Math.max(2, Math.round(weight * 0.04 * 10) / 10),
    };
  }
  const m = macrosForGrams(entry, weight);
  return {
    weight: m.grams,
    calories: m.calories,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
  };
}

function normalizeItemName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function deduplicateHubItems(items) {
  const seen = new Map();
  for (const item of items) {
    const key = normalizeItemName(item.name);
    if (!key) continue;
    const existing = seen.get(key);
    if (existing) {
      existing.weight = Math.round(existing.weight + (item.weight || 0));
      existing.calories += item.calories || 0;
      existing.protein = Math.round((existing.protein + (item.protein || 0)) * 10) / 10;
      existing.carbs = Math.round((existing.carbs + (item.carbs || 0)) * 10) / 10;
      existing.fat = Math.round((existing.fat + (item.fat || 0)) * 10) / 10;
      existing.estimated = existing.estimated || item.estimated;
    } else {
      seen.set(key, { ...item });
    }
  }
  return Array.from(seen.values());
}

export function finalizeScanResult(result) {
  if (!result?.items?.length) return null;
  const items = deduplicateHubItems(
    result.items.map(item => normalizeHubItem(item)),
  );
  if (!items.length) return null;
  return {
    items,
    total: sumHubItems(items),
    confidence: String(result.confidence || 'medium').toLowerCase(),
  };
}

function coerceToItemsPayload(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) {
    return { items: parsed, confidence: 'medium' };
  }
  if (typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.items)) return parsed;
  if (parsed.name || parsed.food_name) {
    return { items: [parsed], confidence: parsed.confidence || 'medium' };
  }
  return parsed;
}

function sumHubItems(items) {
  return items.reduce(
    (t, item) => ({
      calories: t.calories + (Number(item.calories) || 0),
      protein: Math.round((t.protein + (Number(item.protein) || 0)) * 10) / 10,
      carbs: Math.round((t.carbs + (Number(item.carbs) || 0)) * 10) / 10,
      fat: Math.round((t.fat + (Number(item.fat) || 0)) * 10) / 10,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function splitCompositeFoodNames(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return [];

  const parenMatch = cleaned.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inner = parenMatch[1]
      .split(/,\s*|\s+and\s+/i)
      .map(s => s.trim())
      .filter(s => s.length > 2);
    if (inner.length > 1) return inner;
  }

  const parts = cleaned
    .replace(/\([^)]*\)/g, '')
    .split(/\s*(?:,|\+|&|\band\b|\bwith\b|\bx\b)\s*/i)
    .map(s => s.trim().replace(/^(some|mixed|assorted)\s+/i, ''))
    .filter(s => s.length > 2 && !/^(mixed|assorted|bowl|plate|meal|food|snack|nuts)$/i.test(s));

  return parts.length > 1 ? parts : [cleaned];
}

function expandCompositeItems(hubData) {
  if (!hubData?.items?.length) return hubData;

  const expanded = [];
  for (const item of hubData.items) {
    const names = splitCompositeFoodNames(item.name);
    if (names.length <= 1) {
      expanded.push(item);
      continue;
    }

    const weightEach = Math.max(25, Math.round((item.weight || 150) / names.length));
    for (const name of names) {
      const est = estimateFromLookup(name, weightEach);
      expanded.push({ name, ...est, estimated: true });
    }
  }

  const items = expanded.length ? expanded : hubData.items;
  return {
    ...hubData,
    items,
    total: sumHubItems(items),
    confidence: items.some(i => i.estimated) ? 'low' : hubData.confidence,
  };
}

function readNumberFromBlock(block, key) {
  const keys = key.endsWith('_g') ? [key, key.replace(/_g$/, '')] : [key, `${key}_g`];
  for (const k of keys) {
    const re = new RegExp(`"${k}"\\s*:\\s*"?([\\d,]+(?:\\.\\d+)?)"?`, 'i');
    const m = block.match(re);
    if (m) {
      const n = parseNumericValue(m[1]);
      if (n > 0) return n;
    }
  }
  return 0;
}

function extractHubItemsFromText(text) {
  const src = flattenForExtraction(text);

  const bareArray = extractJsonArray(src);
  if (bareArray) {
    try {
      const parsed = JSON.parse(bareArray);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(item => item && typeof item === 'object')
          .map(item => ({
            name: String(item.name || item.food_name || ''),
            weight: readNumberFromBlock(JSON.stringify(item), 'weight')
              || parseWeightGrams(item.serving_size),
            calories: parseNumericValue(item.calories ?? item.kcal),
            protein: parseNumericValue(item.protein ?? item.protein_g),
            carbs: parseNumericValue(item.carbs ?? item.carbs_g),
            fat: parseNumericValue(item.fat ?? item.fat_g),
          }))
          .filter(item => item.name);
      }
    } catch {
      // ignore
    }
  }

  const itemsMatch = src.match(/"items"\s*:\s*(\[[\s\S]*?\])\s*(?:,\s*"|\})/i);
  if (!itemsMatch?.[1]) return [];

  const arrayContent = itemsMatch[1];
  const items = [];
  const objectRe = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*\}/gi;
  let match;
  while ((match = objectRe.exec(arrayContent)) !== null) {
    const block = match[0];
    const name = match[1]?.trim();
    if (!name) continue;
    items.push({
      name,
      weight: readNumberFromBlock(block, 'weight'),
      calories: readNumberFromBlock(block, 'calories'),
      protein: readNumberFromBlock(block, 'protein'),
      carbs: readNumberFromBlock(block, 'carbs'),
      fat: readNumberFromBlock(block, 'fat'),
    });
  }
  return items;
}

function pickBestHubResult(...candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!candidate?.items?.length) continue;
    const normalized = expandCompositeItems(candidate);
    if (!best || normalized.items.length > best.items.length) {
      best = normalized;
      continue;
    }
    if (
      normalized.items.length === best.items.length
      && sumHubItems(normalized.items).calories > sumHubItems(best.items).calories
    ) {
      best = normalized;
    }
  }
  return best;
}

function stripMarkdown(text) {
  return String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

function flattenForExtraction(text) {
  return unescapeJsonString(stripMarkdown(text)).replace(/[\r\n]+/g, ' ').trim();
}

function hasMacroValues(result) {
  return Boolean(
    result
    && (result.calories > 0 || result.protein_g > 0 || result.carbs_g > 0 || result.fat_g > 0),
  );
}

export function extractJsonObject(text) {
  const clean = flattenForExtraction(text);
  const start = clean.indexOf('{');
  if (start === -1) return null;
  const end = clean.lastIndexOf('}');
  const raw = end > start ? clean.slice(start, end + 1) : clean.slice(start);
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

export function extractJsonArray(text) {
  const clean = flattenForExtraction(text);
  const start = clean.indexOf('[');
  if (start === -1) return null;
  const end = clean.lastIndexOf(']');
  if (end <= start) return null;
  return clean.slice(start, end + 1).replace(/[\r\n]+/g, ' ').trim();
}

/** Optional JSON.parse — never throws. Handles objects, bare arrays, and items wrapper. */
export function safeParseJson(text) {
  const attempts = [
    flattenForExtraction(text),
    extractJsonObject(text),
    extractJsonArray(text),
    stripMarkdown(text),
  ].filter(Boolean);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // ignore
    }
    if (candidate.trim().startsWith('[')) {
      try {
        return JSON.parse(candidate);
      } catch {
        // ignore
      }
    }
  }

  const arr = extractJsonArray(text);
  if (arr) {
    try {
      return JSON.parse(arr);
    } catch {
      // ignore
    }
  }

  return null;
}

function unescapeJsonString(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractApiErrorMessage(rawText) {
  const raw = String(rawText || '');
  const msgMatch = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return msgMatch?.[1] ? unescapeJsonString(msgMatch[1]) : '';
}

/** Regex-only — never calls JSON.parse (Safari-safe for truncated responses). */
export function extractGeminiModelText(rawText) {
  const raw = String(rawText || '');

  if (/"error"\s*:/.test(raw)) {
    const message = extractApiErrorMessage(raw);
    if (message) {
      const err = new Error(message);
      err.apiError = { message };
      throw err;
    }
  }

  const textMatch = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (textMatch?.[1]) return unescapeJsonString(textMatch[1]);

  const flat = flattenForExtraction(raw);
  const inner = extractJsonObject(flat);
  if (inner && /food_name|calories|protein|"items"/i.test(inner)) return inner;

  if (/"food_name"|"calories"/.test(flat)) return flat;

  return '';
}

function readStringField(text, key) {
  const src = flattenForExtraction(text);
  const complete = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'));
  if (complete?.[1]) return complete[1].trim();
  const partial = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)`, 'i'));
  return partial?.[1]?.trim() || '';
}

function readNumberField(text, key) {
  const src = flattenForExtraction(text);
  const keys = key.endsWith('_g') ? [key, key.replace(/_g$/, '')] : [key, `${key}_g`];
  for (const k of keys) {
    const patterns = [
      new RegExp(`"${k}"\\s*:\\s*"?([\\d,]+(?:\\.\\d+)?)"?`, 'i'),
      new RegExp(`${k}\\s*:\\s*"?([\\d,]+(?:\\.\\d+)?)"?`, 'i'),
    ];
    for (const re of patterns) {
      const m = src.match(re);
      if (m) {
        const n = parseNumericValue(m[1]);
        if (n > 0) return n;
      }
    }
  }
  return 0;
}

function extractNutritionFromText(text) {
  return {
    food_name: readStringField(text, 'food_name') || readStringField(text, 'name') || 'Unknown food',
    serving_size: readStringField(text, 'serving_size') || readStringField(text, 'serving') || 'Estimated portion',
    calories: readNumberField(text, 'calories') || readNumberField(text, 'kcal'),
    protein_g: readNumberField(text, 'protein_g') || readNumberField(text, 'protein'),
    carbs_g: readNumberField(text, 'carbs_g') || readNumberField(text, 'carbs'),
    fat_g: readNumberField(text, 'fat_g') || readNumberField(text, 'fat'),
    confidence: readStringField(text, 'confidence') || 'medium',
    notes: readStringField(text, 'notes') || readStringField(text, 'tips') || 'AI estimate.',
  };
}

function normalizeFoodResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    food_name: String(raw.food_name || raw.name || raw.label || 'Unknown food'),
    serving_size: String(raw.serving_size || raw.serving || raw.serving_description || 'Estimated portion'),
    calories: parseNumericValue(raw.calories ?? raw.kcal),
    protein_g: parseNumericValue(raw.protein_g ?? raw.protein),
    carbs_g: parseNumericValue(raw.carbs_g ?? raw.carbs),
    fat_g: parseNumericValue(raw.fat_g ?? raw.fat),
    fiber_g: parseNumericValue(raw.fiber_g ?? raw.fiber),
    confidence: String(raw.confidence || 'medium').toLowerCase(),
    notes: String(raw.notes || raw.tips || 'Nutrition is an AI estimate.'),
  };
}

function applyLookupFallback(result) {
  if (!result || result.food_name === 'Unknown food') return result;
  if (hasMacroValues(result)) {
    const grams = parseWeightGrams(result.serving_size);
    if (grams <= 0) {
      const est = estimateFromLookup(result.food_name, 150);
      result.serving_size = `${est.weight}g`;
    }
    return result;
  }

  const weight = parseWeightGrams(result.serving_size) || 150;
  const est = estimateFromLookup(result.food_name, weight);
  return {
    ...result,
    serving_size: `${est.weight}g`,
    calories: est.calories,
    protein_g: est.protein,
    carbs_g: est.carbs,
    fat_g: est.fat,
    confidence: result.confidence === 'high' ? 'medium' : (result.confidence || 'low'),
    notes: 'Estimated from food database (AI did not return macros).',
  };
}

function normalizeHubItem(raw, rawText = '') {
  const name = String(raw?.name || raw?.food_name || readStringField(rawText, 'name') || 'Unknown food');
  let weight = parseNumericValue(raw?.weight ?? raw?.weight_g ?? raw?.grams);
  let calories = parseNumericValue(raw?.calories ?? raw?.kcal);
  let protein = parseNumericValue(raw?.protein ?? raw?.protein_g);
  let carbs = parseNumericValue(raw?.carbs ?? raw?.carbs_g);
  let fat = parseNumericValue(raw?.fat ?? raw?.fat_g);

  if (weight <= 0) weight = parseWeightGrams(raw?.serving_size) || 150;

  const hasMacros = calories > 0 || protein > 0 || carbs > 0 || fat > 0;
  if (!hasMacros && name !== 'Unknown food') {
    const est = estimateFromLookup(name, weight);
    return { name, ...est, estimated: true };
  }

  if (weight <= 0) weight = 150;

  return {
    name,
    weight: Math.round(weight),
    calories: Math.max(calories, 0),
    protein: Math.max(protein, 0),
    carbs: Math.max(carbs, 0),
    fat: Math.max(fat, 0),
    estimated: Boolean(raw?.estimated),
  };
}

export function normalizeHubScanData(data, rawText = '') {
  const coerced = coerceToItemsPayload(data);
  if (!coerced || typeof coerced !== 'object') return null;

  let items = [];
  if (Array.isArray(coerced.items)) {
    items = coerced.items
      .map(item => normalizeHubItem(item, rawText))
      .filter(i => i.name && i.name !== 'Unknown food');
  }

  if (items.length === 0) {
    const single = normalizeFoodResult(coerced);
    if (single?.food_name && single.food_name !== 'Unknown food') {
      items = [normalizeHubItem({
        name: single.food_name,
        weight: parseWeightGrams(single.serving_size),
        calories: single.calories,
        protein: single.protein_g,
        carbs: single.carbs_g,
        fat: single.fat_g,
      }, rawText)];
    }
  }

  if (items.length === 0) return null;

  items = deduplicateHubItems(items.map(item => {
    if (item.calories > 0 || item.protein > 0 || item.carbs > 0 || item.fat > 0) {
      if (item.weight <= 0) {
        const est = estimateFromLookup(item.name, 150);
        return { ...item, weight: est.weight };
      }
      return item;
    }
    return normalizeHubItem({ name: item.name, weight: item.weight }, rawText);
  }));

  const total = sumHubItems(items);
  const confidence = String(
    coerced.confidence || (items.some(i => i.estimated) ? 'low' : 'medium'),
  ).toLowerCase();

  return expandCompositeItems({ items, total, confidence });
}

export function parseHubScanFromText(text) {
  if (!text?.trim()) return null;

  const flat = flattenForExtraction(text);
  const sources = [...new Set([
    flat,
    extractJsonObject(flat),
    extractJsonArray(flat),
  ].filter(Boolean))];

  const candidates = [];

  for (const source of sources) {
    const parsed = coerceToItemsPayload(safeParseJson(source));
    if (parsed) {
      const normalized = normalizeHubScanData(parsed, source);
      if (normalized?.items?.length) candidates.push(normalized);
    }

    const regexItems = extractHubItemsFromText(source);
    if (regexItems.length) {
      const normalized = normalizeHubScanData({ items: regexItems }, source);
      if (normalized?.items?.length) candidates.push(normalized);
    }
  }

  const best = pickBestHubResult(...candidates);
  if (best) return finalizeScanResult(best);

  const single = parseNutritionFromAiText(text);
  if (single) {
    return finalizeScanResult(normalizeHubScanData({
      items: [{
        name: single.food_name,
        weight: parseWeightGrams(single.serving_size) || 150,
        calories: single.calories,
        protein: single.protein_g,
        carbs: single.carbs_g,
        fat: single.fat_g,
      }],
      confidence: single.confidence,
    }, text));
  }

  return null;
}

/** Parse nutrition: JSON when safe, regex fallback, prefer results with macros. */
export function parseNutritionFromAiText(text) {
  const flat = flattenForExtraction(text);
  const sources = [...new Set([flat, extractJsonObject(flat), text].filter(Boolean))];
  let bestNameOnly = null;

  for (const source of sources) {
    const parsed = safeParseJson(source);
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.items) && parsed.items.length) {
        const hub = normalizeHubScanData(parsed, source);
        if (hub?.items?.length) {
          return hub;
        }
      }

      const normalized = normalizeFoodResult(parsed);
      if (normalized?.food_name && normalized.food_name !== 'Unknown food') {
        if (hasMacroValues(normalized)) return applyLookupFallback(normalized);
        if (!bestNameOnly) bestNameOnly = normalized;
      }
    }

    const regexResult = extractNutritionFromText(source);
    if (regexResult.food_name && regexResult.food_name !== 'Unknown food') {
      const normalized = normalizeFoodResult(regexResult);
      if (hasMacroValues(normalized)) return applyLookupFallback(normalized);
      if (!bestNameOnly) bestNameOnly = normalized;
    }
  }

  return bestNameOnly ? applyLookupFallback(bestNameOnly) : null;
}

async function callGeminiVision({
  base64,
  mimeType,
  prompt,
  systemInstruction,
  signal,
  maxOutputTokens = 512,
  responseSchema = null,
}) {
  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens,
  };

  if (responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }

  const body = {
    model: 'gemini-2.5-flash',
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig,
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let response = await fetch('/api/gemini', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status === 503) {
    await new Promise(r => setTimeout(r, 1500));
    response = await fetch('/api/gemini', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const rawText = await response.text();

  if (!response.ok) {
    const apiMsg = extractApiErrorMessage(rawText);
    throw new Error(apiMsg || `Gemini error ${response.status}`);
  }

  const aiText = extractGeminiModelText(rawText);
  return { rawText, aiText, response };
}

export const scanFoodHub = async (imageFile, { signal } = {}) => {
  try {
    const { base64, mimeType } = await imageToGeminiPayload(imageFile);
    const { aiText, rawText } = await callGeminiVision({
      base64,
      mimeType,
      prompt: HUB_SCAN_USER,
      systemInstruction: HUB_SCAN_SYSTEM,
      signal,
      maxOutputTokens: 2048,
      responseSchema: FOOD_ITEMS_RESPONSE_SCHEMA,
    });

    const result = parseHubScanFromText(aiText) ?? parseHubScanFromText(rawText);
    const finalized = finalizeScanResult(result);
    if (finalized?.items?.length) {
      if (finalized.total.calories > 0 || finalized.total.protein > 0) return finalized;
    }

    throw new Error('Could not analyze image. Try again with a clearer photo.');
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Food hub scan error:', msg);
    if (/json|parse|eof|unterminated/i.test(msg)) {
      throw new Error('Analysis incomplete. Please try again.');
    }
    throw err;
  }
};

export const scanFood = async (imageFile, { signal } = {}) => {
  try {
    const { base64, mimeType } = await imageToGeminiPayload(imageFile);
    const { aiText, rawText } = await callGeminiVision({
      base64,
      mimeType,
      prompt: FOOD_SCAN_NUTRITION_PROMPT,
      signal,
      maxOutputTokens: 2048,
      responseSchema: FOOD_ITEMS_RESPONSE_SCHEMA,
    });

    const hubResult = finalizeScanResult(
      parseHubScanFromText(aiText) ?? parseHubScanFromText(rawText),
    );
    if (hubResult?.items?.length) {
      if (hubResult.items.length > 1) {
        return applyLookupFallback(normalizeFoodResult({
          food_name: hubResult.items.map(i => i.name).join(', '),
          serving_size: `${hubResult.items.reduce((s, i) => s + (i.weight || 0), 0)}g`,
          calories: hubResult.total.calories,
          protein_g: hubResult.total.protein,
          carbs_g: hubResult.total.carbs,
          fat_g: hubResult.total.fat,
          confidence: hubResult.confidence,
          notes: `${hubResult.items.length} items detected.`,
        }));
      }
      const item = hubResult.items[0];
      return applyLookupFallback(normalizeFoodResult({
        food_name: item.name,
        serving_size: `${item.weight}g`,
        calories: item.calories,
        protein_g: item.protein,
        carbs_g: item.carbs,
        fat_g: item.fat,
        confidence: hubResult.confidence,
      }));
    }

    const result = parseNutritionFromAiText(aiText || rawText);
    if (result) return result;

    throw new Error('Could not identify food in image. Try again with a clearer photo.');
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Food scan error:', msg);
    if (/json|parse|eof|unterminated/i.test(msg)) {
      throw new Error('Analysis incomplete. Please try again.');
    }
    throw err;
  }
};

export function extractJson(text) {
  return extractJsonObject(text);
}

export const analyzeFoodImage = async (base64Image, { mimeType = 'image/jpeg', signal } = {}) => {
  const requestDebug = {
    model: 'gemini-2.5-flash',
    mimeType,
    base64Length: base64Image?.length || 0,
  };

  if (!base64Image) throw new Error('No image data captured.');

  let rawText = '';
  let aiText = '';
  let response;

  try {
    ({ rawText, aiText, response } = await callGeminiVision({
      base64: base64Image,
      mimeType,
      signal,
      prompt: FOOD_SCAN_NUTRITION_PROMPT,
    }));
  } catch (error) {
    const wrapped = new Error(
      `Gemini network error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
    wrapped.details = requestDebug;
    throw wrapped;
  }

  const responseDebug = {
    ...requestDebug,
    status: response.status,
    statusText: response.statusText,
    errorMessage: extractApiErrorMessage(rawText),
    rawText: aiText || rawText.slice(0, 500),
  };

  const normalized = parseNutritionFromAiText(`${aiText}\n${rawText}`);
  if (!normalized) {
    const error = new Error(
      `Gemini did not return nutrition data. Raw response: ${(aiText || rawText).slice(0, 240) || '(empty)'}`,
    );
    error.details = responseDebug;
    throw error;
  }

  return { ...normalized, debug: responseDebug };
};
