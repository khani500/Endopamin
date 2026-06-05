export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function estimateBodyBytes(body) {
  if (!body) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return 0;
  }
}

function isPayloadTooLargeError(err) {
  const message = String(err?.message || '').toLowerCase();
  return (
    err?.statusCode === 413
    || message.includes('payload too large')
    || message.includes('entity too large')
    || message.includes('body exceeded')
    || message.includes('request body larger')
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: 'Request body too large. Try a smaller image or lower camera resolution.',
      maxBytes: MAX_BODY_BYTES,
    });
  }

  const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  let body;
  try {
    body = req.body;
  } catch (err) {
    if (isPayloadTooLargeError(err)) {
      return res.status(413).json({
        error: 'Request body too large. Try a smaller image or lower camera resolution.',
        maxBytes: MAX_BODY_BYTES,
      });
    }
    return res.status(400).json({ error: err.message || 'Invalid request body' });
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const estimatedBytes = estimateBodyBytes(body);
  if (estimatedBytes > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: 'Image payload too large after encoding. Try retaking the photo closer or in better light.',
      maxBytes: MAX_BODY_BYTES,
      estimatedBytes,
    });
  }

  const {
    model = 'gemini-2.5-flash',
    action = 'generateContent',
    alt,
    ...geminiBody
  } = body;

  // Forwards full Gemini payload: systemInstruction, generationConfig (responseSchema, maxOutputTokens), contents, etc.

  let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${GEMINI_API_KEY}`;
  if (alt === 'sse') {
    url += '&alt=sse';
  }

  try {
    const upstreamBody = JSON.stringify(geminiBody);
    if (Buffer.byteLength(upstreamBody, 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({
        error: 'Image payload too large for Gemini. Try a smaller photo.',
        maxBytes: MAX_BODY_BYTES,
      });
    }

    let response;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: upstreamBody,
        });
        if (response.status !== 503) break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!response) throw lastErr || new Error('Gemini unreachable');

    const text = await response.text();

    if (!response.ok) {
      let errorMessage = text;
      try {
        const parsed = JSON.parse(text);
        errorMessage = parsed?.error?.message || parsed?.error || text;
      } catch {
        // use raw text
      }
      console.error('Gemini API error:', errorMessage, response.status);
      res.setHeader('Content-Type', 'application/json');
      return res.status(response.status).send(text);
    }

    if (alt === 'sse') {
      res.status(response.status);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      return res.send(text);
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(response.status).send(text);
  } catch (err) {
    if (isPayloadTooLargeError(err)) {
      return res.status(413).json({
        error: 'Request body too large. Try a smaller image or lower camera resolution.',
        maxBytes: MAX_BODY_BYTES,
      });
    }
    console.error('Gemini API error:', err.message, err.status);
    return res.status(500).json({
      error: err.message || 'Internal Server Error',
      details: err.message,
    });
  }
}
