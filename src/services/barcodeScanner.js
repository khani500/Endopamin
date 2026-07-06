/**
 * Independent barcode lookup pipeline — Open Food Facts + Gemini fallback.
 * Output shape matches NutritionHub scan results: { items[], total, confidence }.
 */

import { getAuthHeaders } from '../lib/gemini.js';

const OFF_TIMEOUT_MS = 8000;
const OFF_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Endopamin/1.0',
};

function parseNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function normalizeBarcode(barcode) {
  return String(barcode || '').replace(/\D/g, '').trim();
}

export function sumBarcodeItems(items) {
  return items.reduce(
    (t, item) => ({
      calories: t.calories + (Number(item.calories) || 0),
      protein: round1(t.protein + (Number(item.protein) || 0)),
      carbs: round1(t.carbs + (Number(item.carbs) || 0)),
      fat: round1(t.fat + (Number(item.fat) || 0)),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Single food item in the shared scanner format. */
export function toFoodItem({ name, weight, calories, protein, carbs, fat }) {
  return {
    name: String(name || 'Unknown product'),
    weight: Math.max(1, Math.round(parseNum(weight) || 100)),
    calories: Math.max(0, Math.round(parseNum(calories))),
    protein: Math.max(0, round1(parseNum(protein))),
    carbs: Math.max(0, round1(parseNum(carbs))),
    fat: Math.max(0, round1(parseNum(fat))),
  };
}

export function toScanResult(items, confidence = 'medium', meta = {}) {
  const list = (Array.isArray(items) ? items : [items]).map(item => toFoodItem(item));
  return {
    items: list,
    total: sumBarcodeItems(list),
    confidence: String(confidence || 'medium').toLowerCase(),
    ...meta,
  };
}

export function scaleFoodItem(item, grams) {
  const weight = Math.max(1, Math.round(parseNum(grams) || item.weight || 100));
  const baseWeight = Math.max(1, item.weight || 100);
  const scale = weight / baseWeight;
  return toFoodItem({
    name: item.name,
    weight,
    calories: (item.calories || 0) * scale,
    protein: (item.protein || 0) * scale,
    carbs: (item.carbs || 0) * scale,
    fat: (item.fat || 0) * scale,
  });
}

function parseJsonFromText(text) {
  const raw = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const startObj = raw.indexOf('{');
  const endObj = raw.lastIndexOf('}');
  if (startObj !== -1 && endObj > startObj) {
    try {
      return JSON.parse(raw.slice(startObj, endObj + 1));
    } catch {
      // ignore
    }
  }
  return null;
}

function extractGeminiText(rawText) {
  const raw = String(rawText || '');
  const textMatch = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (textMatch?.[1]) {
    return textMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return raw;
}

function productHasNutritionData(product) {
  const n = product?.nutriments || {};
  const calories = parseNum(n['energy-kcal_100g'] ?? n['energy-kcal']);
  const protein = parseNum(n.proteins_100g ?? n.proteins);
  const carbs = parseNum(n.carbohydrates_100g ?? n.carbohydrates);
  const fat = parseNum(n.fat_100g ?? n.fat);
  return calories > 0 || protein > 0 || carbs > 0 || fat > 0;
}

function isNetworkFailure(err) {
  if (!err) return false;
  if (err.name === 'TypeError') return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('network') || msg.includes('failed to fetch') || msg.includes('load failed');
}

function parseOffProduct(product, barcode, weightG = null) {
  const n = product.nutriments || {};
  const per100 = {
    calories: parseNum(n['energy-kcal_100g'] ?? n['energy-kcal']),
    protein: parseNum(n.proteins_100g ?? n.proteins),
    carbs: parseNum(n.carbohydrates_100g ?? n.carbohydrates),
    fat: parseNum(n.fat_100g ?? n.fat),
  };

  const servingG = weightG != null
    ? parseNum(weightG)
    : parseNum(product.serving_quantity) || 100;
  const scale = servingG / 100;

  const name = product.product_name || product.product_name_en || 'Unknown product';
  const brand = product.brands || '';
  const displayName = brand ? `${name} (${brand})` : name;

  const item = toFoodItem({
    name: displayName,
    weight: servingG,
    calories: per100.calories * scale,
    protein: per100.protein * scale,
    carbs: per100.carbs * scale,
    fat: per100.fat * scale,
  });

  return toScanResult([item], 'high', {
    barcode,
    source: 'openfoodfacts',
    brand,
    imageUrl: product.image_front_small_url || product.image_url || '',
    per100,
    servingG: Math.round(servingG),
  });
}

async function fetchOffProductOnce(barcode, { signal } = {}) {
  const code = normalizeBarcode(barcode);
  if (!code) throw new Error('Invalid barcode');

  const fields = [
    'product_name',
    'product_name_en',
    'brands',
    'serving_quantity',
    'nutriments',
    'image_front_small_url',
    'image_url',
    'code',
  ].join(',');

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`,
      { signal: controller.signal, headers: OFF_HEADERS },
    );

    if (!res.ok) throw new Error('Product not found');
    const data = await res.json();
    if (data.status !== 1 || !data.product) throw new Error('Product not found');
    return data.product;
  } catch (err) {
    if (err?.name === 'AbortError' && !signal?.aborted) {
      throw new Error('Open Food Facts request timed out');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function fetchFromOpenFoodFacts(barcode, { signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchOffProductOnce(barcode, { signal });
    } catch (err) {
      lastError = err;
      if (attempt === 0 && isNetworkFailure(err) && !signal?.aborted) {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('Product not found');
}

export async function fetchFromGeminiFallback(barcode, { signal } = {}) {
  const code = normalizeBarcode(barcode);
  const body = {
    model: 'gemini-2.5-flash',
    contents: [{
      parts: [{
        text:
          `Identify the most likely packaged food product for barcode ${code}. `
          + 'Estimate realistic nutrition for one standard serving. '
          + 'Return JSON only with keys: name, weight, calories, protein, carbs, fat. '
          + 'Example: {"name":"Granola Bar","weight":100,"calories":165,"protein":10,"carbs":20,"fat":5}',
      }],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
    },
  };

  const response = await fetch('/api/gemini', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Barcode lookup failed (${response.status})`);
  }

  const aiText = extractGeminiText(rawText);
  const parsed = parseJsonFromText(aiText) || parseJsonFromText(rawText);
  if (!parsed?.name) throw new Error('Could not identify product from barcode');

  const item = toFoodItem(parsed);
  return toScanResult([item], 'low', {
    barcode: code,
    source: 'gemini',
    estimated: true,
  });
}

export async function lookupBarcodeProduct(barcode, { weightG, signal } = {}) {
  const code = normalizeBarcode(barcode);
  if (!code) throw new Error('Invalid barcode');

  try {
    const product = await fetchFromOpenFoodFacts(code, { signal });
    if (!productHasNutritionData(product)) {
      throw new Error('Incomplete nutrition data');
    }
    return parseOffProduct(product, code, weightG);
  } catch (offError) {
    console.warn('Open Food Facts lookup failed, trying Gemini fallback:', offError?.message);
    try {
      const usdaRes = await fetch(
        `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(code)}&api_key=${import.meta.env.VITE_USDA_API_KEY}&pageSize=1`,
      );
      const usdaData = await usdaRes.json();
      const item = usdaData.foods?.[0];
      if (item) {
        const nutrients = item.foodNutrients || [];
        const get = name => nutrients.find(n => n.nutrientName?.toLowerCase().includes(name))?.value || 0;
        const per100 = {
          calories: Math.round(get('energy')),
          protein: Math.round(get('protein') * 10) / 10,
          carbs: Math.round(get('carbohydrate') * 10) / 10,
          fat: Math.round(get('total lipid') * 10) / 10,
        };
        const servingG = weightG != null ? parseNum(weightG) : 100;
        const scale = servingG / 100;
        return toScanResult([toFoodItem({
          name: item.description,
          weight: servingG,
          calories: per100.calories * scale,
          protein: per100.protein * scale,
          carbs: per100.carbs * scale,
          fat: per100.fat * scale,
        })], 'medium', {
          barcode: code,
          source: 'usda',
          per100,
          servingG: Math.round(servingG),
        });
      }
    } catch (e) {
      console.warn('USDA lookup failed:', e);
    }
    const fallback = await fetchFromGeminiFallback(code, { signal });
    if (weightG != null) {
      const scaled = scaleFoodItem(fallback.items[0], weightG);
      return toScanResult([scaled], fallback.confidence, {
        ...fallback,
        source: 'gemini',
        estimated: true,
      });
    }
    return fallback;
  }
}

export function buildBarcodeLogResult(productMeta, grams) {
  const item = scaleFoodItem(
    toFoodItem({
      name: productMeta.displayName || productMeta.name,
      weight: productMeta.servingG || 100,
      calories: (productMeta.per100?.calories || 0) * ((productMeta.servingG || 100) / 100),
      protein: (productMeta.per100?.protein || 0) * ((productMeta.servingG || 100) / 100),
      carbs: (productMeta.per100?.carbs || 0) * ((productMeta.servingG || 100) / 100),
      fat: (productMeta.per100?.fat || 0) * ((productMeta.servingG || 100) / 100),
    }),
    grams,
  );

  return toScanResult([item], productMeta.confidence || 'high', {
    barcode: productMeta.barcode,
    source: productMeta.source,
    imageUrl: productMeta.imageUrl,
  });
}
