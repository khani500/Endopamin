const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();
const GEMINI_MODEL = 'gemini-2.5-flash';

function endpoint(action = 'generateContent') {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:${action}?key=${GEMINI_API_KEY}`;
}

function streamEndpoint() {
  return `${endpoint('streamGenerateContent')}&alt=sse`;
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
    body: JSON.stringify(body),
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
  const body = {
    contents,
    generationConfig: COACH_GENERATION_CONFIG,
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
    signal,
  });
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
  if (!GEMINI_API_KEY) {
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
  if (!GEMINI_API_KEY) {
    return 'Coach is offline — API key missing';
  }

  try {
    const data = await generateChatContent({ contents: messages, systemPrompt, signal });
    return extractText(data) || 'No response';
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.error('Gemini chat error:', err.message);
    return 'Coach is having connection issues. Try again.';
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
    body: JSON.stringify(body),
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

