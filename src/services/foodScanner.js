import { askGeminiWithImage } from '../lib/gemini';

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

const FOOD_SCAN_PROMPT = `You are a nutrition expert. Analyze this food image carefully.
Return ONLY valid JSON, no markdown, no explanation:
{
  "food_name": "specific food name",
  "serving_description": "what you see (e.g., 1 large chicken breast, 200g cooked rice)",
  "calories": 350,
  "protein_g": 45,
  "carbs_g": 30,
  "fat_g": 8,
  "fiber_g": 2,
  "confidence": "high",
  "tips": "one practical nutrition tip about this food"
}`;

export const scanFood = async (imageFile) => {
  try {
    const { base64, mimeType } = await imageToGeminiPayload(imageFile);

    const buildBody = model => ({
      model,
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: 'Analyze this food image. Reply with ONLY one single-line JSON, no newlines inside strings, no markdown, no explanation:\n{"food_name":"","serving_size":"","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"confidence":"high","notes":""}' }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512
      }
    });

    let model = 'gemini-2.5-flash';
    let response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(model))
    });

    if (response.status === 503) {
      model = 'gemini-2.5-flash';
      response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(model))
      });
    }

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'Gemini error');
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const result = extractNutritionFromText(text);
    if (!result.food_name || result.food_name === 'Unknown food') {
      throw new Error('Could not identify food in image. Try again.');
    }
    return normalizeFoodResult(result);
  } catch (err) {
    console.error('Food scan error:', err.message);
    throw err;
  }
};

function extractJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  // sanitize: remove literal newlines inside the JSON string
  const raw = clean.slice(start, end + 1);
  const sanitized = raw.replace(/[\r\n]+/g, ' ');
  return sanitized;
}

function extractNutritionFromText(text) {
  const str = (key) => {
    const m = text.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"'));
    return m ? m[1].trim() : '';
  };
  const num = (key) => {
    const m = text.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+(?:\\.\\d+)?)'));
    return m ? parseFloat(m[1]) : 0;
  };
  return {
    food_name: str('food_name') || 'Unknown food',
    serving_size: str('serving_size') || 'Estimated portion',
    calories: num('calories'),
    protein_g: num('protein_g'),
    carbs_g: num('carbs_g'),
    fat_g: num('fat_g'),
    confidence: str('confidence') || 'medium',
    notes: str('notes') || 'AI estimate.',
  };
}

function normalizeFoodResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    food_name: String(raw.food_name || raw.name || raw.label || 'Unknown food'),
    serving_size: String(raw.serving_size || raw.serving || 'Estimated portion'),
    calories: Number(raw.calories ?? raw.kcal) || 0,
    protein_g: Number(raw.protein_g ?? raw.protein) || 0,
    carbs_g: Number(raw.carbs_g ?? raw.carbs) || 0,
    fat_g: Number(raw.fat_g ?? raw.fat) || 0,
    fiber_g: Number(raw.fiber_g ?? raw.fiber) || 0,
    confidence: String(raw.confidence || 'medium').toLowerCase(),
    notes: String(raw.notes || 'Nutrition is an AI estimate.'),
  };
}

export const analyzeFoodImage = async (base64Image, { mimeType = 'image/jpeg', signal } = {}) => {
  const GEMINI_MODEL = 'gemini-2.5-flash';
  const requestDebug = {
    model: GEMINI_MODEL,
    mimeType,
    base64Length: base64Image?.length || 0,
  };

  if (!base64Image) throw new Error('No image data captured.');

  let response;
  let data;
  try {
    response = await fetch('/api/gemini', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Image } },
            {
              text: `You are a nutrition vision analyzer. Analyze the visible food in this image and estimate nutritional information.
Return ONLY a JSON object with this exact structure, no other text:
{
  "food_name": "name of the food",
  "serving_size": "estimated serving size",
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "fiber_g": number,
  "confidence": "high|medium|low",
  "notes": "any important notes about the estimate"
}`,
            },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
        },
      }),
    });
    data = await response.json();
  } catch (error) {
    const wrapped = new Error(`Gemini network error: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    wrapped.details = requestDebug;
    throw wrapped;
  }

  const responseDebug = {
    ...requestDebug,
    status: response.status,
    statusText: response.statusText,
    errorMessage: data?.error?.message || '',
    rawText: data?.candidates?.[0]?.content?.parts?.[0]?.text || '',
  };

  console.log('Gemini Vision scanner response:', responseDebug);

  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `Gemini Vision failed with status ${response.status}`);
    error.details = responseDebug;
    throw error;
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const jsonText = extractJson(text);
  if (!jsonText) {
    const error = new Error(`Gemini did not return nutrition JSON. Raw response: ${text.slice(0, 240) || '(empty)'}`);
    error.details = responseDebug;
    throw error;
  }

  try {
    const normalized = normalizeFoodResult(JSON.parse(jsonText));
    return { ...normalized, debug: responseDebug };
  } catch (error) {
    console.error('Failed to parse Gemini food response:', text);
    const wrapped = new Error(error instanceof Error ? error.message : 'Could not parse nutrition result.', { cause: error });
    wrapped.details = responseDebug;
    throw wrapped;
  }
};
