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
    const maxSide = 400;
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
    return (await canvasToBlob(canvas, 'image/jpeg', 0.5)) || blob;
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
  'Analyze this food image. Reply with ONLY one single-line JSON object. '
  + 'No markdown, no code fences, no explanation. '
  + 'Keys: food_name, serving_size, calories, protein_g, carbs_g, fat_g, confidence, notes. '
  + 'Example: {"food_name":"grilled chicken","serving_size":"1 breast","calories":165,'
  + '"protein_g":31,"carbs_g":0,"fat_g":3,"confidence":"high","notes":"lean protein"}';

function stripMarkdown(text) {
  return String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

/** Extract JSON object substring from first `{` through last `}` (or tail if truncated). */
export function extractJsonObject(text) {
  const clean = stripMarkdown(text);
  const start = clean.indexOf('{');
  if (start === -1) return null;
  const end = clean.lastIndexOf('}');
  const raw = end > start ? clean.slice(start, end + 1) : clean.slice(start);
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

/** Try JSON.parse; on failure use brace extraction; never throws. */
export function safeParseJson(text) {
  const attempts = [stripMarkdown(text), extractJsonObject(text)].filter(Boolean);
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
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

/** Pull Gemini model text from full HTTP body, even when JSON envelope is truncated. */
export function extractGeminiModelText(rawText) {
  const parsed = safeParseJson(rawText);
  if (parsed?.error?.message) {
    const err = new Error(parsed.error.message);
    err.apiError = parsed.error;
    throw err;
  }

  const fromEnvelope = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (fromEnvelope) return String(fromEnvelope);

  const textMatch = String(rawText || '').match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (textMatch?.[1]) return unescapeJsonString(textMatch[1]);

  if (/"food_name"|"calories"/.test(rawText)) return rawText;

  return '';
}

function extractNutritionFromText(text) {
  const str = key => {
    const m = String(text || '').match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1].trim() : '';
  };
  const num = key => {
    const m = String(text || '').match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
    return m ? parseFloat(m[1]) : 0;
  };
  return {
    food_name: str('food_name') || str('name') || 'Unknown food',
    serving_size: str('serving_size') || str('serving') || 'Estimated portion',
    calories: num('calories') || num('kcal'),
    protein_g: num('protein_g') || num('protein'),
    carbs_g: num('carbs_g') || num('carbs'),
    fat_g: num('fat_g') || num('fat'),
    confidence: str('confidence') || 'medium',
    notes: str('notes') || str('tips') || 'AI estimate.',
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

/** Parse nutrition from AI text: JSON first, regex field extraction as fallback. */
export function parseNutritionFromAiText(text) {
  const parsed = safeParseJson(text);
  if (parsed && typeof parsed === 'object') {
    const normalized = normalizeFoodResult(parsed);
    if (normalized?.food_name && normalized.food_name !== 'Unknown food') {
      return normalized;
    }
  }

  const regexResult = extractNutritionFromText(text);
  if (regexResult.food_name && regexResult.food_name !== 'Unknown food') {
    return normalizeFoodResult(regexResult);
  }

  return null;
}

async function callGeminiVision({ base64, mimeType, prompt, signal }) {
  const buildBody = model => ({
    model,
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
  });

  let response = await fetch('/api/gemini', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody('gemini-2.5-flash')),
  });

  if (response.status === 503) {
    response = await fetch('/api/gemini', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody('gemini-2.5-flash')),
    });
  }

  const rawText = await response.text();

  if (!response.ok) {
    const errBody = safeParseJson(rawText);
    throw new Error(errBody?.error?.message || `Gemini error ${response.status}`);
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

    const result = parseNutritionFromAiText(aiText);
    if (result) return result;

    const fallback = parseNutritionFromAiText(rawText);
    if (fallback) return fallback;

    throw new Error('Could not identify food in image. Try again with a clearer photo.');
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.error('Food scan error:', err.message);
    throw err;
  }
};

/** @deprecated Use safeParseJson — kept for callers that still import extractJson */
export function extractJson(text) {
  return extractJsonObject(text);
}

export const analyzeFoodImage = async (base64Image, { mimeType = 'image/jpeg', signal } = {}) => {
  const GEMINI_MODEL = 'gemini-2.5-flash';
  const requestDebug = {
    model: GEMINI_MODEL,
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
      prompt:
        'Analyze the visible food in this image. Return ONLY one single-line JSON object. '
        + 'No markdown. Keys: food_name, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, confidence, notes.',
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
    errorMessage: safeParseJson(rawText)?.error?.message || '',
    rawText: aiText || rawText.slice(0, 500),
  };

  console.log('Gemini Vision scanner response:', responseDebug);

  const normalized = parseNutritionFromAiText(aiText) || parseNutritionFromAiText(rawText);
  if (!normalized) {
    const error = new Error(
      `Gemini did not return nutrition JSON. Raw response: ${(aiText || rawText).slice(0, 240) || '(empty)'}`,
    );
    error.details = responseDebug;
    throw error;
  }

  return { ...normalized, debug: responseDebug };
};
