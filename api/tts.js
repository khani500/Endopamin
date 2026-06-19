import { checkRateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const allowed = await checkRateLimit(req, res, { name: 'tts', max: 30, windowSec: 60 });
  if (!allowed) return;

  const TTS_API_KEY = process.env.VITE_GOOGLE_TTS_API_KEY
    || process.env.GOOGLE_TTS_API_KEY
    || process.env.VITE_GEMINI_API_KEY
    || process.env.GEMINI_API_KEY;

  if (!TTS_API_KEY) {
    return res.status(500).json({ error: 'Google TTS API key not configured' });
  }

  const { text, voiceName } = req.body || {};
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${TTS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: trimmed },
          voice: {
            languageCode: 'en-US',
            name: voiceName || 'en-US-Neural2-F',
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
