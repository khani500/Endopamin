import { createClient } from '@supabase/supabase-js';
import { reportError } from './_sentry.js';

// RevenueCat is the entitlement authority. Nothing here toggles access per
// event: every trigger fetches the subscriber's CURRENT state from the
// RevenueCat REST API v2 and writes a projection of it.

const REVENUECAT_ORIGIN = 'https://api.revenuecat.com';
const REVENUECAT_BASE = `${REVENUECAT_ORIGIN}/v2`;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_PAGES = 5;

// RevenueCat's REST API id for the entitlement whose lookup key is "pro".
// This is the ONLY id matched; every other entitlement is ignored.
export const PRO_ENTITLEMENT_REST_ID = 'entlc0abebcfcd';

export const ENTITLEMENT_ENV = Object.freeze([
  'REVENUECAT_SECRET_API_KEY',
  'REVENUECAT_PROJECT_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]);

const ENVIRONMENTS = new Set(['production', 'sandbox']);

export function isValidUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Names only. Never return or log a value.
export function missingEnv(names = ENTITLEMENT_ENV) {
  return names.filter((name) => !process.env[name]);
}

export function createAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function inactive() {
  return {
    active: false,
    accessExpiresAt: null,
    store: null,
    environment: null,
    productId: null,
    subscriptionStatus: null,
  };
}

function isEpochMs(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function textOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toIso(ms) {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function grantsPro(subscription) {
  if (subscription === null || typeof subscription !== 'object') return false;
  if (subscription.gives_access !== true) return false;
  const items = subscription.entitlements?.items;
  return Array.isArray(items) && items.some((item) => item?.id === PRO_ENTITLEMENT_REST_ID);
}

// Pure: no I/O, never throws. Reports RevenueCat's view; whether access is
// still in force at a given moment is hasEffectiveAccess().
// accessExpiresAt includes grace: a subscription in its grace period carries a
// later current_period_ends_at than the entitlement's expires_at.
export function deriveEntitlement({ activeEntitlements, subscriptions } = {}) {
  if (!Array.isArray(activeEntitlements) || !Array.isArray(subscriptions)) return inactive();

  // A pro subscription whose period end is neither null nor a timestamp is ignored.
  const proSubscriptions = subscriptions.filter((subscription) => grantsPro(subscription)
    && (subscription.current_period_ends_at === null
      || subscription.current_period_ends_at === undefined
      || isEpochMs(subscription.current_period_ends_at)));

  const periodEnd = (subscription) => (isEpochMs(subscription.current_period_ends_at)
    ? subscription.current_period_ends_at
    : -Infinity);
  const latest = proSubscriptions.reduce(
    (best, subscription) => (best === null || periodEnd(subscription) > periodEnd(best) ? subscription : best),
    null,
  );

  const result = inactive();
  if (latest) {
    const environment = textOrNull(latest.environment)?.toLowerCase() ?? null;
    result.store = textOrNull(latest.store);
    result.environment = ENVIRONMENTS.has(environment) ? environment : null;
    result.productId = textOrNull(latest.product_id);
    result.subscriptionStatus = textOrNull(latest.status);
  }

  const periodEnds = proSubscriptions.map(periodEnd).filter(isEpochMs);
  const pro = activeEntitlements.find((item) => item?.entitlement_id === PRO_ENTITLEMENT_REST_ID);

  if (!pro) {
    if (periodEnds.length > 0) result.accessExpiresAt = toIso(Math.max(...periodEnds));
    return result;
  }

  // Active with no expiry (for example a lifetime purchase).
  if (pro.expires_at === null || pro.expires_at === undefined) {
    result.active = true;
    return result;
  }

  // Fail closed on an expiry we cannot read.
  if (!isEpochMs(pro.expires_at)) return inactive();
  const accessExpiresAt = toIso(Math.max(pro.expires_at, ...periodEnds));
  if (!accessExpiresAt) return inactive();

  result.active = true;
  result.accessExpiresAt = accessExpiresAt;
  return result;
}

// Effective access = active AND (no expiry OR expiry in the future).
export function hasEffectiveAccess({ active, accessExpiresAt } = {}, now = new Date()) {
  if (active !== true) return false;
  if (accessExpiresAt === null) return true;
  const expires = new Date(accessExpiresAt).getTime();
  return Number.isFinite(expires) && expires > now.getTime();
}

async function fetchPage(url, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) return { ok: true, missing: true };
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };

    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'unparseable_body' };
    }
    if (body === null || typeof body !== 'object' || !Array.isArray(body.items)) {
      return { ok: false, reason: 'unparseable_body' };
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

// The secret key is only ever sent to RevenueCat's own origin.
function resolveNextPage(nextPage) {
  if (typeof nextPage !== 'string' || nextPage.length === 0) return null;
  try {
    const url = new URL(nextPage, REVENUECAT_ORIGIN);
    return url.origin === REVENUECAT_ORIGIN ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchList(firstUrl, apiKey) {
  const items = [];
  let url = firstUrl;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchPage(url, apiKey);
    if (!result.ok) return result;
    if (result.missing) {
      // 404 on the first page = the customer has no purchases. Later = broken.
      return page === 1 ? { ok: true, items: [], missing: true } : { ok: false, reason: 'page_missing' };
    }

    items.push(...result.body.items);

    const nextPage = result.body.next_page;
    if (nextPage === null || nextPage === undefined || nextPage === '') {
      return { ok: true, items, missing: false };
    }
    url = resolveNextPage(nextPage);
    if (!url) return { ok: false, reason: 'bad_next_page' };
  }

  return { ok: false, reason: 'too_many_pages' };
}

// -> { ok: true, activeEntitlements, subscriptions, customerMissing } | { ok: false, reason }
// customerMissing is true when RevenueCat answered 404 (no such customer).
export async function fetchRevenueCatState(appUserId) {
  const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!apiKey || !projectId) return { ok: false, reason: 'not_configured' };

  const customer = `${REVENUECAT_BASE}/projects/${encodeURIComponent(projectId)}`
    + `/customers/${encodeURIComponent(appUserId)}`;

  const [entitlements, subscriptions] = await Promise.all([
    fetchList(`${customer}/active_entitlements`, apiKey),
    fetchList(`${customer}/subscriptions`, apiKey),
  ]);

  if (!entitlements.ok) return { ok: false, reason: entitlements.reason };
  if (!subscriptions.ok) return { ok: false, reason: subscriptions.reason };

  return {
    ok: true,
    activeEntitlements: entitlements.items,
    subscriptions: subscriptions.items,
    customerMissing: entitlements.missing || subscriptions.missing,
  };
}

// Only the user id, source, event type and result. Never keys or response bodies.
function logResult(userId, source, eventType, result) {
  console.info('entitlement reconcile', {
    userId, source, eventType: eventType ?? null, result,
  });
}

async function fail(userId, source, eventType, code, extra = {}) {
  logResult(userId, source, eventType, code);
  await reportError(new Error(code), {
    area: 'entitlement', code, userId, source, ...extra,
  });
  return { ok: false };
}

// -> { skipped: 'non_uuid' | 'no_profile' } | { ok: false } | { ok: true, active, accessExpiresAt }
// On { ok: false } before the writes, nothing has been written.
export async function reconcileUser(admin, appUserId, { source, eventType = null } = {}) {
  // Anonymous RevenueCat ids are not Supabase users.
  if (!isValidUuid(appUserId)) return { skipped: 'non_uuid' };
  const userId = appUserId;

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, is_pro')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) return fail(userId, source, eventType, 'entitlement_profile_read_failed');
  if (!profile) {
    logResult(userId, source, eventType, 'skipped_no_profile');
    return { skipped: 'no_profile' };
  }

  const { data: projection, error: projectionErr } = await admin
    .from('user_entitlements')
    .select('active')
    .eq('user_id', userId)
    .maybeSingle();
  if (projectionErr) return fail(userId, source, eventType, 'entitlement_projection_read_failed');

  const state = await fetchRevenueCatState(userId);
  if (!state.ok) {
    return fail(userId, source, eventType, 'revenuecat_unavailable', { reason: state.reason });
  }

  // A 404 may only confirm an already-inactive projection. With an active one
  // it is an inconsistency (for example a wrong project id), not "no purchases".
  if (state.customerMissing && (projection?.active === true || profile.is_pro === true)) {
    return fail(userId, source, eventType, 'revenuecat_customer_missing_but_projection_active');
  }

  const now = new Date();
  const derived = deriveEntitlement(state);
  const effectiveAccess = hasEffectiveAccess(derived, now);
  const stamp = now.toISOString();

  const { error: upsertErr } = await admin
    .from('user_entitlements')
    .upsert({
      user_id: userId,
      entitlement: 'pro',
      active: derived.active,
      access_expires_at: derived.accessExpiresAt,
      store: derived.store,
      environment: derived.environment,
      product_id: derived.productId,
      subscription_status: derived.subscriptionStatus,
      last_sync_source: source,
      last_event_type: eventType ?? null,
      last_synced_at: stamp,
      updated_at: stamp,
    }, { onConflict: 'user_id' });
  if (upsertErr) return fail(userId, source, eventType, 'entitlement_projection_write_failed');

  // Compatibility projection. Written only here, with the service role.
  const { error: updateErr } = await admin
    .from('profiles')
    .update({ is_pro: effectiveAccess, pro_expires_at: derived.accessExpiresAt })
    .eq('id', userId);
  if (updateErr) return fail(userId, source, eventType, 'entitlement_profile_write_failed');

  logResult(userId, source, eventType, effectiveAccess ? 'active' : 'inactive');
  return { ok: true, active: effectiveAccess, accessExpiresAt: derived.accessExpiresAt };
}
