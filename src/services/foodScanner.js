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

const FOOD_SCAN_NUTRITION_PROMPT =
  'Identify the food. Reply in ONE line only, plain JSON, no markdown:\n'
  + '{"food_name":"name","serving_size":"portion","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":"medium","notes":""}';

function stripMarkdown(text) {
  return String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

export function extractJsonObject(text) {
  const clean = stripMarkdown(text);
  const start = clean.indexOf('{');
  if (start === -1) return null;
  const end = clean.lastIndexOf('}');
  const raw = end > start ? clean.slice(start, end + 1) : clean.slice(start);
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

/** Optional JSON.parse — never throws, used only outside the scanner hot path. */
export function safeParseJson(text) {
  const attempts = [stripMarkdown(text), extractJsonObject(text)].filter(Boolean);
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
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

  if (/"food_name"|"calories"/.test(raw)) return raw;

  return '';
}

function readStringField(text, key) {
  const src = String(text || '');
  const complete = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
  if (complete?.[1]) return complete[1].trim();
  const partial = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)`));
  return partial?.[1]?.trim() || '';
}

function readNumberField(text, key) {
  const src = String(text || '');
  const m = src.match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
  return m ? parseFloat(m[1]) : 0;
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
    calories: Number(raw.calories ?? raw.kcal) || 0,
    protein_g: Number(raw.protein_g ?? raw.protein) || 0,
    carbs_g: Number(raw.carbs_g ?? raw.carbs) || 0,
    fat_g: Number(raw.fat_g ?? raw.fat) || 0,
    fiber_g: Number(raw.fiber_g ?? raw.fiber) || 0,
    confidence: String(raw.confidence || 'medium').toLowerCase(),
    notes: String(raw.notes || raw.tips || 'Nutrition is an AI estimate.'),
  };
}

/** Regex-only nutrition parse — no JSON.parse anywhere in this path. */
export function parseNutritionFromAiText(text) {
  const sources = [text, extractJsonObject(text)].filter(Boolean);
  for (const source of sources) {
    const regexResult = extractNutritionFromText(source);
    if (regexResult.food_name && regexResult.food_name !== 'Unknown food') {
      return normalizeFoodResult(regexResult);
    }
  }
  return null;
}

async function callGeminiVision({ base64, mimeType, prompt, signal }) {
  const body = {
    model: 'gemini-2.5-flash',
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
    },
  };

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

export const scanFood = async (imageFile, { signal } = {}) => {
  try {
    const { base64, mimeType } = await imageToGeminiPayload(imageFile);
    const { aiText, rawText } = await callGeminiVision({
      base64,
      mimeType,
      prompt: FOOD_SCAN_NUTRITION_PROMPT,
      signal,
    });

    const combined = `${aiText}\n${rawText}`;
    const result = parseNutritionFromAiText(combined);
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
