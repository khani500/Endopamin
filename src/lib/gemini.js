const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

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

export const testConnection = async () => {
  assertConfigured();
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Say: DopaPeak connected!' }] }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  console.log('Gemini Test:', extractText(data));
  return data;
};

export const askGemini = async (prompt, systemPrompt = '') => {
  assertConfigured();
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return extractText(data);
};

