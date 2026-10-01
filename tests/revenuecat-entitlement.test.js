import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetUpstash } from './_upstashFake.js';

vi.mock('@upstash/redis', async () => (await import('./_upstashFake.js')).redisModule);
vi.mock('@upstash/ratelimit', async () => (await import('./_upstashFake.js')).ratelimitModule);
vi.mock('../api/_sentry.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  reportMessage: vi.fn().mockResolvedValue(undefined),
}));

// In-memory Supabase admin. Records every write; reads come from db.profiles
// and db.entitlements.
const db = vi.hoisted(() => ({
  profiles: {},
  entitlements: {},
  writes: [],
  getUser: null,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (token) => db.getUser(token) },
    from(table) {
      const rows = table === 'profiles' ? db.profiles : db.entitlements;
      return {
        select: () => ({
          eq: (_column, value) => ({
            maybeSingle: async () => ({ data: rows[value] ?? null, error: null }),
          }),
        }),
        upsert: async (row) => {
          db.writes.push({ table, op: 'upsert', row });
          return { error: null };
        },
        update: (patch) => ({
          eq: async (_column, id) => {
            db.writes.push({ table, op: 'update', id, patch });
            return { error: null };
          },
        }),
      };
    },
  }),
}));

const { reportError } = await import('../api/_sentry.js');
const {
  PRO_ENTITLEMENT_REST_ID,
  deriveEntitlement,
  fetchRevenueCatState,
  hasEffectiveAccess,
} = await import('../api/_entitlement.js');
const { default: webhook } = await import('../api/revenuecat-webhook.js');
const { default: entitlementSync } = await import('../api/entitlement-sync.js');

const NOW = new Date('2026-10-01T12:00:00Z');
const DAY_MS = 86400000;
const FUTURE = NOW.getTime() + 30 * DAY_MS;
const GRACE_END = NOW.getTime() + 46 * DAY_MS;
const PAST = NOW.getTime() - DAY_MS;

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const WEBHOOK_AUTH = 'Bearer webhook-shared-secret';

function proEntitlement(expiresAt) {
  return { entitlement_id: PRO_ENTITLEMENT_REST_ID, expires_at: expiresAt };
}

function proSubscription(overrides = {}) {
  return {
    id: 'sub1',
    product_id: 'pro_monthly',
    store: 'app_store',
    environment: 'sandbox',
    status: 'active',
    gives_access: true,
    current_period_ends_at: FUTURE,
    entitlements: { items: [{ id: PRO_ENTITLEMENT_REST_ID }] },
    ...overrides,
  };
}

// RevenueCat fake. A customer present in rc.customers answers 200; any other
// customer answers 404. rc.down makes every call answer 500.
const rc = { customers: {}, down: false };
let fetchMock;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function revenueCatFetch(url) {
  if (rc.down) return jsonResponse({ type: 'server_error' }, 500);
  const match = /\/customers\/([^/]+)\/(active_entitlements|subscriptions)/.exec(String(url));
  const customer = match ? rc.customers[decodeURIComponent(match[1])] : null;
  if (!customer) return jsonResponse({ type: 'resource_missing' }, 404);
  const items = match[2] === 'active_entitlements' ? customer.entitlements : customer.subscriptions;
  return jsonResponse({ items, next_page: null });
}

function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function postWebhook(event, { authorization = WEBHOOK_AUTH } = {}) {
  const res = fakeRes();
  await webhook({
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: { event },
  }, res);
  return res;
}

async function postSync({ token = 'good', body = {} } = {}) {
  const res = fakeRes();
  await entitlementSync({
    method: 'POST',
    headers: {
      'x-forwarded-for': '203.0.113.7',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  }, res);
  return res;
}

const ENV = {
  REVENUECAT_SECRET_API_KEY: 'sk_test',
  REVENUECAT_PROJECT_ID: 'proj1',
  REVENUECAT_WEBHOOK_AUTH: WEBHOOK_AUTH,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-token',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  resetUpstash();
  Object.assign(process.env, ENV);
  db.profiles = {};
  db.entitlements = {};
  db.writes = [];
  db.getUser = async (token) => (token === 'good'
    ? { data: { user: { id: USER_A } }, error: null }
    : { data: { user: null }, error: { message: 'invalid' } });
  rc.customers = {};
  rc.down = false;
  reportError.mockClear();
  fetchMock = vi.fn(async (url) => revenueCatFetch(url));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.keys(ENV).forEach((name) => delete process.env[name]);
});

describe('deriveEntitlement', () => {
  it('active with an expiry, provenance from the subscription', () => {
    const derived = deriveEntitlement({
      activeEntitlements: [proEntitlement(FUTURE)],
      subscriptions: [proSubscription()],
    });
    expect(derived).toEqual({
      active: true,
      accessExpiresAt: new Date(FUTURE).toISOString(),
      store: 'app_store',
      environment: 'sandbox',
      productId: 'pro_monthly',
      subscriptionStatus: 'active',
    });
    expect(hasEffectiveAccess(derived, NOW)).toBe(true);
  });

  it('a grace period extends access past the entitlement expires_at', () => {
    const derived = deriveEntitlement({
      activeEntitlements: [proEntitlement(PAST)],
      subscriptions: [proSubscription({ status: 'in_grace_period', current_period_ends_at: GRACE_END })],
    });
    expect(derived.accessExpiresAt).toBe(new Date(GRACE_END).toISOString());
    expect(derived.subscriptionStatus).toBe('in_grace_period');
    expect(hasEffectiveAccess(derived, NOW)).toBe(true);
  });

  it('expired is inactive', () => {
    const gone = deriveEntitlement({
      activeEntitlements: [],
      subscriptions: [proSubscription({ status: 'expired', gives_access: false, current_period_ends_at: PAST })],
    });
    expect(gone.active).toBe(false);
    expect(hasEffectiveAccess(gone, NOW)).toBe(false);

    // Still listed by RevenueCat, but the expiry has passed and nothing extends it.
    const stale = deriveEntitlement({ activeEntitlements: [proEntitlement(PAST)], subscriptions: [] });
    expect(hasEffectiveAccess(stale, NOW)).toBe(false);
  });

  it('ignores any other entitlement id', () => {
    const derived = deriveEntitlement({
      activeEntitlements: [{ entitlement_id: 'entl_other', expires_at: FUTURE }],
      subscriptions: [proSubscription({ entitlements: { items: [{ id: 'entl_other' }] } })],
    });
    expect(derived).toEqual({
      active: false,
      accessExpiresAt: null,
      store: null,
      environment: null,
      productId: null,
      subscriptionStatus: null,
    });
  });

  it('a null expires_at while active means no expiry', () => {
    const derived = deriveEntitlement({
      activeEntitlements: [proEntitlement(null)],
      subscriptions: [proSubscription()],
    });
    expect(derived.active).toBe(true);
    expect(derived.accessExpiresAt).toBeNull();
    expect(hasEffectiveAccess(derived, NOW)).toBe(true);
  });

  it('malformed input fails closed and never throws', () => {
    const inputs = [
      undefined,
      {},
      { activeEntitlements: 'yes', subscriptions: [] },
      { activeEntitlements: [proEntitlement(FUTURE)], subscriptions: null },
      { activeEntitlements: [proEntitlement('tomorrow')], subscriptions: [] },
      { activeEntitlements: [null, 7], subscriptions: [null, 'x', { gives_access: true }] },
    ];
    for (const input of inputs) {
      expect(deriveEntitlement(input).active).toBe(false);
    }
  });
});

describe('fetchRevenueCatState', () => {
  it('404 is a valid empty state', async () => {
    expect(await fetchRevenueCatState(USER_A)).toEqual({
      ok: true, activeEntitlements: [], subscriptions: [], customerMissing: true,
    });
  });

  it('500 is a failure', async () => {
    rc.down = true;
    expect((await fetchRevenueCatState(USER_A)).ok).toBe(false);
  });

  it('a timeout is a failure', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await fetchRevenueCatState(USER_A)).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('revenuecat-webhook', () => {
  it.each([
    ['missing', null],
    ['wrong, same length', WEBHOOK_AUTH.replace('secret', 'secreT')],
    ['wrong, different length', 'Bearer nope'],
  ])('authorization %s -> 401, nothing fetched or written', async (_label, authorization) => {
    const res = await postWebhook({ type: 'RENEWAL', app_user_id: USER_A }, { authorization });
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('RevenueCat failure -> 500 and no DB write', async () => {
    db.profiles[USER_A] = { id: USER_A, is_pro: true };
    rc.down = true;
    const res = await postWebhook({ type: 'RENEWAL', app_user_id: USER_A });
    expect(res.statusCode).toBe(500);
    expect(db.writes).toEqual([]);
  });

  it('TRANSFER reconciles the destination and every transferred_from id', async () => {
    db.profiles[USER_A] = { id: USER_A, is_pro: false };
    db.profiles[USER_B] = { id: USER_B, is_pro: true };
    db.profiles[USER_C] = { id: USER_C, is_pro: true };
    rc.customers[USER_A] = { entitlements: [proEntitlement(FUTURE)], subscriptions: [proSubscription()] };
    rc.customers[USER_B] = { entitlements: [], subscriptions: [] };
    rc.customers[USER_C] = { entitlements: [], subscriptions: [] };

    const res = await postWebhook({
      type: 'TRANSFER',
      transferred_from: [USER_B, USER_C],
      transferred_to: [USER_A],
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, reconciled: 3, skipped: 0 });
    const profileWrites = Object.fromEntries(db.writes
      .filter((write) => write.table === 'profiles')
      .map((write) => [write.id, write.patch.is_pro]));
    expect(profileWrites).toEqual({ [USER_A]: true, [USER_B]: false, [USER_C]: false });
    const upserts = db.writes.filter((write) => write.table === 'user_entitlements');
    expect(upserts).toHaveLength(3);
    expect(upserts.every((write) => write.row.last_sync_source === 'webhook'
      && write.row.last_event_type === 'TRANSFER')).toBe(true);
  });

  it('non-UUID ids are skipped', async () => {
    const res = await postWebhook({
      type: 'INITIAL_PURCHASE',
      app_user_id: '$RCAnonymousID:abc123',
      aliases: ['$RCAnonymousID:abc123', 'not-a-uuid'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, reconciled: 0, skipped: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('404 with an active projection -> no write, reported, 500', async () => {
    db.profiles[USER_A] = { id: USER_A, is_pro: true };
    db.entitlements[USER_A] = { active: true };
    const res = await postWebhook({ type: 'EXPIRATION', app_user_id: USER_A });
    expect(res.statusCode).toBe(500);
    expect(db.writes).toEqual([]);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'revenuecat_customer_missing_but_projection_active' }),
      expect.objectContaining({ code: 'revenuecat_customer_missing_but_projection_active', userId: USER_A }),
    );
  });

  it('200 with an empty list and an active projection -> writes active=false', async () => {
    db.profiles[USER_A] = { id: USER_A, is_pro: true };
    db.entitlements[USER_A] = { active: true };
    rc.customers[USER_A] = { entitlements: [], subscriptions: [] };
    const res = await postWebhook({ type: 'EXPIRATION', app_user_id: USER_A });
    expect(res.statusCode).toBe(200);
    expect(db.writes).toEqual([
      expect.objectContaining({ table: 'user_entitlements', row: expect.objectContaining({ active: false }) }),
      {
        table: 'profiles', op: 'update', id: USER_A, patch: { is_pro: false, pro_expires_at: null },
      },
    ]);
  });
});

describe('entitlement-sync', () => {
  it('no token -> 401', async () => {
    const res = await postSync({ token: null });
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('success body is exactly { active, accessExpiresAt }', async () => {
    db.profiles[USER_A] = { id: USER_A, is_pro: false };
    rc.customers[USER_A] = { entitlements: [proEntitlement(FUTURE)], subscriptions: [proSubscription()] };
    const res = await postSync();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ active: true, accessExpiresAt: new Date(FUTURE).toISOString() });
    expect(db.writes.find((write) => write.table === 'user_entitlements').row).toMatchObject({
      user_id: USER_A, active: true, environment: 'sandbox', last_sync_source: 'app_sync', last_event_type: null,
    });
  });

  it('RevenueCat down -> 503 and no DB write', async () => {
    db.profiles[USER_A] = { id: USER_A, is_pro: true };
    rc.down = true;
    const res = await postSync();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ code: 'entitlement_sync_unavailable' });
    expect(db.writes).toEqual([]);
  });

  it('a user id in the body is ignored', async () => {
    db.profiles[USER_A] = { id: USER_A, is_pro: false };
    db.profiles[USER_B] = { id: USER_B, is_pro: false };
    rc.customers[USER_A] = { entitlements: [], subscriptions: [] };
    rc.customers[USER_B] = { entitlements: [proEntitlement(FUTURE)], subscriptions: [proSubscription()] };
    const res = await postSync({ body: { userId: USER_B, user_id: USER_B, app_user_id: USER_B } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ active: false, accessExpiresAt: null });
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes(USER_A))).toBe(true);
    expect(db.writes.some((write) => write.id === USER_B || write.row?.user_id === USER_B)).toBe(false);
  });
});
