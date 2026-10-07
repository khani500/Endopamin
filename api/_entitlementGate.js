import { readClientVersion } from './_appVersion.js';
import { hasEffectiveAccess, reconcileUser } from './_entitlement.js';
import { reportError } from './_sentry.js';

// Server-side entitlement gate for paid endpoints. Non-entitled = read-only.
// A definite "inactive" is the only thing that blocks: every verification
// failure allows the request (fail open) and is reported.

export const ENFORCEMENT_ENV = 'ENTITLEMENT_ENFORCEMENT';
export const SUBSCRIPTION_REQUIRED_CODE = 'subscription_required';

// A non-effective row synced more recently than this is trusted as-is.
// reconcileUser writes only after a successful RevenueCat read, so a recent
// last_synced_at is a recent negative verification.
export const NEGATIVE_RECHECK_TTL_MS = 3 * 60 * 1000;

// An effective row synced more recently than this is trusted as-is. An older
// one (including a row with no expiry) is re-verified before it is trusted.
export const POSITIVE_RECHECK_TTL_MS = 24 * 60 * 60 * 1000;

// At most one re-verification attempt per user in this window, per function
// instance, whatever its outcome. Inside the window the row is trusted.
export const REVALIDATE_COOLDOWN_MS = 10 * 60 * 1000;

// A re-verification slower than this lets the request through (fail open).
export const REVALIDATE_TIMEOUT_MS = 2500;

// The cooldown map is emptied when it reaches this size.
export const REVALIDATE_COOLDOWN_MAX_ENTRIES = 5000;

// Sentry gets at most one fail-open report per (endpoint, code) in this window,
// per function instance. The structured log line is written every time.
export const REPORT_THROTTLE_WINDOW_MS = 60 * 1000;

const ROW_COLUMNS = 'active, access_expires_at, last_synced_at';

const lastFailOpenReport = new Map();
const lastRevalidateAttempt = new Map();

// Tests only.
export function resetReportThrottleForTests() {
  lastFailOpenReport.clear();
}

// Tests only.
export function resetRevalidateCooldownForTests() {
  lastRevalidateAttempt.clear();
}

function inRevalidateCooldown(userId, nowMs) {
  const last = lastRevalidateAttempt.get(userId);
  return last !== undefined && nowMs - last >= 0 && nowMs - last < REVALIDATE_COOLDOWN_MS;
}

function recordRevalidateAttempt(userId, nowMs) {
  if (lastRevalidateAttempt.size >= REVALIDATE_COOLDOWN_MAX_ENTRIES) lastRevalidateAttempt.clear();
  lastRevalidateAttempt.set(userId, nowMs);
}

function shouldReport(endpoint, code, nowMs) {
  const key = `${endpoint}:${code}`;
  const last = lastFailOpenReport.get(key);
  if (last !== undefined && nowMs - last >= 0 && nowMs - last < REPORT_THROTTLE_WINDOW_MS) return false;
  lastFailOpenReport.set(key, nowMs);
  return true;
}

// Only the exact string "on" enables blocking. Unset or anything else is OFF.
export function isEnforcementOn(env = process.env) {
  return env?.[ENFORCEMENT_ENV] === 'on';
}

function rowStateOf(row, now) {
  if (row === null || row === undefined || typeof row !== 'object') return 'missing';
  const effective = hasEffectiveAccess(
    { active: row.active, accessExpiresAt: row.access_expires_at ?? null },
    now,
  );
  if (effective) return 'effective';
  return row.active === true ? 'expired' : 'inactive';
}

// A missing, unreadable or future last_synced_at is never fresh.
function syncedWithinTtl(row, now, ttlMs) {
  const synced = new Date(row.last_synced_at).getTime();
  if (!Number.isFinite(synced)) return false;
  const age = now.getTime() - synced;
  return age >= 0 && age < ttlMs;
}

/**
 * Pure: no I/O, never throws.
 * row: the user's user_entitlements row ({ active, access_expires_at,
 * last_synced_at }) or null when there is none.
 * -> { action, rowState }
 *   action:   'allow' | 'revalidate' | 'would_block' | 'block' | 'reconcile'
 *   rowState: 'effective' | 'missing' | 'inactive' | 'expired'
 * 'revalidate' (both modes): an effective row not synced within
 * POSITIVE_RECHECK_TTL_MS.
 */
export function decideFromRow({ row, now, enforcementOn } = {}) {
  const at = now instanceof Date ? now : new Date();
  const rowState = rowStateOf(row, at);
  if (rowState === 'effective') {
    const fresh = syncedWithinTtl(row, at, POSITIVE_RECHECK_TTL_MS);
    return { action: fresh ? 'allow' : 'revalidate', rowState };
  }
  if (enforcementOn !== true) return { action: 'would_block', rowState };
  if (rowState !== 'missing' && syncedWithinTtl(row, at, NEGATIVE_RECHECK_TTL_MS)) return { action: 'block', rowState };
  return { action: 'reconcile', rowState };
}

function defaultLog(event, fields) {
  console.warn(JSON.stringify({ event, ...fields }));
}

// Builds that predate the version headers send none of the three.
function clientFields(req) {
  const { platform, version, build } = readClientVersion(req);
  const missing = platform === null && version === null && build === null;
  return {
    clientHeaders: missing ? 'missing' : 'present', platform, version, build,
  };
}

function sendSubscriptionRequired(res, requestId) {
  res.status(402).json({
    error: 'Subscription required',
    code: SUBSCRIPTION_REQUIRED_CODE,
    requestId,
  });
  return true;
}

// -> { result } | { threw: true } | { timedOut: true }. Never rejects.
// The race does not cancel reconcile: after a timeout it may still finish (and
// write) or fail, but nothing waits for it. Its rejection is always handled.
async function reconcileWithTimeout(reconcile, admin, userId, { setTimer, clearTimer }) {
  let settled;
  try {
    settled = Promise.resolve(reconcile(admin, userId, { source: 'app_sync' }))
      .then((result) => ({ result }), () => ({ threw: true }));
  } catch {
    return { threw: true };
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve({ timedOut: true }), REVALIDATE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimer(timer);
  }
}

/**
 * Handlers call, after the user is authenticated:
 *   if (await enforceEntitlement(req, res, { admin, userId, endpoint, requestId })) return;
 * Resolves true only when it sent the 402.
 * OFF (shadow mode): never blocks; logs "entitlement.would_block" for a request
 * that ON would not let straight through. It never calls RevenueCat for a
 * non-effective row, but it does re-verify a stale effective row (at most once
 * per REVALIDATE_COOLDOWN_MS per user per instance), which calls RevenueCat and
 * lets reconcileUser write.
 * deps (tests only): { env, now, reconcile, report, log, setTimer, clearTimer }.
 */
export async function enforceEntitlement(req, res, {
  admin, userId, endpoint, requestId, deps = {},
} = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const reconcile = deps.reconcile ?? reconcileUser;
  const report = deps.report ?? reportError;
  const log = deps.log ?? defaultLog;
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;

  const enforcementOn = isEnforcementOn(env);

  async function failOpen(code, extra = {}) {
    log('entitlement.check_failed', {
      endpoint, userId, code, enforcement: enforcementOn ? 'on' : 'off', requestId, ...extra,
    });
    if (!shouldReport(endpoint, code, now().getTime())) return false;
    try {
      await report(new Error(code), {
        area: 'entitlement-gate', code, endpoint, userId, requestId,
      });
    } catch {
      // Error reporting must never turn an allowed request into a failure.
    }
    return false;
  }

  let row;
  try {
    const { data, error } = await admin
      .from('user_entitlements')
      .select(ROW_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return failOpen('entitlement_gate_row_read_failed');
    row = data ?? null;
  } catch {
    return failOpen('entitlement_gate_row_read_failed');
  }

  const { action, rowState } = decideFromRow({ row, now: now(), enforcementOn });

  if (action === 'allow') return false;

  if (action === 'revalidate') {
    const startMs = now().getTime();
    if (inRevalidateCooldown(userId, startMs)) return false;
    recordRevalidateAttempt(userId, startMs);

    const outcome = await reconcileWithTimeout(reconcile, admin, userId, { setTimer, clearTimer });
    if (outcome.timedOut) return failOpen('entitlement_gate_revalidate_timeout', { rowState });
    if (outcome.threw) return failOpen('entitlement_gate_revalidate_threw', { rowState });
    const { result } = outcome;
    if (!result || result.ok !== true) {
      const code = result?.skipped
        ? 'entitlement_gate_revalidate_skipped'
        : 'entitlement_gate_revalidate_failed';
      return failOpen(code, { rowState });
    }
    if (result.active === true) return false;

    const fields = {
      endpoint, userId, rowState, verified: 'revalidate', result: 'inactive', ...clientFields(req), requestId,
    };
    if (!enforcementOn) {
      log('entitlement.would_block', fields);
      return false;
    }
    log('entitlement.blocked', fields);
    return sendSubscriptionRequired(res, requestId);
  }

  if (action === 'would_block') {
    log('entitlement.would_block', {
      endpoint, userId, rowState, ...clientFields(req), requestId,
    });
    return false;
  }

  if (action === 'reconcile') {
    // 'app_sync' is one of the two sources the table's CHECK allows.
    const outcome = await reconcileWithTimeout(reconcile, admin, userId, { setTimer, clearTimer });
    if (outcome.timedOut) return failOpen('entitlement_gate_reconcile_timeout', { rowState });
    if (outcome.threw) {
      return failOpen('entitlement_gate_reconcile_threw', { rowState });
    }
    const { result } = outcome;
    if (!result || result.ok !== true) {
      const code = result?.skipped
        ? 'entitlement_gate_reconcile_skipped'
        : 'entitlement_gate_reconcile_failed';
      return failOpen(code, { rowState });
    }
    if (result.active === true) return false;
  }

  log('entitlement.blocked', {
    endpoint, userId, rowState, verified: action === 'reconcile' ? 'reconcile' : 'recent_row',
    ...clientFields(req), requestId,
  });
  return sendSubscriptionRequired(res, requestId);
}
