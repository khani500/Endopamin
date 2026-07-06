import { extractGeminiModelText } from '../services/foodScanner';
import { TRAINING_KNOWLEDGE } from '../data/trainingKnowledge';
import { supabase } from './supabase';
import { getPlanProgressSummary, buildProgressPrompt } from './planMemory';

export async function getAuthHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

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
        .select('*')
        .order('id', { ascending: true });

      if (error) {
        console.error('fetchTrainingKnowledge Supabase error:', error.message, error.code, error.details);
      } else if (Array.isArray(data) && data.length) {
        console.log('[fetchTrainingKnowledge] columns:', Object.keys(data[0] || {}));
        const normalized = data.map(row => ({
          id: row.id,
          source: row.source || row.category || '',
          topics: row.topics || (row.category ? [row.category] : []),
          levels: row.levels || (row.level ? [row.level] : []),
          summary: row.summary || row.content || '',
        }));
        return category ? normalized.filter(row => matchesCategory(row, category)) : normalized;
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
  maxOutputTokens: 1024,
};

async function generateContent({ prompt, systemPrompt = '', generationConfig = {}, signal } = {}) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { ...COACH_GENERATION_CONFIG, ...generationConfig },
  };

  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify(buildRequestPayload(body)),
    signal,
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
    body.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  let response;
  if (isProduction) {
    // fix: always use Vercel proxy in production (fixes Safari iOS CORS block)
    response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
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
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: JSON.stringify(buildRequestPayload(body)),
      signal,
    });
  }

  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    console.error('Gemini error body:', responseText);
    throw new Error(
      `Gemini request failed with status ${response.status}: ${responseText.slice(0, 200)} [model: ${GEMINI_MODEL}]`,
    );
  }

  if (!response.ok || data.error) {
    console.error('Gemini error body:', responseText);
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
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
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
export const askGeminiChat = async ({ messages, systemPrompt = '', signal, throwOnError = false } = {}) => {
  if (!isConfigured()) {
    if (throwOnError) throw new Error('Coach is offline — API key missing');
    return 'Coach is offline — API key missing';
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await generateChatContent({ contents: messages, systemPrompt, signal });
      return extractText(data) || 'No response';
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt < 2) {
        console.warn(`Gemini chat attempt ${attempt + 1} failed, retrying...`, err.message);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      console.error('Gemini chat error after retry:', err.message);
      if (throwOnError) throw err;
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
    body.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const response = await fetch(streamEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify(buildRequestPayload(body, 'streamGenerateContent', { stream: true })),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Gemini error body:', errText);
    let message = `Gemini stream failed with status ${response.status}`;
    try {
      const errData = JSON.parse(errText);
      message = errData.error?.message || message;
    } catch {
      if (errText) message = errText.slice(0, 300);
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
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ ...body, model: 'gemini-2.5-flash', action: 'generateContent' }),
      });
    } else {
      if (!GEMINI_API_KEY) return null;
      response = await fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
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

export async function generateWorkoutPlan(coachId, user, userProfile = {}) {
  const {
    fitnessLevel = 'beginner',
    availableEquipment = 'full_gym',
    goal = 'general fitness',
    injuries = 'none',
    age = null,
    weight = null,
    isReturning = false,
    setting = 'gym',
  } = userProfile;

  const progressSummary = await getPlanProgressSummary(user?.id);
  const progressContext = buildProgressPrompt(progressSummary);

  const coachPersona = {
    aria: `You are Aria, a General Fitness coach. Your philosophy: fitness should be sustainable, enjoyable, and balanced. Build habits that last a lifetime. Every session should leave the athlete feeling energized. Draw from NASM OPT methodology and ACSM general health guidelines.`,
    kane: `You are Kane, a Hypertrophy and Muscle Building coach. Your philosophy: muscle is built with volume, progressive overload, and consistency. Train each muscle group at least twice per week. Push sets close to failure. Draw from Schoenfeld hypertrophy research and NSCA volume principles.`,
    blaze: `You are Blaze, a Fat Loss and Conditioning specialist. Your philosophy: maximum calorie burn, minimum wasted time. Keep heart rate high and rest periods short. Use HIIT protocols and metabolic circuits. Draw from Tabata protocol and NSCA metabolic resistance training.`,
    nova: `You are Nova, a Strength and Athletic Performance coach. Your philosophy: strength is the foundation of everything. Heavy compound movements first, every session. Chase personal records every week. Draw from NSCA Essentials of Strength Training and linear periodization models.`,
    zara: `You are Zara, a Functional Fitness coach. Your philosophy: move better, feel better, live better. Quality of movement trumps quantity of weight. Master the 7 fundamental movement patterns. Draw from Gray Cook's Functional Movement Systems and ACSM mobility guidelines.`,
  };

  const prompt = `${coachPersona[coachId] || coachPersona.aria}

You are building a science-based weekly workout plan. Use your full knowledge of exercise science (NASM, NSCA, ACSM principles).

USER PROFILE:
- Fitness level: ${fitnessLevel}
- Goal: ${goal}
- Equipment: ${availableEquipment === 'full_gym' ? 'Full gym (barbells, dumbbells, cables, machines)' : availableEquipment === 'home_basic' ? 'Home (dumbbells, resistance bands, bodyweight)' : 'Bodyweight only'}
- Days per week: 5 training days, 2 rest days
- Injuries: ${injuries}
${age ? `- Age: ${age}` : ''}
${weight ? `- Weight: ${weight}kg` : ''}
${isReturning ? '- Returning after break: start conservatively, no heavy compounds week 1' : ''}

${progressContext ? progressContext + '\n' : ''}

PLAN REQUIREMENTS:
- 7 days total (Monday to Sunday)
- Exactly 5 training days, exactly 2 rest/recovery days
- Each training day: 5-7 exercises minimum
- Use periodization: Push / Pull / Legs / Upper / Full Body split
- Each day must train DIFFERENT muscle groups than the previous day
- NO exercise should repeat more than once per week
- CRITICAL: Each exercise name must appear only ONCE across the entire 7-day plan — no exceptions, zero repeats
- Use a wide variety of exercises — compound lifts, isolation, core, cardio finishers
- Sets/reps based on goal:
  * Muscle gain: 3-4 sets × 8-12 reps
  * Strength: 4-5 sets × 3-6 reps  
  * Fat loss: 3-4 sets × 12-15 reps, shorter rest
  * General fitness: 3 sets × 10-15 reps
- Beginner: simpler movements, machines over free weights, higher reps
- Intermediate/Advanced: compound lifts, progressive overload, free weights
- All exercise names in English
- Return ONLY valid JSON, no markdown, no explanation

FORMAT:
{
  "coachId": "${coachId}",
  "days": [
    {
      "day": "Monday",
      "focus": "Push — Chest & Shoulders",
      "type": "training",
      "exercises": [
        { "name": "Barbell Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
      ]
    }
  ]
}`;

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
      },
    }),
  });
  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  const clean = text.replace(/```json|```/g, '').trim();
  let parsed = JSON.parse(clean);
  parsed = validateAndFixWorkoutPlan(parsed, { experience_level: fitnessLevel });
  return parsed;
}

function parseGeminiJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

function validateAndFixWorkoutPlan(parsed, athlete) {
  if (!Array.isArray(parsed?.days) || !parsed.days.length) {
    throw new Error('Empty workout plan');
  }

  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const experience = athlete?.experience_level || athlete?.experience || 'intermediate';

  const BEGINNER_FORBIDDEN = [
    'barbell back squat', 'barbell squat', 'barbell deadlift', 'deadlift',
    'barbell overhead press', 'overhead press', 'pull-up', 'pull up', 'pullup'
  ];

  // Fix 1: Ensure exactly 7 days
  if (parsed.days.length !== 7) {
    const dayMap = {};
    parsed.days.forEach(d => { dayMap[d.day || d.name] = d; });
    parsed.days = DAYS_OF_WEEK.map(dayName => dayMap[dayName] || {
      day: dayName,
      focus: 'Active Recovery',
      type: 'rest',
      exercises: [{ name: 'Light Walk', sets: '1', reps: '20 min', rest: '0s' }],
    });
  }

  // Fix 2: No back-to-back rest days
  for (let i = 0; i < parsed.days.length - 1; i++) {
    const type1 = parsed.days[i].type;
    const type2 = parsed.days[i + 1].type;
    if ((type1 === 'rest' || type1 === 'recovery') && (type2 === 'rest' || type2 === 'recovery')) {
      parsed.days[i + 1].type = 'training';
      parsed.days[i + 1].focus = parsed.days[i + 1].focus || 'Full Body';
      if (!parsed.days[i + 1].exercises?.length) {
        parsed.days[i + 1].exercises = [
          { name: 'Light Cardio Warm-up', sets: '1', reps: '5 min', rest: '0s' },
          { name: 'Bodyweight Squat', sets: '3', reps: '15', rest: '60s' },
          { name: 'Push-up', sets: '3', reps: '10', rest: '60s' },
          { name: 'Plank', sets: '3', reps: '30s hold', rest: '45s' },
        ];
      }
    }
  }

  // Fix 3: Warm-up on every training day
  parsed.days.forEach(day => {
    if ((day.type === 'training' || day.type === 'train') && Array.isArray(day.exercises) && day.exercises.length > 0) {
      const firstName = (day.exercises[0].name || '').toLowerCase();
      const hasWarmup = firstName.includes('warm') || firstName.includes('cardio') || firstName.includes('stretch');
      if (!hasWarmup) {
        day.exercises.unshift({ name: 'Light Cardio Warm-up', sets: '1', reps: '5 min', rest: '0s' });
      }
    }
  });

  // Fix 4: Beginner safety
  if (experience === 'beginner') {
    parsed.days.forEach(day => {
      if ((day.type === 'training' || day.type === 'train') && Array.isArray(day.exercises)) {
        day.exercises = day.exercises.filter(ex => {
          const name = (ex.name || '').toLowerCase();
          return !BEGINNER_FORBIDDEN.some(forbidden => name.includes(forbidden));
        });
        if (day.exercises.length < 3) {
          day.exercises.push(
            { name: 'Dumbbell Goblet Squat', sets: '3', reps: '12', rest: '60s' },
            { name: 'Dumbbell Row', sets: '3', reps: '12', rest: '60s' },
          );
        }
      }
    });
  }

  return parsed;
}

const PLAN_GENERATION_TIMEOUT_MS = 25000;

async function generateJsonFromPrompt(prompt, maxOutputTokens = 4096, { timeoutMs } = {}) {
  const controller = new AbortController();

  const run = generateContent({
    prompt,
    generationConfig: { maxOutputTokens, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
    signal: controller.signal,
  }).then(data => {
    const text = extractText(data);
    if (!text) throw new Error('Empty Gemini response');
    return parseGeminiJson(text);
  });

  if (!timeoutMs) return run;

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      controller.abort();
      reject(new Error(`Gemini plan generation timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([run, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/** Fetch training knowledge content for onboarding plan generation. */
export async function fetchTrainingKnowledgeForOnboarding(limit = 20) {
  if (supabase) {
    const { data, error } = await supabase
      .from('training_knowledge')
      .select('*')
      .limit(limit);

    if (!error && Array.isArray(data) && data.length) {
      return data.map(row => row.content || row.summary).filter(Boolean).join('\n\n');
    }
  }

  const entries = await fetchTrainingKnowledge();
  return entries.slice(0, limit).map(row => row.summary).join('\n\n');
}

const fallbackEx = (name, sets = '3', reps = '10-12', rest = '60s') => ({ name, sets, reps, rest });

function normalizeSessionDuration(sessionDuration) {
  const duration = Number(sessionDuration) || 45;
  if (duration >= 60 || duration === 90) return 60;
  if (duration <= 15) return 15;
  if (duration <= 30) return 30;
  if (duration <= 45) return 45;
  return 60;
}

function getExerciseCountForDuration(sessionDuration) {
  const duration = normalizeSessionDuration(sessionDuration);
  if (duration === 15) return 3;
  if (duration === 30) return 5;
  if (duration === 45) return 7;
  return 8;
}

const ACTIVE_RECOVERY_EXERCISES = [
  fallbackEx('Brisk Walk', '1', '10 min', '-'),
  fallbackEx('Mobility Circuit', '2', '5 min', '30s'),
  fallbackEx('Light Stretching', '1', '5 min', '-'),
  fallbackEx('Foam Rolling', '1', '8 min', '-'),
];

function applySessionDurationToFallbackPlan(plan, sessionDuration = 45) {
  const duration = normalizeSessionDuration(sessionDuration);
  const exerciseCount = getExerciseCountForDuration(sessionDuration);
  const useActiveRecovery = duration === 15;

  return {
    ...plan,
    days: plan.days.map(day => {
      const isRestDay = day.type === 'rest';
      const isActiveRest = /active/i.test(day.focus || '');

      if (useActiveRecovery && isRestDay && !isActiveRest) {
        return {
          ...day,
          type: 'training',
          focus: 'Active Recovery',
          exercises: ACTIVE_RECOVERY_EXERCISES.slice(0, exerciseCount),
        };
      }

      if (isRestDay) return day;

      return {
        ...day,
        exercises: (day.exercises || []).slice(0, exerciseCount),
      };
    }),
  };
}

const FALLBACK_WORKOUT_MALE = (coachId) => ({
  coachId,
  days: [
    {
      day: 'Saturday',
      focus: 'Push',
      type: 'training',
      exercises: [
        fallbackEx('Bench Press', '4', '8-10', '90s'),
        fallbackEx('Overhead Press', '3', '8-10', '90s'),
        fallbackEx('Incline Dumbbell Press', '3', '10-12', '60s'),
        fallbackEx('Lateral Raise', '3', '12-15', '45s'),
        fallbackEx('Tricep Pushdown', '3', '12', '45s'),
        fallbackEx('Dips', '3', '8-12', '60s'),
        fallbackEx('Cable Fly', '3', '12-15', '45s'),
        fallbackEx('Face Pull', '3', '15', '45s'),
      ],
    },
    {
      day: 'Sunday',
      focus: 'Pull',
      type: 'training',
      exercises: [
        fallbackEx('Deadlift', '4', '5', '120s'),
        fallbackEx('Barbell Row', '3', '8-10', '90s'),
        fallbackEx('Lat Pulldown', '3', '10-12', '60s'),
        fallbackEx('Pull-Up', '3', '6-10', '90s'),
        fallbackEx('Seated Cable Row', '3', '10-12', '60s'),
        fallbackEx('Face Pull', '3', '15', '45s'),
        fallbackEx('Barbell Curl', '3', '10-12', '45s'),
        fallbackEx('Hammer Curl', '3', '12', '45s'),
      ],
    },
    { day: 'Monday', focus: 'Active Rest', type: 'rest', exercises: [fallbackEx('30 min walk', '-', '-', '-')] },
    {
      day: 'Tuesday',
      focus: 'Legs',
      type: 'training',
      exercises: [
        fallbackEx('Squat', '4', '8', '120s'),
        fallbackEx('Leg Press', '3', '12', '90s'),
        fallbackEx('Romanian Deadlift', '3', '10', '90s'),
        fallbackEx('Walking Lunge', '3', '10 each leg', '60s'),
        fallbackEx('Leg Curl', '3', '12-15', '60s'),
        fallbackEx('Calf Raise', '3', '15-20', '45s'),
        fallbackEx('Leg Extension', '3', '12-15', '60s'),
        fallbackEx('Hip Thrust', '3', '10-12', '90s'),
      ],
    },
    {
      day: 'Wednesday',
      focus: 'Core + Cardio',
      type: 'training',
      exercises: [
        fallbackEx('Plank', '3', '60s', '45s'),
        fallbackEx('Mountain Climber', '3', '30s', '30s'),
        fallbackEx('Russian Twist', '3', '20', '45s'),
        fallbackEx('Dead Bug', '3', '12', '45s'),
        fallbackEx('Bicycle Crunch', '3', '20', '45s'),
        fallbackEx('Farmer Carry', '3', '40m', '60s'),
        fallbackEx('Jump Rope', '3', '60s', '30s'),
        fallbackEx('Burpee', '3', '10', '60s'),
      ],
    },
    {
      day: 'Thursday',
      focus: 'Upper Mix',
      type: 'training',
      exercises: [
        fallbackEx('Incline Press', '3', '10', '60s'),
        fallbackEx('Cable Row', '3', '10-12', '60s'),
        fallbackEx('Arnold Press', '3', '10-12', '60s'),
        fallbackEx('Chest Supported Row', '3', '10-12', '60s'),
        fallbackEx('Push-Up', '3', '12-15', '45s'),
        fallbackEx('Rear Delt Fly', '3', '15', '45s'),
        fallbackEx('Skull Crusher', '3', '10-12', '45s'),
        fallbackEx('Preacher Curl', '3', '10-12', '45s'),
      ],
    },
    { day: 'Friday', focus: 'Full Rest', type: 'rest', exercises: [fallbackEx('Recovery', '-', '-', '-')] },
  ],
});

const FALLBACK_WORKOUT_FEMALE = (coachId) => ({
  coachId,
  days: [
    {
      day: 'Saturday',
      focus: 'Lower Body',
      type: 'training',
      exercises: [
        fallbackEx('Squat', '4', '8-10', '90s'),
        fallbackEx('Romanian Deadlift', '3', '10-12', '90s'),
        fallbackEx('Hip Thrust', '3', '12-15', '60s'),
        fallbackEx('Leg Curl', '3', '12-15', '60s'),
        fallbackEx('Glute Bridge', '3', '15', '45s'),
        fallbackEx('Calf Raise', '3', '15-20', '45s'),
        fallbackEx('Step Up', '3', '10 each leg', '60s'),
        fallbackEx('Bulgarian Split Squat', '3', '10 each leg', '60s'),
      ],
    },
    {
      day: 'Sunday',
      focus: 'Upper Body',
      type: 'training',
      exercises: [
        fallbackEx('Push Up', '3', '10-15', '60s'),
        fallbackEx('DB Row', '3', '10-12', '60s'),
        fallbackEx('Shoulder Press', '3', '8-10', '90s'),
        fallbackEx('Lat Pulldown', '3', '10-12', '60s'),
        fallbackEx('Tricep Extension', '3', '12-15', '45s'),
        fallbackEx('Bicep Curl', '3', '12-15', '45s'),
        fallbackEx('Face Pull', '3', '15', '45s'),
        fallbackEx('Chest Fly', '3', '12-15', '45s'),
      ],
    },
    {
      day: 'Monday',
      focus: 'Active Rest / Yoga',
      type: 'rest',
      exercises: [fallbackEx('Active Rest / Yoga', '-', '-', '-')],
    },
    {
      day: 'Tuesday',
      focus: 'Full Body',
      type: 'training',
      exercises: [
        fallbackEx('Deadlift', '4', '6-8', '120s'),
        fallbackEx('Goblet Squat', '3', '10-12', '60s'),
        fallbackEx('DB Lunge', '3', '10 each leg', '60s'),
        fallbackEx('Plank', '3', '45-60s', '45s'),
        fallbackEx('Mountain Climber', '3', '30s', '30s'),
        fallbackEx('Russian Twist', '3', '20', '45s'),
        fallbackEx('Bird Dog', '3', '12 each side', '45s'),
        fallbackEx('Kettlebell Swing', '3', '15', '60s'),
      ],
    },
    {
      day: 'Wednesday',
      focus: 'Cardio + Core',
      type: 'training',
      exercises: [
        fallbackEx('Jump Rope', '3', '60s', '30s'),
        fallbackEx('Bicycle Crunch', '3', '20', '45s'),
        fallbackEx('Dead Bug', '3', '12', '45s'),
        fallbackEx('Hip Thrust', '3', '15', '60s'),
        fallbackEx('Lateral Band Walk', '3', '15 each side', '45s'),
        fallbackEx('Glute Kickback', '3', '15 each leg', '45s'),
        fallbackEx('Side Plank', '3', '30s each side', '45s'),
        fallbackEx('Box Step-Up', '3', '12 each leg', '45s'),
      ],
    },
    {
      day: 'Thursday',
      focus: 'Upper + Core',
      type: 'training',
      exercises: [
        fallbackEx('Cable Row', '3', '10-12', '60s'),
        fallbackEx('Chest Press', '3', '10-12', '60s'),
        fallbackEx('Shoulder Raise', '3', '12-15', '45s'),
        fallbackEx('Pull Down', '3', '10-12', '60s'),
        fallbackEx('Ab Rollout', '3', '10-12', '45s'),
        fallbackEx('Hollow Hold', '3', '30s', '45s'),
        fallbackEx('Superman', '3', '15', '45s'),
        fallbackEx('Pallof Press', '3', '12 each side', '45s'),
      ],
    },
    {
      day: 'Friday',
      focus: 'Full Rest',
      type: 'rest',
      exercises: [fallbackEx('Full Rest', '-', '-', '-')],
    },
  ],
});

const FALLBACK_WORKOUT_BODYWEIGHT_MALE = (coachId) => ({
  coachId,
  days: [
    {
      day: 'Saturday',
      focus: 'Push',
      type: 'training',
      exercises: [
        fallbackEx('Push Ups', '4', '12-15', '60s'),
        fallbackEx('Pike Push Ups', '3', '10-12', '60s'),
        fallbackEx('Diamond Push Ups', '3', '10-12', '60s'),
        fallbackEx('Tricep Dips', '3', '12-15', '45s'),
        fallbackEx('Shoulder Taps', '3', '20', '45s'),
        fallbackEx('Plank to Push Up', '3', '10', '60s'),
        fallbackEx('Incline Push Ups', '3', '15', '45s'),
        fallbackEx('Arm Circles', '3', '30s', '30s'),
      ],
    },
    {
      day: 'Sunday',
      focus: 'Pull',
      type: 'training',
      exercises: [
        fallbackEx('Pull Ups', '4', '6-10', '90s'),
        fallbackEx('Inverted Rows', '3', '10-12', '60s'),
        fallbackEx('Superman Hold', '3', '30s', '45s'),
        fallbackEx('Reverse Snow Angels', '3', '15', '45s'),
        fallbackEx('Bicep Curl (Band)', '3', '12-15', '45s'),
        fallbackEx('Dead Hang', '3', '30s', '60s'),
        fallbackEx('Scapular Pull Ups', '3', '10', '60s'),
        fallbackEx('Face Pull (Band)', '3', '15', '45s'),
      ],
    },
    { day: 'Monday', focus: 'Active Rest', type: 'rest', exercises: [fallbackEx('30 min walk', '-', '-', '-')] },
    {
      day: 'Tuesday',
      focus: 'Legs',
      type: 'training',
      exercises: [
        fallbackEx('Bodyweight Squats', '4', '15-20', '60s'),
        fallbackEx('Walking Lunges', '3', '12 each leg', '60s'),
        fallbackEx('Glute Bridge', '3', '15-20', '45s'),
        fallbackEx('Calf Raises', '3', '20', '45s'),
        fallbackEx('Bulgarian Split Squat', '3', '10 each leg', '60s'),
        fallbackEx('Wall Sit', '3', '45s', '60s'),
        fallbackEx('Single Leg RDL', '3', '10 each leg', '60s'),
        fallbackEx('Jump Squats', '3', '12', '60s'),
      ],
    },
    {
      day: 'Wednesday',
      focus: 'Core + Cardio',
      type: 'training',
      exercises: [
        fallbackEx('Plank', '3', '60s', '45s'),
        fallbackEx('Mountain Climbers', '3', '30s', '30s'),
        fallbackEx('Russian Twist', '3', '20', '45s'),
        fallbackEx('Dead Bug', '3', '12', '45s'),
        fallbackEx('Bicycle Crunch', '3', '20', '45s'),
        fallbackEx('Burpees', '3', '10', '60s'),
        fallbackEx('High Knees', '3', '30s', '30s'),
        fallbackEx('Jumping Jacks', '3', '45s', '30s'),
      ],
    },
    {
      day: 'Thursday',
      focus: 'Full Body',
      type: 'training',
      exercises: [
        fallbackEx('Push Ups', '3', '12-15', '60s'),
        fallbackEx('Pull Ups', '3', '6-10', '90s'),
        fallbackEx('Squats', '3', '15-20', '60s'),
        fallbackEx('Lunges', '3', '10 each leg', '60s'),
        fallbackEx('Plank', '3', '45s', '45s'),
        fallbackEx('Glute Bridge', '3', '15', '45s'),
        fallbackEx('Tricep Dips', '3', '12', '45s'),
        fallbackEx('Superman', '3', '15', '45s'),
      ],
    },
    { day: 'Friday', focus: 'Full Rest', type: 'rest', exercises: [fallbackEx('Recovery', '-', '-', '-')] },
  ],
});

const FALLBACK_WORKOUT_BODYWEIGHT_FEMALE = (coachId) => ({
  coachId,
  days: [
    {
      day: 'Saturday',
      focus: 'Lower Body',
      type: 'training',
      exercises: [
        fallbackEx('Bodyweight Squats', '4', '15-20', '60s'),
        fallbackEx('Glute Bridge', '3', '15-20', '45s'),
        fallbackEx('Walking Lunges', '3', '12 each leg', '60s'),
        fallbackEx('Bulgarian Split Squat', '3', '10 each leg', '60s'),
        fallbackEx('Calf Raises', '3', '20', '45s'),
        fallbackEx('Wall Sit', '3', '45s', '60s'),
        fallbackEx('Single Leg RDL', '3', '10 each leg', '60s'),
        fallbackEx('Step Ups', '3', '12 each leg', '60s'),
      ],
    },
    {
      day: 'Sunday',
      focus: 'Upper Body',
      type: 'training',
      exercises: [
        fallbackEx('Push Ups', '3', '10-15', '60s'),
        fallbackEx('Inverted Rows', '3', '10-12', '60s'),
        fallbackEx('Pike Push Ups', '3', '10-12', '60s'),
        fallbackEx('Tricep Dips', '3', '12-15', '45s'),
        fallbackEx('Superman Hold', '3', '30s', '45s'),
        fallbackEx('Plank Shoulder Taps', '3', '20', '45s'),
        fallbackEx('Band Pull Apart', '3', '15', '45s'),
        fallbackEx('Arm Circles', '3', '30s', '30s'),
      ],
    },
    { day: 'Monday', focus: 'Active Rest / Yoga', type: 'rest', exercises: [fallbackEx('Active Rest / Yoga', '-', '-', '-')] },
    {
      day: 'Tuesday',
      focus: 'Full Body',
      type: 'training',
      exercises: [
        fallbackEx('Squats', '4', '15-20', '60s'),
        fallbackEx('Push Ups', '3', '12-15', '60s'),
        fallbackEx('Lunges', '3', '10 each leg', '60s'),
        fallbackEx('Glute Bridge', '3', '15', '45s'),
        fallbackEx('Plank', '3', '45-60s', '45s'),
        fallbackEx('Mountain Climbers', '3', '30s', '30s'),
        fallbackEx('Dead Bug', '3', '12', '45s'),
        fallbackEx('Jump Squats', '3', '12', '60s'),
      ],
    },
    {
      day: 'Wednesday',
      focus: 'Core + Cardio',
      type: 'training',
      exercises: [
        fallbackEx('Plank', '3', '45s', '45s'),
        fallbackEx('Bicycle Crunch', '3', '20', '45s'),
        fallbackEx('Russian Twist', '3', '20', '45s'),
        fallbackEx('Glute Bridge', '3', '15', '60s'),
        fallbackEx('Side Plank', '3', '30s each side', '45s'),
        fallbackEx('Burpees', '3', '10', '60s'),
        fallbackEx('High Knees', '3', '30s', '30s'),
        fallbackEx('Jumping Jacks', '3', '45s', '30s'),
      ],
    },
    {
      day: 'Thursday',
      focus: 'Upper + Core',
      type: 'training',
      exercises: [
        fallbackEx('Push Ups', '3', '12-15', '60s'),
        fallbackEx('Pull Ups', '3', '6-10', '90s'),
        fallbackEx('Inverted Rows', '3', '10-12', '60s'),
        fallbackEx('Tricep Dips', '3', '12', '45s'),
        fallbackEx('Plank', '3', '45s', '45s'),
        fallbackEx('Superman', '3', '15', '45s'),
        fallbackEx('Bird Dog', '3', '12 each side', '45s'),
        fallbackEx('Hollow Hold', '3', '30s', '45s'),
      ],
    },
    { day: 'Friday', focus: 'Full Rest', type: 'rest', exercises: [fallbackEx('Full Rest', '-', '-', '-')] },
  ],
});

function usesBodyweightEquipment(equipment, location) {
  const eq = String(equipment || '').toLowerCase();
  const loc = String(location || '').toLowerCase();
  return eq === 'bodyweight'
    || eq === 'home_basic'
    || eq === 'home_full'
    || eq === 'home'
    || loc === 'home';
}

/** Gender-, duration-, and equipment-aware fallback when Gemini plan generation fails. */
export function getFallbackWorkoutPlan(coachId, gender = 'male', sessionDuration = 45, equipment = 'full_gym', location = 'gym') {
  const normalizedGender = String(gender || 'male').toLowerCase();
  const bodyweight = usesBodyweightEquipment(equipment, location);
  const basePlan = bodyweight
    ? (normalizedGender === 'female'
      ? FALLBACK_WORKOUT_BODYWEIGHT_FEMALE(coachId)
      : FALLBACK_WORKOUT_BODYWEIGHT_MALE(coachId))
    : (normalizedGender === 'female'
      ? FALLBACK_WORKOUT_FEMALE(coachId)
      : FALLBACK_WORKOUT_MALE(coachId));
  return applySessionDurationToFallbackPlan(basePlan, sessionDuration);
}

const NUTRITION_ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

/** Map profile/UI goal strings to fat_loss | muscle_gain | maintain. */
export function normalizeAthleteGoal(goal) {
  const g = String(goal || '').toLowerCase().trim();
  if (
    g === 'fat_loss'
    || g === 'lose_weight'
    || g === 'cut'
    || g.includes('burn fat')
    || g.includes('lose weight')
    || (g.includes('fat') && g.includes('loss'))
  ) {
    return 'fat_loss';
  }
  if (
    g === 'muscle_gain'
    || g === 'muscle'
    || g === 'bulk'
    || g.includes('build muscle')
    || g.includes('gain mass')
    || (g.includes('muscle') && g.includes('gain'))
  ) {
    return 'muscle_gain';
  }
  if (
    g === 'maintain'
    || g === 'endurance'
    || g === 'health'
    || g.includes('athletic')
    || g.includes('endurance')
  ) {
    return 'maintain';
  }
  return 'maintain';
}

function normalizeNutritionGoal(goal) {
  return normalizeAthleteGoal(goal);
}

function getNutritionActivityMultiplier(activityLevel) {
  const level = String(activityLevel || 'moderate').toLowerCase();
  if (level.includes('sedent') || level === 'low') return NUTRITION_ACTIVITY_MULTIPLIERS.sedentary;
  if (level.includes('light')) return NUTRITION_ACTIVITY_MULTIPLIERS.light;
  if (level.includes('very') || (level.includes('active') && !level.includes('moderate'))) {
    return NUTRITION_ACTIVITY_MULTIPLIERS.active;
  }
  if (level.includes('moderate')) return NUTRITION_ACTIVITY_MULTIPLIERS.moderate;
  return NUTRITION_ACTIVITY_MULTIPLIERS[level] ?? NUTRITION_ACTIVITY_MULTIPLIERS.moderate;
}

/** Profile-aware fallback when Gemini nutrition plan generation fails. */
export function getFallbackNutritionPlan(athlete = {}) {
  const weightKg = Number(athlete.weight_kg) || 70;
  const heightCm = Number(athlete.height_cm) || 175;
  const age = Math.max(15, Number(athlete.age) || 30);
  const gender = String(athlete.gender || 'male').toLowerCase();
  const isFemale = gender === 'female' || gender === 'f';

  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (isFemale ? -161 : 5);
  const activityMultiplier = getNutritionActivityMultiplier(athlete.activity_level);
  let tdee = bmr * activityMultiplier;

  const goal = normalizeNutritionGoal(athlete.goal);
  if (goal === 'fat_loss') tdee -= 500;
  else if (goal === 'muscle_gain') tdee += 300;

  const dailyCalories = Math.round(Math.max(1200, tdee));
  const proteinPerKg = goal === 'muscle_gain' ? 2 : 1.8;
  const protein = Math.round(proteinPerKg * weightKg);
  const fat = Math.round((goal === 'muscle_gain' ? 1 : 0.8) * weightKg);
  const carbs = Math.max(0, Math.round((dailyCalories - protein * 4 - fat * 9) / 4));

  const diet = String(athlete.diet || 'none').toLowerCase();
  const isVegetarian = diet === 'vegetarian';

  const mealDefs = isVegetarian
    ? [
      { name: 'Breakfast', time: '8:00 AM', share: 0.28, foods: ['Tofu scramble', 'Oats', 'Berries'] },
      { name: 'Lunch', time: '1:00 PM', share: 0.35, foods: ['Lentils', 'Rice', 'Vegetables'] },
      { name: 'Dinner', time: '7:00 PM', share: 0.37, foods: ['Tempeh', 'Quinoa', 'Salad'] },
    ]
    : [
      { name: 'Breakfast', time: '8:00 AM', share: 0.28, foods: ['Eggs', 'Oats', 'Berries'] },
      { name: 'Lunch', time: '1:00 PM', share: 0.35, foods: ['Chicken', 'Rice', 'Vegetables'] },
      { name: 'Dinner', time: '7:00 PM', share: 0.37, foods: ['Fish', 'Potato', 'Salad'] },
    ];

  const meals = mealDefs.map(meal => ({
    name: meal.name,
    time: meal.time,
    calories: Math.round(dailyCalories * meal.share),
    foods: meal.foods,
    protein_g: Math.round(protein * meal.share),
    carbs_g: Math.round(carbs * meal.share),
    fat_g: Math.round(fat * meal.share),
  }));

  const notes = goal === 'fat_loss'
    ? 'High-protein deficit plan. Prioritize lean protein and whole foods.'
    : goal === 'muscle_gain'
      ? 'Lean bulk plan. Hit protein targets and fuel training days.'
      : 'Balanced maintenance plan. Adjust portions as you track progress.';

  return {
    daily_calories: dailyCalories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    meals,
    water_glasses: 8,
    notes,
  };
}

function normalizeOnboardingWorkoutPlan(raw, coachId) {
  const days = (raw?.days || []).map(day => ({
    day: day.day || day.name,
    focus: day.focus || '',
    type: day.type === 'rest' ? 'rest' : 'training',
    exercises: (day.exercises || []).map(exercise => ({
      name: exercise.name,
      sets: String(exercise.sets ?? '3'),
      reps: String(exercise.reps ?? '10'),
      rest: exercise.rest || '60s',
      ...(exercise.notes ? { notes: exercise.notes } : {}),
    })),
  }));

  return {
    coachId: raw?.coachId || coachId,
    days,
  };
}

export async function generateOnboardingWorkoutPlan(athlete, knowledgeContent) {
  const coachId = String(athlete.coach_persona || 'aria').toLowerCase();
  const sessionDuration = athlete.session_duration || 45;
  const prompt = `You are an elite fitness coach with expertise from NASM, NSCA, ACSM, ACE, ISSN, and WHO guidelines.

SCIENTIFIC KNOWLEDGE BASE:
${knowledgeContent}

ATHLETE PROFILE:
- Name: ${athlete.display_name || 'Athlete'}, Age: ${athlete.age ?? 'unknown'}, Gender: ${athlete.gender || 'unknown'}
- Height: ${athlete.height_cm ?? 'unknown'}cm, Weight: ${athlete.weight_kg ?? 'unknown'}kg, Target weight: ${athlete.target_weight_kg ?? 'unknown'}kg
- BMI: ${athlete.bmi ?? 'unknown'}
- Primary goal: ${athlete.goal || 'general fitness'}
- Experience level: ${athlete.experience_level || 'intermediate'}
- Activity level: ${athlete.activity_level || 'moderate'}
- Training location: ${athlete.location || 'gym'}
- Available equipment: ${athlete.equipment || 'full_gym'}
- Training days per week: ${athlete.days_per_week ?? 4}
- Session duration: ${sessionDuration} minutes
- Injuries or limitations: ${athlete.injuries || 'none'}
- Coach persona: ${coachId}

Based on the scientific knowledge base and athlete profile above, create a highly personalized, evidence-based 7-day workout plan.

SESSION DURATION RULES (must fit within ${sessionDuration} minutes per session including warm-up):
- Session duration: ${sessionDuration} minutes
- If 15 min: 3-4 exercises per training day, compound movements only, no full rest days — replace with active recovery
- If 30 min: 4-5 exercises per training day
- If 45 min: 6-7 exercises per training day
- If 60+ min: 7-8 exercises per training day

Apply these principles:
- Progressive overload based on experience level
- Proper volume landmarks (MEV, MAV, MRV) for goal
- Appropriate rep ranges for goal (strength: 1-5, hypertrophy: 6-20, endurance: 20+)
- Correct rest periods
- Injury prevention based on limitations
- Periodization appropriate for experience level

Return ONLY valid JSON:
{
  "coachId": "${coachId}",
  "days": [
    {
      "name": "Saturday",
      "type": "train",
      "focus": "muscle group focus",
      "exercises": [
        {
          "name": "exercise name",
          "sets": 3,
          "reps": "8-12",
          "rest": "90s",
          "notes": "form tip"
        }
      ]
    }
  ]
}`;

  const raw = await generateJsonFromPrompt(prompt, 8192, { timeoutMs: PLAN_GENERATION_TIMEOUT_MS });
  return normalizeOnboardingWorkoutPlan(raw, coachId);
}

export async function generateOnboardingNutritionPlan(athlete) {
  const coachNutritionStyle = {
    aria: `General Fitness Nutrition: Moderate caloric adjustment (±300 kcal from TDEE). Balanced macros: 30% protein, 40% carbs, 30% fat. Focus on whole foods, meal timing, and sustainable eating habits.`,
    blaze: `Fat Loss Nutrition (ISSN-based): Aggressive caloric deficit (500-750 kcal below TDEE). Very high protein (2.3-3.1g/kg) to preserve muscle during deficit. Carb cycling: lower carbs on rest days, higher on training days.`,
    kane: `Hypertrophy Nutrition (ISSN-based): Caloric surplus (300-500 kcal above TDEE). High protein (1.8-2.2g/kg bodyweight). Carb-focused pre and post workout for glycogen replenishment. Casein protein before sleep for overnight muscle protein synthesis.`,
    nova: `Strength Nutrition (NSCA-based): Caloric surplus on training days (400-600 kcal above TDEE). High protein (1.8-2.0g/kg). Emphasize pre-workout carbs for maximal strength output and post-workout protein within 30 minutes.`,
    zara: `Functional Fitness Nutrition: Maintenance calories with clean whole foods. Anti-inflammatory focus: omega-3 rich foods, colorful vegetables. High hydration (35ml per kg bodyweight). Emphasize micronutrients for joint health and recovery.`,
  };

  const persona = athlete.coach_persona || athlete.coachId || 'aria';
  const nutritionStyle = coachNutritionStyle[persona] || coachNutritionStyle['aria'];

  const prompt = `You are an expert sports nutritionist certified by ISSN and WHO. Create a precise, science-based daily nutrition plan.

ATHLETE PROFILE:
- Age: ${athlete.age ?? 'unknown'} | Gender: ${athlete.gender || 'unknown'}
- Height: ${athlete.height_cm ?? 'unknown'}cm | Current Weight: ${athlete.weight_kg ?? 'unknown'}kg | Target Weight: ${athlete.target_weight_kg ?? 'unknown'}kg
- Goal: ${athlete.goal || 'general fitness'}
- Activity Level: ${athlete.activity_level || 'moderate'}
- Training Days Per Week: ${athlete.days_per_week ?? 4}
- Diet Restrictions: ${athlete.diet || 'none'}
- Coach: ${persona}

NUTRITION PHILOSOPHY FOR THIS COACH:
${nutritionStyle}

CALCULATION PROTOCOL (follow strictly):
1. Calculate BMR using Mifflin-St Jeor equation:
   - Male: BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) + 5
   - Female: BMR = (10 × weight_kg) + (6.25 × height_cm) - (5 × age) - 161
2. Calculate TDEE using activity multiplier:
   - Sedentary: BMR × 1.2
   - Lightly active (1-3 days/week): BMR × 1.375
   - Moderately active (3-5 days/week): BMR × 1.55
   - Very active (6-7 days/week): BMR × 1.725
3. Adjust calories based on goal and coach philosophy
4. Set protein per ISSN guidelines (1.6-3.1g/kg based on goal)
5. Set fat at 25-35% of total calories
6. Fill remaining calories with carbohydrates

STRICT MEAL REQUIREMENTS:
- Each food item must include gram amount (e.g. "Chicken breast 150g")
- Include Pre-Workout meal (2 hours before training)
- Include Post-Workout meal (within 30 minutes after training)
- Breakfast must have minimum 30g protein
- Dinner must be lighter than lunch
- All foods must be real, common, and easy to prepare
- No supplements — whole foods only

Return ONLY valid JSON:
{
  "daily_calories": 2400,
  "protein_g": 180,
  "carbs_g": 240,
  "fat_g": 70,
  "water_glasses": 10,
  "meals": [
    {
      "name": "Breakfast",
      "time": "7:00 AM",
      "calories": 500,
      "protein_g": 40,
      "carbs_g": 45,
      "fat_g": 12,
      "foods": ["Eggs 3 whole (150g)", "Oatmeal 80g dry", "Banana 1 medium (120g)"]
    },
    {
      "name": "Pre-Workout",
      "time": "11:00 AM",
      "calories": 350,
      "protein_g": 25,
      "carbs_g": 45,
      "fat_g": 6,
      "foods": ["Greek yogurt 200g", "Rice cakes 3 pieces (30g)", "Honey 1 tbsp (20g)"]
    },
    {
      "name": "Post-Workout",
      "time": "1:30 PM",
      "calories": 500,
      "protein_g": 45,
      "carbs_g": 55,
      "fat_g": 8,
      "foods": ["Chicken breast 200g grilled", "White rice 150g cooked", "Broccoli 100g steamed"]
    },
    {
      "name": "Lunch",
      "time": "3:30 PM",
      "calories": 500,
      "protein_g": 35,
      "carbs_g": 50,
      "fat_g": 15,
      "foods": ["Salmon fillet 150g", "Sweet potato 200g baked", "Mixed salad 100g", "Olive oil 1 tbsp (14g)"]
    },
    {
      "name": "Snack",
      "time": "6:00 PM",
      "calories": 250,
      "protein_g": 20,
      "carbs_g": 25,
      "fat_g": 7,
      "foods": ["Cottage cheese 150g", "Apple 1 medium (180g)", "Almonds 20g"]
    },
    {
      "name": "Dinner",
      "time": "8:00 PM",
      "calories": 300,
      "protein_g": 35,
      "carbs_g": 20,
      "fat_g": 10,
      "foods": ["Turkey breast 180g", "Steamed vegetables 200g", "Olive oil 10g"]
    }
  ],
  "notes": "Personalized advice based on your goal and coach philosophy"
}`;

  return generateJsonFromPrompt(prompt, 4096, { timeoutMs: PLAN_GENERATION_TIMEOUT_MS });
}
