import { extractGeminiModelText } from '../services/foodScanner';
import { TRAINING_KNOWLEDGE } from '../data/trainingKnowledge';
import { supabase } from './supabase';

const BEGINNER_FORBIDDEN_RULES =
  'FORBIDDEN exercises for beginners: barbell squat, goblet squat, deadlift, barbell bench press, overhead press, pull-ups. Always use NASM progression alternatives.';

function normalizeUserLevel(userLevel) {
  const level = String(userLevel || 'intermediate').toLowerCase();
  if (level.includes('begin')) return 'beginner';
  if (level.includes('adv')) return 'advanced';
  return 'intermediate';
}

function mapLocalKnowledgeRows() {
  return TRAINING_KNOWLEDGE.map(entry => ({
    id: entry.id,
    source: entry.source,
    topics: entry.topics || [],
    levels: entry.levels || [],
    summary: entry.summary,
  }));
}

function matchesCategory(row, category) {
  const needle = String(category || '').trim().toLowerCase();
  if (!needle) return true;

  if (String(row.source || '').toLowerCase() === needle) return true;
  if (row.topics?.some(topic => String(topic).toLowerCase().includes(needle))) return true;
  if (row.levels?.some(level => String(level).toLowerCase().includes(needle))) return true;
  return false;
}

/** Query Supabase training_knowledge; optional category filters topics, levels, or source. */
export async function fetchTrainingKnowledge(category) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('training_knowledge')
        .select('id, source, topics, levels, summary')
        .order('source', { ascending: true });

      if (!error && Array.isArray(data) && data.length) {
        return category ? data.filter(row => matchesCategory(row, category)) : data;
      }
    } catch (err) {
      console.warn('fetchTrainingKnowledge Supabase error, using local fallback:', err);
    }
  }

  const localRows = mapLocalKnowledgeRows();
  return category ? localRows.filter(row => matchesCategory(row, category)) : localRows;
}

/** Build formatted scientific knowledge block for coach system prompts. */
export async function buildKnowledgeContext(userLevel) {
  const level = normalizeUserLevel(userLevel);
  let entries = await fetchTrainingKnowledge();

  if (level === 'beginner') {
    entries = entries.filter(row =>
      row.topics?.some(topic => String(topic).toLowerCase().includes('beginner'))
      || row.levels?.includes('beginner'),
    );
  }

  const lines = entries.map(row => `- [${row.source}]: ${row.summary}`);
  let block = `SCIENTIFIC KNOWLEDGE BASE:\n${lines.join('\n')}`;

  if (level === 'beginner') {
    block += `\n\n${BEGINNER_FORBIDDEN_RULES}`;
  }

  return block;
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();
const GEMINI_MODEL = 'gemini-2.5-flash';

function useGeminiProxy() {
  return typeof window !== 'undefined' && window.location.hostname !== 'localhost';
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

export const askGeminiWithImage = async (base64Image, prompt) => {
  const isProduction =
    typeof window !== 'undefined' && window.location.hostname !== 'localhost';

  const body = {
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
  };

  try {
    let response;
    if (isProduction) {
      response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model: 'gemini-2.5-flash', action: 'generateContent' }),
      });
    } else {
      if (!GEMINI_API_KEY) return null;
      response = await fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    const rawText = await response.text();
    if (!response.ok) {
      console.error('Vision error: HTTP', response.status);
      return null;
    }
    try {
      return extractGeminiModelText(rawText) || null;
    } catch (err) {
      console.error('Vision error:', err);
      return null;
    }
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

