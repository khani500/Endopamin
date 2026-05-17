const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_FALLBACKS = [GEMINI_MODEL, 'gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];

function endpoint(model = GEMINI_MODEL) {
  return `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

function assertConfigured() {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key is missing. Add VITE_GEMINI_API_KEY to .env.local and restart Vite.');
  }
}

function extractText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim() || '';
}

async function generateContent({ prompt, systemPrompt = '', model }) {
  assertConfigured();
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  if (systemPrompt) {
    body.system_instruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const response = await fetch(endpoint(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function generateWithFallback(prompt, systemPrompt = '') {
  let lastError;

  for (const model of MODEL_FALLBACKS) {
    try {
      return await generateContent({ prompt, systemPrompt, model });
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model ${model} failed:`, error.message);
    }
  }

  throw lastError || new Error('Gemini request failed.');
}

export const testConnection = async () => {
  const data = await generateWithFallback('Say: DopaPeak connected!');
  console.log('Gemini Test:', extractText(data));
  return data;
};

export const askGemini = async (prompt, systemPrompt = '') => {
  const data = await generateWithFallback(prompt, systemPrompt);
  return extractText(data);
};

