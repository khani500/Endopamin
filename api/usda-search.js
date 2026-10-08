import { createClient } from '@supabase/supabase-js';
import { enforceMinimumVersion } from './_appVersion.js';
import { applyCorsHeaders } from './_cors.js';
import { enforceEntitlement } from './_entitlementGate.js';
import { checkIpAbuseLimit, checkUserMinuteLimit } from './_rateLimit.js';
import { reportError, reportMessage } from './_sentry.js';

const ENDPOINT = 'usda-search';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const QUERY_MIN_LENGTH = 2;
const QUERY_MAX_LENGTH = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const PAGE_SIZE_PATTERN = /^\d{1,2}$/;
const UPSTREAM_TIMEOUT_MS = 5000;
const QUOTA_WARNING_THRESHOLD = 200;
const QUOTA_WARNING_INTERVAL_MS = 10 * 60 * 1000;
// Sentry gets at most one report per code in this window, per function instance.
const REPORT_THROTTLE_WINDOW_MS = 60 * 1000;

const UNAVAILABLE_MESSAGE = 'Food search is temporarily unavailable.';
const TIMEOUT_MESSAGE = 'Food search timed out. Please try again.';

let lastQuotaWarningAt = null;
const lastReportAt = new Map();

// Tests only.
export function resetReportThrottleForTests() {
  lastReportAt.clear();
}

function shouldReport(code, nowMs) {
  const last = lastReportAt.get(code);
  if (last !== undefined && nowMs - last >= 0 && nowMs - last < REPORT_THROTTLE_WINDOW_MS) return false;
  lastReportAt.set(code, nowMs);
  return true;
}

// Never pass the key, the upstream URL, the Authorization header or the search text here.
async function reportThrottled(code, context = {}) {
  if (!shouldReport(code, Date.now())) return;
  try {
    await reportError(new Error(code), { route: ENDPOINT, code, ...context });
  } catch {
    // Reporting must never change the response.
  }
}

// A single string, 2..100 characters after trim. Anything else is null.
function parseQuery(raw) {
  if (typeof raw !== 'string') return null;
  const query = raw.trim();
  return query.length >= QUERY_MIN_LENGTH && query.length <= QUERY_MAX_LENGTH ? query : null;
}

// Absent means the default. Otherwise a single string of 1-2 digits, 1..50. Anything else is null.
function parsePageSize(raw) {
  if (raw === undefined) return DEFAULT_PAGE_SIZE;
  if (typeof raw !== 'string' || !PAGE_SIZE_PATTERN.test(raw)) return null;
  const pageSize = Number(raw);
  return pageSize >= 1 && pageSize <= MAX_PAGE_SIZE ? pageSize : null;
}

// Never rejects. The handler awaits it before responding, because Vercel may
// freeze the function once the response is sent.
async function warnIfQuotaLow(upstream) {
  try {
    const header = upstream.headers.get('x-ratelimit-remaining');
    if (typeof header !== 'string' || !/^\d+$/.test(header)) return;
    const remaining = Number(header);
    if (remaining >= QUOTA_WARNING_THRESHOLD) return;
    const now = Date.now();
    if (lastQuotaWarningAt !== null && now - lastQuotaWarningAt < QUOTA_WARNING_INTERVAL_MS) return;
    lastQuotaWarningAt = now;
    await reportMessage('USDA quota low', 'warning', { remaining });
  } catch {
    // Reporting must never affect the search.
  }
}

async function sendUpstreamFailure(res, { status, code, message = UNAVAILABLE_MESSAGE, upstreamStatus }) {
  await reportThrottled(code, upstreamStatus !== undefined ? { upstreamStatus } : {});
  return res.status(status).json({ error: message, code });
}

export default async function handler(req, res) {
  const allowedOrigin = applyCorsHeaders(req, res, { methods: 'GET, OPTIONS' });
  if (req.method === 'OPTIONS' && allowedOrigin) {
    return res.status(204).end();
  }
  if (await enforceMinimumVersion(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = parseQuery(req.query?.query ?? req.query?.q);
  if (query === null) {
    return res.status(400).json({ error: 'Invalid search query', code: 'invalid_query' });
  }
  const pageSize = parsePageSize(req.query?.pageSize);
  if (pageSize === null) {
    return res.status(400).json({ error: 'Invalid page size', code: 'invalid_page_size' });
  }

  if (!(await checkIpAbuseLimit(req, res, { endpoint: ENDPOINT }))) return;

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

  if (!(await checkUserMinuteLimit(res, { endpoint: ENDPOINT, userId, paid: false }))) return;
  if (await enforceEntitlement(req, res, {
    admin: supabaseAdmin, userId, endpoint: ENDPOINT, requestId: null,
  })) return;

  const apiKey = (process.env.USDA_API_KEY || '').trim();
  if (!apiKey) {
    await reportThrottled('usda_not_configured');
    return res.status(503).json({ error: UNAVAILABLE_MESSAGE, code: 'usda_not_configured' });
  }

  const params = new URLSearchParams({ query, pageSize: String(pageSize), api_key: apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream;
  let text;
  let fetchFailure = null;
  // Started as soon as USDA answers, awaited below before any response. It never
  // rejects, so it cannot reach the catch here; running it alongside the body
  // read keeps a slow Sentry call from using up the upstream timeout.
  let quotaWarning = null;
  try {
    upstream = await fetch(`${USDA_SEARCH_URL}?${params}`, { signal: controller.signal });
    quotaWarning = warnIfQuotaLow(upstream);
    if (upstream.ok) text = await upstream.text();
  } catch {
    fetchFailure = controller.signal.aborted ? 'usda_timeout' : 'usda_unavailable';
  } finally {
    clearTimeout(timer);
  }

  if (quotaWarning) await quotaWarning;

  if (fetchFailure === 'usda_timeout') {
    return sendUpstreamFailure(res, { status: 504, code: fetchFailure, message: TIMEOUT_MESSAGE });
  }
  if (fetchFailure) {
    return sendUpstreamFailure(res, { status: 502, code: fetchFailure });
  }

  if (!upstream.ok) {
    return sendUpstreamFailure(res, {
      status: 502, code: 'usda_upstream_error', upstreamStatus: upstream.status,
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return sendUpstreamFailure(res, { status: 502, code: 'usda_bad_response' });
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.foods)) {
    return sendUpstreamFailure(res, { status: 502, code: 'usda_bad_response' });
  }

  return res.status(200).json({
    foods: data.foods,
    totalHits: Number.isFinite(data.totalHits) ? data.totalHits : null,
  });
}
