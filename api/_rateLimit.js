import crypto from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { reportMessage } from './_sentry.js';

// Per-endpoint limits. ipPerMinute is the abuse layer (before auth),
// userPerMinute and daily are keyed by Supabase user id (after auth).
// daily exists only for endpoints that spend money at Google.
export const LIMITS = {
  gemini: { ipPerMinute: 100, userPerMinute: 20, daily: 300 },
  tts: { ipPerMinute: 150, userPerMinute: 30, daily: 500 },
  'replace-plans': { ipPerMinute: 30, userPerMinute: 5 },
  'save-profile': { ipPerMinute: 60, userPerMinute: 10 },
  'entitlement-sync': { ipPerMinute: 30, userPerMinute: 6 },
  'usda-search': { ipPerMinute: 120, userPerMinute: 30 },
};

export const RATE_LIMIT_MESSAGES = {
  minute: "You're sending requests a little too fast. Please wait a moment and try again.",
  daily: "You've reached today's limit for this feature. Please try again later.",
  unavailable: 'This feature is temporarily unavailable. Please try again in a moment.',
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Upstash resolves a slow call as { success: true, reason: 'timeout' }; we treat that as an outage.
const LIMITER_TIMEOUT_MS = 1500;
const OUTAGE_RETRY_AFTER_SEC = 30;
const SENTRY_THROTTLE_MS = 5 * 60 * 1000;

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token, retry: { retries: 1 } });
  return redis;
}

const limiters = {};
function getLimiter(prefix, algorithm) {
  if (limiters[prefix]) return limiters[prefix];
  const client = getRedis();
  if (!client) return null;
  limiters[prefix] = new Ratelimit({
    redis: client,
    limiter: algorithm,
    prefix,
    timeout: LIMITER_TIMEOUT_MS,
  });
  return limiters[prefix];
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 12);
}

function limitsFor(endpoint) {
  const limits = LIMITS[endpoint];
  if (!limits) throw new Error(`Unknown rate-limit endpoint: ${endpoint}`);
  return limits;
}

// Seconds until the next 00:00 UTC, at least 1.
export function secondsUntilUtcMidnight(now = Date.now()) {
  const next = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  return Math.max(1, Math.ceil((next - now) / 1000));
}

// Returns { state: 'allowed' | 'limited', result } or { state: 'unavailable', failure }.
async function runLimit(limiter, identifier, units = 1) {
  if (!limiter) return { state: 'unavailable', failure: 'not_configured' };
  try {
    const result = units > 1
      ? await limiter.limit(identifier, { rate: units })
      : await limiter.limit(identifier);
    if (result.reason === 'timeout') return { state: 'unavailable', failure: 'timeout' };
    return { state: result.success ? 'allowed' : 'limited', result };
  } catch {
    return { state: 'unavailable', failure: 'error' };
  }
}

// Structured log line. Never pass request bodies, tokens, prompts or TTS text here.
function logEvent(event, fields) {
  console.warn(JSON.stringify({ event, ...fields }));
}

const lastOutageReport = new Map();
async function reportOutage(endpoint, failure) {
  const key = `${endpoint}:${failure}`;
  const now = Date.now();
  const last = lastOutageReport.get(key);
  if (last !== undefined && now - last < SENTRY_THROTTLE_MS) return;
  lastOutageReport.set(key, now);
  await reportMessage('Rate limiter unavailable', 'warning', { endpoint, failure });
}

function send(res, { status, code, message, retryAfter, requestId }) {
  res.setHeader('Retry-After', String(retryAfter));
  const body = { error: message, message, code };
  if (requestId) body.requestId = requestId;
  res.status(status).json(body);
}

async function handleUnavailable(res, { endpoint, layer, failure, subject, failClosed, requestId }) {
  logEvent('ratelimit.limiter_unavailable', { endpoint, layer, failure, subject });
  await reportOutage(endpoint, failure);
  if (!failClosed) return true;
  logEvent('ratelimit.paid_blocked_unavailable', {
    endpoint, layer, failure, subject, retryAfter: OUTAGE_RETRY_AFTER_SEC,
  });
  send(res, {
    status: 503,
    code: 'temporarily_unavailable',
    message: RATE_LIMIT_MESSAGES.unavailable,
    retryAfter: OUTAGE_RETRY_AFTER_SEC,
    requestId,
  });
  return false;
}

function minuteRetryAfter(reset) {
  return Math.max(1, Math.ceil((Number(reset) - Date.now()) / 1000) || 1);
}

// Abuse layer, before auth, keyed by client IP. Always fails open.
// Returns true to continue; otherwise the 429 response has been sent.
export async function checkIpAbuseLimit(req, res, { endpoint, requestId } = {}) {
  const { ipPerMinute } = limitsFor(endpoint);
  const ip = getClientIp(req);
  const subject = hashIp(ip);
  const limiter = getLimiter(`rl:v2:ip:${endpoint}`, Ratelimit.slidingWindow(ipPerMinute, '60 s'));
  const outcome = await runLimit(limiter, ip);
  if (outcome.state === 'unavailable') {
    return handleUnavailable(res, {
      endpoint, layer: 'ip', failure: outcome.failure, subject, failClosed: false, requestId,
    });
  }
  if (outcome.state === 'allowed') return true;
  const retryAfter = minuteRetryAfter(outcome.result.reset);
  logEvent('ratelimit.minute_rejected', { endpoint, layer: 'ip', subject, retryAfter });
  send(res, {
    status: 429, code: 'rate_limited', message: RATE_LIMIT_MESSAGES.minute, retryAfter, requestId,
  });
  return false;
}

// Per-user minute limit, after auth. paid endpoints fail closed (503) when the limiter is unavailable.
export async function checkUserMinuteLimit(res, { endpoint, userId, paid = false, requestId } = {}) {
  const { userPerMinute } = limitsFor(endpoint);
  const limiter = getLimiter(`rl:v2:user:${endpoint}`, Ratelimit.slidingWindow(userPerMinute, '60 s'));
  const outcome = await runLimit(limiter, String(userId));
  if (outcome.state === 'unavailable') {
    return handleUnavailable(res, {
      endpoint, layer: 'user', failure: outcome.failure, subject: userId, failClosed: paid, requestId,
    });
  }
  const { limit, remaining, reset } = outcome.result;
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  if (outcome.state === 'allowed') return true;
  const retryAfter = minuteRetryAfter(reset);
  logEvent('ratelimit.minute_rejected', { endpoint, layer: 'user', subject: userId, retryAfter });
  send(res, {
    status: 429, code: 'rate_limited', message: RATE_LIMIT_MESSAGES.minute, retryAfter, requestId,
  });
  return false;
}

// Daily paid quota per user, per UTC day (fixed window aligned to 00:00 UTC).
// Call exactly once per client request, right before dispatching to Google.
// Keys include endpoint and action so per-action or weighted budgets can be added later.
// Always fails closed: never dispatch when the quota cannot be checked.
export async function consumeDailyQuota(res, {
  endpoint, userId, action = 'all', units = 1, requestId,
} = {}) {
  const { daily } = limitsFor(endpoint);
  if (!daily) throw new Error(`No daily quota configured for ${endpoint}`);
  const limiter = getLimiter(`q:v1:${endpoint}:${action}`, Ratelimit.fixedWindow(daily, '1 d'));
  const outcome = await runLimit(limiter, String(userId), units);
  if (outcome.state === 'unavailable') {
    return handleUnavailable(res, {
      endpoint, layer: 'daily', failure: outcome.failure, subject: userId, failClosed: true, requestId,
    });
  }
  if (outcome.state === 'allowed') return true;
  const retryAfter = secondsUntilUtcMidnight();
  logEvent('ratelimit.daily_rejected', { endpoint, layer: 'daily', action, subject: userId, retryAfter });
  send(res, {
    status: 429, code: 'daily_limit_reached', message: RATE_LIMIT_MESSAGES.daily, retryAfter, requestId,
  });
  return false;
}
