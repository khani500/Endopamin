export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const {
    model = 'gemini-2.5-flash',
    action = 'generateContent',
    alt,
    ...body
  } = req.body;

  let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${GEMINI_API_KEY}`;
  if (alt === 'sse') {
    url += '&alt=sse';
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (alt === 'sse') {
      const text = await response.text();
      res.status(response.status);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      return res.send(text);
    }

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
