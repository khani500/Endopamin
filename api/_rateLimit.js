import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

const limiters = {};
function getLimiter(name, max, windowSec) {
  if (limiters[name]) return limiters[name];
  const client = getRedis();
  if (!client) return null;
  limiters[name] = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
    prefix: `rl:${name}`,
  });
  return limiters[name];
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// Returns true if the request is allowed, false if rate limited.
// Fails OPEN (allows) if Redis is not configured, so the app never breaks.
export async function checkRateLimit(req, res, { name, max, windowSec }) {
  const limiter = getLimiter(name, max, windowSec);
  if (!limiter) return true; // Redis not configured -> allow
  const ip = getClientIp(req);
  try {
    const { success, limit, remaining, reset } = await limiter.limit(ip);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
      return false;
    }
    return true;
  } catch (err) {
    console.error('Rate limit check failed, allowing request:', err.message);
    return true; // fail open on Redis error
  }
}
