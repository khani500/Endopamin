import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callsWithPrefix,
  resetUpstash,
  seedWindow,
  upstash,
} from './_upstashFake.js';

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

const { default: handler } = await import('../api/gemini.js');

const DAY_MS = 86400000;
const IP = '203.0.113.7';

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
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function geminiBody(overrides = {}) {
  return {
    model: 'gemini-2.5-flash',
    action: 'generateContent',
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    ...overrides,
  };
}

function fakeReq({ token = 'good', body = geminiBody(), headers = {} } = {}) {
  return {
    method: 'POST',
    headers: {
      'x-forwarded-for': IP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body,
  };
}

async function call(req) {
  const res = fakeRes();
  await handler(req, res);
  return res;
}

const okResponse = () => new Response(JSON.stringify({ candidates: [] }), { status: 200 });
const busyResponse = () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 });

let fetchMock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'], now: new Date('2026-09-29T12:00:00Z') });
  resetUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  supabase.getUser.mockReset();
  supabase.getUser.mockImplementation(async (token) => (token === 'good'
    ? { data: { user: { id: 'u1' } }, error: null }
    : { data: { user: null }, error: { message: 'invalid' } }));
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.GEMINI_API_KEY;
});

describe('gemini: order of checks', () => {
  it('a successful request passes IP, user and daily limits once each, then calls Google once', async () => {
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstash.calls.map((c) => c.prefix)).toEqual([
      'rl:v2:ip:gemini',
      'rl:v2:user:gemini',
      'q:v1:gemini:all',
    ]);
    expect(callsWithPrefix('rl:v2:user:')[0].identifier).toBe('u1');
    expect(callsWithPrefix('q:v1:')[0].identifier).toBe('u1');
  });

  it('the IP abuse limit runs before auth', async () => {
    seedWindow('rl:v2:ip:gemini', IP, 60000, 100);
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('rate_limited');
    expect(supabase.getUser).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('gemini: auth failures consume no user quota', () => {
  it('missing token', async () => {
    const res = await call(fakeReq({ token: null }));
    expect(res.statusCode).toBe(401);
    expect(callsWithPrefix('rl:v2:user:')).toHaveLength(0);
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
  });

  it('invalid token', async () => {
    const res = await call(fakeReq({ token: 'bad' }));
    expect(res.statusCode).toBe(401);
    expect(callsWithPrefix('rl:v2:user:')).toHaveLength(0);
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
  });
});

describe('gemini: validation failures consume no daily unit', () => {
  it('unsupported model', async () => {
    const res = await call(fakeReq({ body: geminiBody({ model: 'gemini-2.5-pro' }) }));
    expect(res.statusCode).toBe(400);
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('body too large by content-length', async () => {
    const res = await call(fakeReq({ headers: { 'content-length': String(11 * 1024 * 1024) } }));
    expect(res.statusCode).toBe(413);
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
  });

  it('server key missing', async () => {
    const saved = process.env.VITE_GEMINI_API_KEY;
    delete process.env.VITE_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = await call(fakeReq());
      expect(res.statusCode).toBe(500);
      expect(callsWithPrefix('q:v1:')).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.VITE_GEMINI_API_KEY = saved;
    }
  });
});

describe('gemini: per-user minute limit', () => {
  it('allows 20 per minute, then 429 without calling Google', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await call(fakeReq())).statusCode).toBe(200);
    }
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(callsWithPrefix('q:v1:')).toHaveLength(20);
  });
});

describe('gemini: daily quota', () => {
  it('returns 429 with Retry-After until 00:00 UTC once 300 units are used', async () => {
    seedWindow('q:v1:gemini:all', 'u1', DAY_MS, 300);
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('daily_limit_reached');
    expect(res.body.message).toBe(res.body.error);
    expect(res.headers['retry-after']).toBe(String(12 * 60 * 60));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes one unit per request even when Google returns 503 three times', async () => {
    fetchMock.mockImplementation(async () => busyResponse());
    const pending = call(fakeReq());
    await vi.advanceTimersByTimeAsync(10000);
    const res = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(503);
    expect(callsWithPrefix('q:v1:')).toHaveLength(1);
  });
});

describe('gemini: limiter unavailable fails closed', () => {
  for (const mode of ['throw', 'timeout']) {
    it(`${mode}: 503 with Retry-After and Google is never called`, async () => {
      upstash.mode = mode;
      const res = await call(fakeReq());
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      expect(res.body).toEqual({
        error: 'This feature is temporarily unavailable. Please try again in a moment.',
        message: 'This feature is temporarily unavailable. Please try again in a moment.',
        code: 'temporarily_unavailable',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});

describe('gemini: streaming requests are limited the same way', () => {
  const sseBody = () => geminiBody({ action: 'streamGenerateContent', alt: 'sse' });

  it('daily limit returns a JSON 429, not a stream', async () => {
    seedWindow('q:v1:gemini:all', 'u1', DAY_MS, 300);
    const res = await call(fakeReq({ body: sseBody() }));
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('daily_limit_reached');
    expect(res.headers['content-type']).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('outage returns a JSON 503, not a stream', async () => {
    upstash.mode = 'throw';
    const res = await call(fakeReq({ body: sseBody() }));
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
