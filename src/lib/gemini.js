console.log('GEMINI KEY LOADED:', import.meta.env.VITE_GEMINI_API_KEY?.substring(0, 15));

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();
const GEMINI_MODEL = 'gemini-2.5-flash';

function endpoint() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
}

function assertConfigured() {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key is missing. Add VITE_GEMINI_API_KEY to .env.local and restart Vite.');
  }
}

function extractText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim() || '';
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function generateContent({ prompt, systemPrompt = '' }) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 512 },
  };

  if (systemPrompt) {
    body.system_instruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  console.log('📡 Gemini response status:', response.status);
  if (!response.ok || data.error) {
    const message = data.error?.message || `Gemini request failed with status ${response.status}`;
    throw new Error(`${message} [model: ${GEMINI_MODEL}]`);
  }
  return data;
}

async function generateAudioContent({ audioBase64, mimeType, prompt }) {
  assertConfigured();
  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: audioBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
  };

  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const message = data.error?.message || `Gemini audio request failed with status ${response.status}`;
    throw new Error(`${message} [model: ${GEMINI_MODEL}]`);
  }
  return data;
}

export const testConnection = async () => {
  const data = await generateContent({ prompt: 'Say: ENDOPAMIN connected!' });
  console.log('Gemini Test:', extractText(data));
  return data;
};

export const askGemini = async (prompt, systemPrompt = '') => {
  console.log('🔑 Key exists:', Boolean(GEMINI_API_KEY));
  console.log('🔑 Key prefix:', GEMINI_API_KEY?.substring(0, 8));

  if (!GEMINI_API_KEY) {
    console.error('❌ No Gemini API key found!');
    return 'Coach is offline — API key missing';
  }

  try {
    const data = await generateContent({ prompt, systemPrompt });
    if (data.error) {
      console.error('❌ Gemini error:', data.error);
      return `Coach says: I need a moment (${data.error.message})`;
    }
    return extractText(data) || 'No response';
  } catch (err) {
    console.error('❌ Gemini fetch error:', err);
    return 'Coach is having connection issues. Try again.';
  }
};

export const askGeminiWithImage = async (base64Image, prompt) => {
  if (!GEMINI_API_KEY) return null;

  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64Image,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      }),
    });

    const data = await response.json();
    console.log('📡 Gemini vision response status:', response.status);
    if (data.error) {
      console.error('Vision error:', data.error);
      return null;
    }
    return extractText(data) || null;
  } catch (err) {
    console.error('Vision fetch error:', err);
    return null;
  }
};

export const transcribeAudioWithGemini = async audioBlob => {
  if (!audioBlob) throw new Error('No microphone audio was recorded.');
  const audioBase64 = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';
  const data = await generateAudioContent({
    audioBase64,
    mimeType,
    prompt: 'Transcribe this voice note into plain English text only. Do not answer the user. Return only the transcript.',
  });
  return extractText(data);
};

