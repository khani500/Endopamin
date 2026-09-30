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

const { default: handler } = await import('../api/tts.js');

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
  };
}

function fakeReq({ token = 'good', body = { text: 'Nice work.', voiceName: 'en-US-Neural2-F' } } = {}) {
  return {
    method: 'POST',
    headers: {
      'x-forwarded-for': IP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  };
}

async function call(req) {
  const res = fakeRes();
  await handler(req, res);
  return res;
}

let fetchMock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-29T12:00:00Z') });
  resetUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.GOOGLE_TTS_API_KEY = 'test-tts-key';
  supabase.getUser.mockReset();
  supabase.getUser.mockImplementation(async (token) => (token === 'good'
    ? { data: { user: { id: 'u1' } }, error: null }
    : { data: { user: null }, error: { message: 'invalid' } }));
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ audioContent: 'AAAA' }), { status: 200 }));
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
  delete process.env.GOOGLE_TTS_API_KEY;
});

describe('tts: order of checks', () => {
  it('a successful request passes IP, user and daily limits once each, then calls Google once', async () => {
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ audioContent: 'AAAA' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstash.calls.map((c) => c.prefix)).toEqual([
      'rl:v2:ip:tts',
      'rl:v2:user:tts',
      'q:v1:tts:all',
    ]);
  });

  it('the IP abuse limit runs before auth', async () => {
    seedWindow('rl:v2:ip:tts', IP, 60000, 150);
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(429);
    expect(supabase.getUser).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('tts: auth failures consume no user quota', () => {
  for (const token of [null, 'bad']) {
    it(`token ${token === null ? 'missing' : 'invalid'}`, async () => {
      const res = await call(fakeReq({ token }));
      expect(res.statusCode).toBe(401);
      expect(callsWithPrefix('rl:v2:user:')).toHaveLength(0);
      expect(callsWithPrefix('q:v1:')).toHaveLength(0);
    });
  }
});

describe('tts: validation failures consume no daily unit', () => {
  it('empty text', async () => {
    const res = await call(fakeReq({ body: { text: '   ' } }));
    expect(res.statusCode).toBe(400);
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
  });

  it('text over 5000 characters', async () => {
    const res = await call(fakeReq({ body: { text: 'a'.repeat(5001) } }));
    expect(res.statusCode).toBe(400);
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('server key missing', async () => {
    const keyNames = ['VITE_GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_API_KEY', 'VITE_GEMINI_API_KEY', 'GEMINI_API_KEY'];
    const saved = Object.fromEntries(keyNames.map((name) => [name, process.env[name]]));
    keyNames.forEach((name) => delete process.env[name]);
    try {
      const res = await call(fakeReq());
      expect(res.statusCode).toBe(500);
      expect(callsWithPrefix('q:v1:')).toHaveLength(0);
    } finally {
      keyNames.forEach((name) => {
        if (saved[name] !== undefined) process.env[name] = saved[name];
      });
    }
  });
});

describe('tts: per-user minute limit', () => {
  it('allows 30 per minute, then 429 without calling Google', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await call(fakeReq())).statusCode).toBe(200);
    }
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });
});

describe('tts: daily quota', () => {
  it('returns 429 with Retry-After until 00:00 UTC once 500 units are used', async () => {
    seedWindow('q:v1:tts:all', 'u1', DAY_MS, 500);
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('daily_limit_reached');
    expect(res.headers['retry-after']).toBe(String(12 * 60 * 60));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes one unit when Google fails', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 500 }));
    const res = await call(fakeReq());
    expect(res.statusCode).toBe(500);
    expect(callsWithPrefix('q:v1:')).toHaveLength(1);
  });
});

describe('tts: limiter unavailable fails closed', () => {
  for (const mode of ['throw', 'timeout']) {
    it(`${mode}: 503 with Retry-After and Google is never called`, async () => {
      upstash.mode = mode;
      const res = await call(fakeReq());
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      expect(res.body.code).toBe('temporarily_unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});
