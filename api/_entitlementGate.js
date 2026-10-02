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

const ROW_COLUMNS = 'active, access_expires_at, last_synced_at';

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

function syncedWithinTtl(row, now) {
  const synced = new Date(row.last_synced_at).getTime();
  if (!Number.isFinite(synced)) return false;
  const age = now.getTime() - synced;
  return age >= 0 && age < NEGATIVE_RECHECK_TTL_MS;
}

/**
 * Pure: no I/O, never throws.
 * row: the user's user_entitlements row ({ active, access_expires_at,
 * last_synced_at }) or null when there is none.
 * -> { action, rowState }
 *   action:   'allow' | 'would_block' | 'block' | 'reconcile'
 *   rowState: 'effective' | 'missing' | 'inactive' | 'expired'
 */
export function decideFromRow({ row, now, enforcementOn } = {}) {
  const at = now instanceof Date ? now : new Date();
  const rowState = rowStateOf(row, at);
  if (rowState === 'effective') return { action: 'allow', rowState };
  if (enforcementOn !== true) return { action: 'would_block', rowState };
  if (rowState !== 'missing' && syncedWithinTtl(row, at)) return { action: 'block', rowState };
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

/**
 * Handlers call, after the user is authenticated:
 *   if (await enforceEntitlement(req, res, { admin, userId, endpoint, requestId })) return;
 * Resolves true only when it sent the 402.
 * OFF (shadow mode): never blocks, never calls RevenueCat, never writes; logs
 * "entitlement.would_block" for a request that ON would not let straight through.
 * deps (tests only): { env, now, reconcile, report, log }.
 */
export async function enforceEntitlement(req, res, {
  admin, userId, endpoint, requestId, deps = {},
} = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const reconcile = deps.reconcile ?? reconcileUser;
  const report = deps.report ?? reportError;
  const log = deps.log ?? defaultLog;

  const enforcementOn = isEnforcementOn(env);

  async function failOpen(code, extra = {}) {
    log('entitlement.check_failed', {
      endpoint, userId, code, enforcement: enforcementOn ? 'on' : 'off', requestId, ...extra,
    });
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

  if (action === 'would_block') {
    log('entitlement.would_block', {
      endpoint, userId, rowState, ...clientFields(req), requestId,
    });
    return false;
  }

  if (action === 'reconcile') {
    let result;
    try {
      // 'app_sync' is one of the two sources the table's CHECK allows.
      result = await reconcile(admin, userId, { source: 'app_sync' });
    } catch {
      return failOpen('entitlement_gate_reconcile_threw', { rowState });
    }
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
