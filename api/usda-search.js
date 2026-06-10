export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = String(req.query.query || req.query.q || '').trim();
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 25));

  if (query.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  const apiKey = process.env.USDA_API_KEY
    || process.env.VITE_USDA_API_KEY
    || 'DEMO_KEY';

  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${apiKey}&pageSize=${pageSize}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    return res.status(upstream.ok ? 200 : upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'USDA upstream failed' });
  }
}
