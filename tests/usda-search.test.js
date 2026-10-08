import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetUpstash, seedWindow, upstash } from './_upstashFake.js';

vi.mock('@upstash/redis', async () => (await import('./_upstashFake.js')).redisModule);
vi.mock('@upstash/ratelimit', async () => (await import('./_upstashFake.js')).ratelimitModule);
vi.mock('../api/_sentry.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  reportMessage: vi.fn().mockResolvedValue(undefined),
}));

const supabase = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: supabase.getUser } }),
}));

const gate = vi.hoisted(() => ({ enforceEntitlement: vi.fn() }));
vi.mock('../api/_entitlementGate.js', () => ({ enforceEntitlement: gate.enforceEntitlement }));

const { reportError, reportMessage } = await import('../api/_sentry.js');
const { default: handler, resetReportThrottleForTests } = await import('../api/usda-search.js');

const KEY = 'test-usda-key-123';
const ORIGIN = 'https://www.endopamin.com';
const FOODS = [{ fdcId: 1, description: 'Egg', foodNutrients: [{ nutrientName: 'Protein', value: 13 }] }];

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

function fakeReq({ method = 'GET', query = { query: 'egg', pageSize: '25' }, token = 'good', headers = {} } = {}) {
  return {
    method,
    query,
    headers: {
      'x-forwarded-for': '203.0.113.7',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
}

async function call(req) {
  const res = fakeRes();
  await handler(req, res);
  return res;
}

function usdaResponse(body, { status = 200, remaining = '900' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: remaining === null ? {} : { 'X-RateLimit-Remaining': remaining } });
}

function upstreamParams() {
  return new URL(fetchMock.mock.calls[0][0]).searchParams;
}

function expectNoLeak(res, extra = []) {
  const text = JSON.stringify(res.body);
  [KEY, 'DEMO_KEY', ...extra].forEach((secret) => expect(text).not.toContain(secret));
}

let fetchMock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: new Date('2026-10-08T12:00:00Z') });
  resetUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.USDA_API_KEY = KEY;
  supabase.getUser.mockReset();
  supabase.getUser.mockImplementation(async (token) => (token === 'good'
    ? { data: { user: { id: 'u1' } }, error: null }
    : { data: { user: null }, error: { message: 'invalid' } }));
  gate.enforceEntitlement.mockReset();
  gate.enforceEntitlement.mockResolvedValue(false);
  reportError.mockReset();
  reportError.mockResolvedValue(undefined);
  resetReportThrottleForTests();
  reportMessage.mockReset();
  reportMessage.mockResolvedValue(undefined);
  fetchMock = vi.fn(async () => usdaResponse({ foods: FOODS, totalHits: 42 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.USDA_API_KEY;
  delete process.env.VITE_USDA_API_KEY;
});

describe('usda-search: method and input', () => {
  it('answers OPTIONS from an allowed origin with 204 and rejects POST with 405', async () => {
    const options = await call(fakeReq({ method: 'OPTIONS', headers: { origin: ORIGIN } }));
    expect(options.statusCode).toBe(204);
    expect(options.headers['access-control-allow-headers']).toBe('authorization, content-type');
    const post = await call(fakeReq({ method: 'POST' }));
    expect(post.statusCode).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['one character', { query: 'a' }],
    ['101 characters', { query: 'x'.repeat(101) }],
    ['an array', { query: ['egg', 'rice'] }],
  ])('rejects a query that is %s with 400 invalid_query', async (_label, query) => {
    const res = await call(fakeReq({ query }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid search query', code: 'invalid_query' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses pageSize 25 when absent and accepts "25" and q as the query alias', async () => {
    expect((await call(fakeReq({ query: { q: 'egg' } }))).statusCode).toBe(200);
    expect(upstreamParams().get('pageSize')).toBe('25');
    fetchMock.mockClear();
    expect((await call(fakeReq({ query: { query: ' egg ', pageSize: '25' } }))).statusCode).toBe(200);
    expect(upstreamParams().get('pageSize')).toBe('25');
    expect(upstreamParams().get('query')).toBe('egg');
  });

  it.each([['2.5'], ['0'], ['51'], ['-1'], [''], ['abc'], [['10', '20']]])(
    'rejects pageSize %j with 400 invalid_page_size',
    async (pageSize) => {
      const res = await call(fakeReq({ query: { query: 'egg', pageSize } }));
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid page size', code: 'invalid_page_size' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('usda-search: auth, rate limit and entitlement', () => {
  it('returns 401 without a token and with an invalid token', async () => {
    const missing = await call(fakeReq({ token: null }));
    expect(missing.statusCode).toBe(401);
    expect(missing.body).toEqual({ error: 'Missing access token' });
    const invalid = await call(fakeReq({ token: 'bad' }));
    expect(invalid.statusCode).toBe(401);
    expect(invalid.body).toEqual({ error: 'Invalid or expired token' });
    expect(gate.enforceEntitlement).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the IP limit, then the user limit, then the gate, before calling USDA', async () => {
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(200);
    expect(upstash.calls.map((c) => [c.prefix, c.identifier])).toEqual([
      ['rl:v2:ip:usda-search', '203.0.113.7'],
      ['rl:v2:user:usda-search', 'u1'],
    ]);
    expect(gate.enforceEntitlement).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ userId: 'u1', endpoint: 'usda-search', requestId: null }),
    );
  });

  it('returns the gate 402 and never calls USDA when the gate blocks', async () => {
    gate.enforceEntitlement.mockImplementation(async (_req, res) => {
      res.status(402).json({ error: 'Subscription required', code: 'subscription_required', requestId: null });
      return true;
    });
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(402);
    expect(res.body.code).toBe('subscription_required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 429 at the user minute limit, without the gate or USDA', async () => {
    seedWindow('rl:v2:user:usda-search', 'u1', 60000, 30);
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(429);
    expect(gate.enforceEntitlement).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open when the rate limiter is down', async () => {
    upstash.mode = 'throw';
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('usda-search: upstream', () => {
  it('returns 503 usda_not_configured without USDA_API_KEY and never falls back to another key', async () => {
    delete process.env.USDA_API_KEY;
    process.env.VITE_USDA_API_KEY = 'vite-key';
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Food search is temporarily unavailable.', code: 'usda_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expectNoLeak(res, ['vite-key']);
  });

  it('returns 504 usda_timeout when USDA does not answer within 5 seconds', async () => {
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    }));
    const pending = call(fakeReq());
    await vi.advanceTimersByTimeAsync(5000);
    const res = await pending;
    expect(res.statusCode).toBe(504);
    expect(res.body).toEqual({ error: 'Food search timed out. Please try again.', code: 'usda_timeout' });
    expectNoLeak(res, ['aborted']);
  });

  it.each([
    ['a network error', () => Promise.reject(new Error(`connect failed api_key=${KEY}`)), 'usda_unavailable'],
    ['an upstream 500', async () => usdaResponse({ error: { message: `bad key ${KEY}` } }, { status: 500 }), 'usda_upstream_error'],
    ['a body that is not JSON', async () => usdaResponse('<html>oops</html>'), 'usda_bad_response'],
    ['a body without foods', async () => usdaResponse({ totalHits: 3 }), 'usda_bad_response'],
  ])('returns 502 on %s, reports it and leaks nothing', async (_label, impl, code) => {
    fetchMock.mockImplementation(impl);
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'Food search is temporarily unavailable.', code });
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ route: 'usda-search', code }));
    expectNoLeak(res, ['connect failed', 'oops', 'bad key']);
  });

  it('reports the same failure code at most once per minute, with identical responses', async () => {
    fetchMock.mockImplementation(async () => usdaResponse({}, { status: 500 }));
    const first = await call(fakeReq());
    const second = await call(fakeReq());
    expect(reportError).toHaveBeenCalledTimes(1);
    [first, second].forEach((res) => {
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'Food search is temporarily unavailable.', code: 'usda_upstream_error' });
    });
  });

  it('returns the same 502 when reporting to Sentry fails', async () => {
    reportError.mockRejectedValue(new Error('sentry down'));
    fetchMock.mockImplementation(async () => usdaResponse({}, { status: 500 }));
    const res = await call(fakeReq());
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'Food search is temporarily unavailable.', code: 'usda_upstream_error' });
  });

  it('returns 200 with foods unchanged and totalHits, and sends the key only to USDA', async () => {
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ foods: FOODS, totalHits: 42 });
    expect(upstreamParams().get('api_key')).toBe(KEY);
    expectNoLeak(res);
  });

  it('returns totalHits null when USDA does not send a finite number', async () => {
    fetchMock.mockImplementation(async () => usdaResponse({ foods: FOODS, totalHits: '42' }));
    const res = await call(fakeReq());
    expect(res.body).toEqual({ foods: FOODS, totalHits: null });
  });
});

// Order matters: the quota warning is throttled per module instance for 10 minutes.
describe('usda-search: USDA quota warning', () => {
  it('does not warn on a header that is not a whole number', async () => {
    fetchMock.mockImplementation(async () => usdaResponse({ foods: FOODS }, { remaining: '12.5' }));
    await call(fakeReq());
    fetchMock.mockImplementation(async () => usdaResponse({ foods: FOODS }, { remaining: null }));
    await call(fakeReq());
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('warns once when fewer than 200 requests remain, and responds only after the warning is sent', async () => {
    let sent = false;
    reportMessage.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => { sent = true; resolve(); }, 1000);
    }));
    fetchMock.mockImplementation(async () => usdaResponse({ foods: FOODS, totalHits: 1 }, { remaining: '150' }));
    let responded = false;
    const pending = call(fakeReq()).then((res) => { responded = true; return res; });
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toBe(false);
    expect(responded).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const first = await pending;
    expect(sent).toBe(true);
    expect(first.statusCode).toBe(200);
    const second = await call(fakeReq());
    expect(second.statusCode).toBe(200);
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage).toHaveBeenCalledWith('USDA quota low', 'warning', { remaining: 150 });
  });

  it('returns the same response when the quota warning fails', async () => {
    vi.setSystemTime(new Date('2026-10-08T12:11:00Z'));
    reportMessage.mockRejectedValue(new Error('sentry down'));
    fetchMock.mockImplementation(async () => usdaResponse({ foods: FOODS, totalHits: 1 }, { remaining: '150' }));
    const res = await call(fakeReq());
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ foods: FOODS, totalHits: 1 });
  });
});
