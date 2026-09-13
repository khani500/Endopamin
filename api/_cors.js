const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'https://www.endopamin.com',
  'https://endopamin.com',
  'https://app.endopamin.com',
]);

export function resolveAllowedOrigin(requestOrigin) {
  return typeof requestOrigin === 'string' && ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : null;
}

export function applyCorsHeaders(req, res, {
  methods = 'POST, OPTIONS',
  headers = 'authorization, content-type',
  maxAge = '86400',
} = {}) {
  const allowedOrigin = resolveAllowedOrigin(req.headers.origin);
  if (!allowedOrigin) return null;

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
    res.setHeader('Access-Control-Max-Age', maxAge);
  }

  return allowedOrigin;
}
