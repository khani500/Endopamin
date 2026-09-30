import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from './_cors.js';
import { checkIpAbuseLimit, checkUserMinuteLimit, consumeDailyQuota } from './_rateLimit.js';

const MAX_TEXT_CHARS = 5000;
const MAX_TEXT_BYTES = 5000;
const DEFAULT_VOICE = 'en-US-Neural2-F';
// Current coaches use F (Aria) and D (Kane); builds before the roster change also sent C, E, G and J.
const ALLOWED_VOICES = new Set([
  'en-US-Neural2-C',
  'en-US-Neural2-D',
  'en-US-Neural2-E',
  'en-US-Neural2-F',
  'en-US-Neural2-G',
  'en-US-Neural2-J',
]);

// Returns { ok: true, text, voiceName } or { ok: false, error }.
export function validateTtsRequest({ text, voiceName } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'text is required' };
  }
  if (trimmed.length > MAX_TEXT_CHARS) {
    return { ok: false, error: 'text exceeds 5000 character limit' };
  }
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_TEXT_BYTES) {
    return { ok: false, error: 'text exceeds 5000 byte limit' };
  }
  // Empty or missing voice falls back to the default, as before.
  if (!voiceName) {
    return { ok: true, text: trimmed, voiceName: DEFAULT_VOICE };
  }
  if (typeof voiceName !== 'string' || !ALLOWED_VOICES.has(voiceName)) {
    return { ok: false, error: 'Unsupported voice' };
  }
  return { ok: true, text: trimmed, voiceName };
}

export default async function handler(req, res) {
  const allowedOrigin = applyCorsHeaders(req, res);
  if (req.method === 'OPTIONS' && allowedOrigin) {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await checkIpAbuseLimit(req, res, { endpoint: 'tts' }))) return;

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const userId = userData.user.id;

  if (!(await checkUserMinuteLimit(res, { endpoint: 'tts', userId, paid: true }))) return;

  const TTS_API_KEY = process.env.VITE_GOOGLE_TTS_API_KEY
    || process.env.GOOGLE_TTS_API_KEY
    || process.env.VITE_GEMINI_API_KEY
    || process.env.GEMINI_API_KEY;

  if (!TTS_API_KEY) {
    return res.status(500).json({ error: 'Google TTS API key not configured' });
  }

  // Bounds run before the daily quota, so a rejected request never costs a unit.
  const validated = validateTtsRequest(req.body || {});
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  // One daily unit per request, taken only when we are about to call Google.
  if (!(await consumeDailyQuota(res, { endpoint: 'tts', userId }))) return;

  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${TTS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: validated.text },
          voice: {
            languageCode: 'en-US',
            name: validated.voiceName,
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 1.0,
            pitch: 0.0,
          },
        }),
      },
    );

    const data = await response.json();
    if (!response.ok || !data.audioContent) {
      const message = data.error?.message || 'Google TTS did not return audio.';
      return res.status(response.status || 500).json({ error: message });
    }

    return res.status(200).json({ audioContent: data.audioContent });
  } catch (err) {
    console.error('TTS API error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
