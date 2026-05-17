import { askGeminiWithImage } from '../lib/gemini';

export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.82) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function normalizeImageBlob(blob) {
  if (!blob) throw new Error('No image file was provided.');

  try {
    const bitmap = await createImageBitmap(blob);
    const maxSide = 1024;
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

export const scanFood = async imageFile => {
  const base64 = await blobToBase64(imageFile);
  const prompt = `You are a nutrition expert. Analyze this food image carefully.
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

  const response = await askGeminiWithImage(base64, prompt);
  if (!response) return null;

  try {
    const clean = response.replace(/```json|```/g, '').trim();
    return normalizeFoodResult(JSON.parse(extractJson(clean) || clean));
  } catch {
    console.error('JSON parse error:', response);
    return null;
  }
};

function extractJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return clean.slice(start, end + 1);
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
  const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  const GEMINI_MODEL = 'gemini-2.5-flash';
  const requestDebug = {
    keyLoaded: Boolean(GEMINI_API_KEY),
    keyLength: GEMINI_API_KEY?.length || 0,
    model: GEMINI_MODEL,
    mimeType,
    base64Length: base64Image?.length || 0,
  };

  if (!GEMINI_API_KEY) {
    const error = new Error('Gemini API key missing. VITE_GEMINI_API_KEY is not loaded from .env.local. Restart npm run dev after editing .env.local.');
    error.details = requestDebug;
    throw error;
  }
  if (!base64Image) throw new Error('No image data captured.');

  let response;
  let data;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image,
                  },
                },
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
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
          },
        }),
      },
    );
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
