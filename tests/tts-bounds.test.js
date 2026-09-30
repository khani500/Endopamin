import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsWithPrefix, resetUpstash } from './_upstashFake.js';
import { liveTtsRequests } from './_liveMobileRequests.js';

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

const { default: handler, validateTtsRequest } = await import('../api/tts.js');

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

async function call(body) {
  const res = fakeRes();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer good', 'x-forwarded-for': '203.0.113.7' },
    body,
  }, res);
  return res;
}

function googleRequest() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

let fetchMock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-29T12:00:00Z') });
  resetUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.GOOGLE_TTS_API_KEY = 'test-tts-key';
  supabase.getUser.mockReset();
  supabase.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
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

describe('live Mobile requests pass unchanged', () => {
  for (const [name, request] of Object.entries(liveTtsRequests())) {
    it(name, async () => {
      const res = await call({ ...request });
      expect(res.statusCode).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const sent = googleRequest();
      expect(sent.input).toEqual({ text: request.text });
      expect(sent.voice).toEqual({ languageCode: 'en-US', name: request.voiceName });
      expect(callsWithPrefix('q:v1:')).toHaveLength(1);
    });
  }
});

describe('voiceName', () => {
  it('defaults to en-US-Neural2-F when missing or empty', () => {
    expect(validateTtsRequest({ text: 'hi' }).voiceName).toBe('en-US-Neural2-F');
    expect(validateTtsRequest({ text: 'hi', voiceName: '' }).voiceName).toBe('en-US-Neural2-F');
    expect(validateTtsRequest({ text: 'hi', voiceName: null }).voiceName).toBe('en-US-Neural2-F');
  });

  it('accepts the current and older-build Neural2 voices', () => {
    for (const letter of ['C', 'D', 'E', 'F', 'G', 'J']) {
      const voiceName = `en-US-Neural2-${letter}`;
      expect(validateTtsRequest({ text: 'hi', voiceName })).toEqual({ ok: true, text: 'hi', voiceName });
    }
  });

  it('rejects any other voice', () => {
    for (const voiceName of ['en-US-Neural2-A', 'en-US-Studio-O', 'en-US-Chirp3-HD-Aoede', 'en-GB-Neural2-F', 42, ['en-US-Neural2-F']]) {
      expect(validateTtsRequest({ text: 'hi', voiceName })).toEqual({ ok: false, error: 'Unsupported voice' });
    }
  });
});

describe('text length', () => {
  it('rejects empty text', () => {
    expect(validateTtsRequest({ text: '  ' })).toEqual({ ok: false, error: 'text is required' });
    expect(validateTtsRequest({})).toEqual({ ok: false, error: 'text is required' });
  });

  it('accepts 5000 ASCII characters, rejects 5001', () => {
    expect(validateTtsRequest({ text: 'a'.repeat(5000) }).ok).toBe(true);
    expect(validateTtsRequest({ text: 'a'.repeat(5001) }))
      .toEqual({ ok: false, error: 'text exceeds 5000 character limit' });
  });

  it('rejects text under 5000 characters that is over 5000 UTF-8 bytes', () => {
    // An em dash is 1 character and 3 bytes.
    expect(validateTtsRequest({ text: '—'.repeat(1666) }).ok).toBe(true);
    expect(validateTtsRequest({ text: '—'.repeat(1667) }))
      .toEqual({ ok: false, error: 'text exceeds 5000 byte limit' });
    // An emoji is 2 UTF-16 characters and 4 bytes.
    expect(validateTtsRequest({ text: '💪'.repeat(1251) }))
      .toEqual({ ok: false, error: 'text exceeds 5000 byte limit' });
  });

  it('trims before measuring', () => {
    expect(validateTtsRequest({ text: `  ${'a'.repeat(5000)}  ` }).ok).toBe(true);
  });
});

describe('handler: rejected requests cost no daily unit and never reach Google', () => {
  const rejected = {
    'unknown voice': { text: 'hi', voiceName: 'en-US-Studio-O' },
    'too many bytes': { text: '—'.repeat(2000), voiceName: 'en-US-Neural2-F' },
    'too many characters': { text: 'a'.repeat(5001), voiceName: 'en-US-Neural2-D' },
  };

  for (const [name, body] of Object.entries(rejected)) {
    it(name, async () => {
      const res = await call(body);
      expect(res.statusCode).toBe(400);
      expect(callsWithPrefix('q:v1:')).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('a missing voice is sent to Google as en-US-Neural2-F', async () => {
    const res = await call({ text: 'hi' });
    expect(res.statusCode).toBe(200);
    expect(googleRequest().voice.name).toBe('en-US-Neural2-F');
  });
});
