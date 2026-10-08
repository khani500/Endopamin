import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsWithPrefix, resetUpstash } from './_upstashFake.js';

vi.mock('@upstash/redis', async () => (await import('./_upstashFake.js')).redisModule);
vi.mock('@upstash/ratelimit', async () => (await import('./_upstashFake.js')).ratelimitModule);
vi.mock('../api/_sentry.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  reportMessage: vi.fn().mockResolvedValue(undefined),
}));

// In-memory Supabase admin: the user's entitlement row, the profile
// replace-plans reads, and a record of every RPC call.
const db = vi.hoisted(() => ({ entitlementRow: null, entitlementError: null, rpc: [] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from(table) {
      return {
        select: () => {
          // Chainable: replace-plans looks up a saved attempt with two filters.
          const query = {
            eq: () => query,
            maybeSingle: async () => {
              if (table === 'user_entitlements') {
                return { data: db.entitlementRow, error: db.entitlementError };
              }
              if (table === 'workout_plans') return { data: null, error: null };
              return { data: { gender: 'female', age: 28, days_per_week: 6 }, error: null };
            },
          };
          return query;
        },
      };
    },
    async rpc(name, args) {
      db.rpc.push({ name, args });
      return { data: { workout_plan_id: 'wp-1', nutrition_plan_id: null, replayed: false }, error: null };
    },
  }),
}));

const { reportError } = await import('../api/_sentry.js');
const { NEGATIVE_RECHECK_TTL_MS, resetReportThrottleForTests } = await import('../api/_entitlementGate.js');
const { default: gemini } = await import('../api/gemini.js');
const { default: tts } = await import('../api/tts.js');
const { default: replacePlans } = await import('../api/replace-plans.js');

const NOW = new Date('2026-10-02T12:00:00Z');
const DAY_MS = 86400000;
const iso = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

const EFFECTIVE_ROW = { active: true, access_expires_at: iso(30 * DAY_MS), last_synced_at: iso(-60000) };
const RECENT_INACTIVE_ROW = {
  active: false, access_expires_at: null, last_synced_at: iso(-(NEGATIVE_RECHECK_TTL_MS - 60000)),
};

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-token',
  GEMINI_API_KEY: 'test-gemini-key',
};

function planDays() {
  return Array.from({ length: 7 }, (_, index) => ({
    day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index],
    type: index === 6 ? 'rest' : 'training',
    focus: index === 6 ? 'Recovery' : 'Strength',
    exercises: index === 6 ? [] : [{
      name: 'Squat', sets: '3', reps: 10, rest: '60s',
    }],
  }));
}

function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    headersSent: false,
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
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

let fetchMock;
let warn;

// reached(): the request got past the gate to the paid work (Google or the RPC).
const endpoints = [
  {
    name: 'gemini',
    handler: gemini,
    body: () => ({
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    }),
    upstream: () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    reached: () => fetchMock.mock.calls.length === 1,
    notReached: () => fetchMock.mock.calls.length === 0,
    dailyQuota: true,
    requestId: () => null,
  },
  {
    name: 'tts',
    handler: tts,
    body: () => ({ text: 'Nice work today.' }),
    upstream: () => new Response(JSON.stringify({ audioContent: 'AAAA' }), { status: 200 }),
    reached: () => fetchMock.mock.calls.length === 1,
    notReached: () => fetchMock.mock.calls.length === 0,
    dailyQuota: true,
    requestId: () => null,
  },
  {
    name: 'replace-plans',
    handler: replacePlans,
    body: () => ({
      clientAttemptId: '11111111-1111-4111-8111-111111111111',
      operation: 'initial_setup',
      expectedSafetyFingerprint: `v1:${'a'.repeat(64)}`,
      coachId: 'aria',
      planType: 'weekly',
      weekStart: NOW.toISOString().slice(0, 10),
      weekNumber: 1,
      activateOn: null,
      workoutPlan: { days: planDays() },
    }),
    upstream: () => new Response('{}', { status: 200 }),
    reached: () => db.rpc.length === 1 && db.rpc[0].name === 'replace_user_plans_atomic',
    notReached: () => db.rpc.length === 0,
    dailyQuota: false,
    requestId: () => expect.any(String),
  },
];

function gateLogs(event) {
  return warn.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry?.event === event);
}

async function call(endpoint) {
  fetchMock.mockImplementation(async () => endpoint.upstream());
  const res = fakeRes();
  await endpoint.handler({
    method: 'POST',
    headers: {
      'x-forwarded-for': '203.0.113.7',
      authorization: 'Bearer good',
      'content-length': '128',
    },
    body: endpoint.body(),
  }, res);
  return res;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  resetUpstash();
  resetReportThrottleForTests();
  Object.assign(process.env, ENV);
  delete process.env.ENTITLEMENT_ENFORCEMENT;
  db.entitlementRow = null;
  db.entitlementError = null;
  db.rpc = [];
  reportError.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.keys(ENV).forEach((name) => delete process.env[name]);
  delete process.env.ENTITLEMENT_ENFORCEMENT;
});

describe.each(endpoints)('$name entitlement gate', (endpoint) => {
  it('OFF + no row -> proceeds as before, one would_block log', async () => {
    const res = await call(endpoint);
    expect(res.statusCode).toBe(200);
    expect(endpoint.reached()).toBe(true);
    const logs = gateLogs('entitlement.would_block');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      endpoint: endpoint.name, userId: 'u1', rowState: 'missing', clientHeaders: 'missing',
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('ON + inactive row synced within the TTL -> 402, nothing paid is reached', async () => {
    process.env.ENTITLEMENT_ENFORCEMENT = 'on';
    db.entitlementRow = RECENT_INACTIVE_ROW;
    const res = await call(endpoint);
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({
      error: 'Subscription required',
      code: 'subscription_required',
      requestId: endpoint.requestId(),
    });
    expect(endpoint.notReached()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.rpc).toEqual([]);
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
    // The per-user minute limit ran before the gate.
    expect(callsWithPrefix('rl:v2:user:')).toHaveLength(1);
  });

  it('ON + effective row -> proceeds', async () => {
    process.env.ENTITLEMENT_ENFORCEMENT = 'on';
    db.entitlementRow = EFFECTIVE_ROW;
    const res = await call(endpoint);
    expect(res.statusCode).toBe(200);
    expect(endpoint.reached()).toBe(true);
    expect(callsWithPrefix('q:v1:')).toHaveLength(endpoint.dailyQuota ? 1 : 0);
    expect(gateLogs('entitlement.would_block')).toEqual([]);
    expect(gateLogs('entitlement.blocked')).toEqual([]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('ON + row read error -> proceeds and is reported (fail open)', async () => {
    process.env.ENTITLEMENT_ENFORCEMENT = 'on';
    db.entitlementError = { message: 'boom' };
    const res = await call(endpoint);
    expect(res.statusCode).toBe(200);
    expect(endpoint.reached()).toBe(true);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'entitlement_gate_row_read_failed' }),
      expect.objectContaining({ area: 'entitlement-gate', endpoint: endpoint.name, userId: 'u1' }),
    );
  });
});
