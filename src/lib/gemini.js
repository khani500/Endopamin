import { FOOD_VISION_PROMPT } from './foodScanner';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();
const GEMINI_MODEL = 'gemini-2.5-flash';

function useGeminiProxy() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1';
}

function endpoint(action = 'generateContent') {
  if (useGeminiProxy()) {
    return '/api/gemini';
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:${action}?key=${GEMINI_API_KEY}`;
}

function streamEndpoint() {
  if (useGeminiProxy()) {
    return '/api/gemini';
  }
  return `${endpoint('streamGenerateContent')}&alt=sse`;
}

function buildRequestPayload(body, action = 'generateContent', { stream = false } = {}) {
  if (!useGeminiProxy()) return body;
  return {
    model: GEMINI_MODEL,
    action,
    ...(stream ? { alt: 'sse' } : {}),
    ...body,
  };
}

function assertConfigured() {
  if (!GEMINI_API_KEY && !useGeminiProxy()) {
    throw new Error('Gemini API key is missing. Add VITE_GEMINI_API_KEY to .env.local and restart Vite.');
  }
}

function isConfigured() {
  return Boolean(GEMINI_API_KEY) || useGeminiProxy();
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

const COACH_GENERATION_CONFIG = {
  temperature: 0.1,
  topP: 0.85,
  topK: 20,
  maxOutputTokens: 512,
};

async function generateContent({ prompt, systemPrompt = '', generationConfig = {} }) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { ...COACH_GENERATION_CONFIG, ...generationConfig },
  };

  if (systemPrompt) {
    body.system_instruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestPayload(body)),
    signal: generationConfig.signal,
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const message = data.error?.message || `Gemini request failed with status ${response.status}`;
    throw new Error(`${message} [model: ${GEMINI_MODEL}]`);
  }
  return data;
}

/** Multi-turn chat with full conversation history for coach sessions. */
async function generateChatContent({ contents, systemPrompt = '', signal } = {}) {
  const isProduction =
    typeof window !== 'undefined' && window.location.hostname !== 'localhost';

  const body = {
    contents,
    generationConfig: COACH_GENERATION_CONFIG,
  };

  if (systemPrompt) {
    body.system_instruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  let response;
  if (isProduction) {
    // fix: always use Vercel proxy in production (fixes Safari iOS CORS block)
    response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        action: 'generateContent',
        ...body,
      }),
      signal,
    });
  } else {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestPayload(body)),
      signal,
    });
  }

  const data = await response.json();
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
    body: JSON.stringify(buildRequestPayload(body)),
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
  if (!isConfigured()) {
    return 'Coach is offline — API key missing';
  }

  try {
    const data = await generateContent({ prompt, systemPrompt });
    return extractText(data) || 'No response';
  } catch (err) {
    console.error('Gemini fetch error:', err.message);
    return 'Coach is having connection issues. Try again.';
  }
};

/**
 * Coach chat with full multi-turn history.
 * @param {{ messages: { role: 'user'|'assistant', text: string }[], systemPrompt?: string }} params
 */
export const askGeminiChat = async ({ messages, systemPrompt = '', signal } = {}) => {
  if (!isConfigured()) {
    return 'Coach is offline — API key missing';
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await generateChatContent({ contents: messages, systemPrompt, signal });
      return extractText(data) || 'No response';
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt === 0) {
        console.warn('Gemini chat attempt 1 failed, retrying...', err.message);
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      console.error('Gemini chat error after retry:', err.message);
      return 'Coach is having connection issues. Try again.';
    }
  }
};

function parseSseJsonPayload(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Stream Gemini chat tokens over SSE for low-latency voice replies.
 * @param {{ messages: object[], systemPrompt?: string, signal?: AbortSignal, onToken?: (chunk: string, fullText: string) => void }} params
 */
export async function askGeminiChatStream({
  messages,
  systemPrompt = '',
  signal,
  onToken,
} = {}) {
  assertConfigured();

  const body = {
    contents: messages,
    generationConfig: COACH_GENERATION_CONFIG,
  };

  if (systemPrompt) {
    body.system_instruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const response = await fetch(streamEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestPayload(body, 'streamGenerateContent', { stream: true })),
    signal,
  });

  if (!response.ok) {
    let message = `Gemini stream failed with status ${response.status}`;
    try {
      const errData = await response.json();
      message = errData.error?.message || message;
    } catch {
      // ignore
    }
    throw new Error(`${message} [model: ${GEMINI_MODEL}]`);
  }

  if (!response.body) {
    throw new Error('Gemini stream returned no body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException('Aborted', 'AbortError');
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const data = parseSseJsonPayload(line);
      if (!data) continue;

      const chunk = extractText(data);
      if (!chunk) continue;

      fullText += chunk;
      onToken?.(chunk, fullText);
    }
  }

  return fullText.trim() || 'No response';
}

export const askGeminiWithImage = async (
  base64Image,
  prompt,
  { mimeType = 'image/jpeg', model = 'gemini-1.5-flash' } = {},
) => {
  assertConfigured();

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Image } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };

  let response;
  if (useGeminiProxy()) {
    response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model, action: 'generateContent' }),
    });
  } else {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Vision error:', data.error || response.status);
    return null;
  }
  return extractText(data) || null;
};

/** Analyze a food photo with Gemini Vision (uses /api/gemini proxy in production). */
export async function analyzeFood(base64Image, prompt, options = {}) {
  const text = await askGeminiWithImage(base64Image, prompt || FOOD_VISION_PROMPT, options);
  if (!text) return null;

  const clean = text.replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return null;
  }
}

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

