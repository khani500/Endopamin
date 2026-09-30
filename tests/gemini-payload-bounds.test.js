import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsWithPrefix, resetUpstash } from './_upstashFake.js';
import { liveGeminiRequests } from './_liveMobileRequests.js';

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

const { default: handler, validateGeminiPayload } = await import('../api/gemini.js');

// A real writable stream, so the SSE path (Readable.fromWeb(...).pipe(res)) works too.
function fakeRes() {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return Object.assign(res, {
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
  });
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

function withoutRoute(body) {
  const { model: _model, action: _action, alt: _alt, ...rest } = body;
  return rest;
}

function textBody(overrides = {}) {
  return {
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    generationConfig: { maxOutputTokens: 1024 },
    ...overrides,
  };
}

function imagePart(bytes = 1000, mimeType = 'image/jpeg') {
  return { inlineData: { mimeType, data: 'A'.repeat(bytes) } };
}

let fetchMock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-29T12:00:00Z') });
  resetUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  supabase.getUser.mockReset();
  supabase.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
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

describe('live Mobile requests pass unchanged', () => {
  for (const [name, request] of Object.entries(liveGeminiRequests())) {
    it(`${name}: validator returns the same body`, () => {
      const result = validateGeminiPayload(withoutRoute(request));
      expect(result.ok).toBe(true);
      expect(result.body).toEqual(withoutRoute(request));
    });

    it(`${name}: handler forwards the same body to Google and takes one daily unit`, async () => {
      const res = await call(structuredClone(request));
      expect(res.statusCode).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual(withoutRoute(request));
      expect(url).toContain(`:${request.action ?? 'generateContent'}?`);
      expect(callsWithPrefix('q:v1:')).toHaveLength(1);
    });
  }
});

describe('top-level fields', () => {
  for (const field of ['tools', 'toolConfig', 'cachedContent', 'safetySettings']) {
    it(`rejects ${field}`, () => {
      const result = validateGeminiPayload(textBody({ [field]: [] }));
      expect(result).toEqual({ ok: false, status: 400, error: 'Unsupported request field' });
    });
  }

  it('accepts systemInstruction and system_instruction', () => {
    const parts = { parts: [{ text: 'rules' }] };
    expect(validateGeminiPayload(textBody({ systemInstruction: parts })).ok).toBe(true);
    expect(validateGeminiPayload(textBody({ system_instruction: parts })).ok).toBe(true);
  });

  it('requires a non-empty contents array', () => {
    expect(validateGeminiPayload({ contents: [] }).status).toBe(400);
    expect(validateGeminiPayload({ contents: 'hi' }).status).toBe(400);
    expect(validateGeminiPayload({}).status).toBe(400);
  });

  it('rejects a generationConfig that is not an object', () => {
    expect(validateGeminiPayload(textBody({ generationConfig: 'fast' })).status).toBe(400);
  });
});

describe('candidateCount', () => {
  it('allows absent or 1, rejects anything else', () => {
    expect(validateGeminiPayload(textBody()).ok).toBe(true);
    expect(validateGeminiPayload(textBody({ generationConfig: { candidateCount: 1 } })).ok).toBe(true);
    for (const count of [2, 8, 0, '1']) {
      const result = validateGeminiPayload(textBody({ generationConfig: { candidateCount: count } }));
      expect(result).toEqual({ ok: false, status: 400, error: 'Unsupported candidateCount' });
    }
  });
});

describe('maxOutputTokens', () => {
  const tokensFor = (generationConfig) => validateGeminiPayload(textBody({ generationConfig })).body
    .generationConfig.maxOutputTokens;

  it('is set to 8192 when absent', () => {
    expect(tokensFor(undefined)).toBe(8192);
    expect(tokensFor({ temperature: 0.5 })).toBe(8192);
  });

  it('is clamped to 8192', () => {
    expect(tokensFor({ maxOutputTokens: 65536 })).toBe(8192);
    expect(tokensFor({ maxOutputTokens: 8192 })).toBe(8192);
  });

  it('keeps valid values', () => {
    expect(tokensFor({ maxOutputTokens: 4096 })).toBe(4096);
    expect(tokensFor({ maxOutputTokens: 1 })).toBe(1);
  });

  it('replaces invalid values with 8192', () => {
    for (const value of [0, -5, 1.5, '4096', null, Number.POSITIVE_INFINITY]) {
      expect(tokensFor({ maxOutputTokens: value })).toBe(8192);
    }
  });
});

describe('thinkingBudget', () => {
  const thinkingFor = (thinkingConfig) => validateGeminiPayload(
    textBody({ generationConfig: { maxOutputTokens: 1024, thinkingConfig } }),
  );

  it('stays absent when the client does not send it', () => {
    const result = validateGeminiPayload(textBody());
    expect(result.body.generationConfig).not.toHaveProperty('thinkingConfig');
    expect(thinkingFor({ includeThoughts: false }).body.generationConfig.thinkingConfig)
      .toEqual({ includeThoughts: false });
  });

  it('keeps 0 and values up to 1024', () => {
    expect(thinkingFor({ thinkingBudget: 0 }).body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
    expect(thinkingFor({ thinkingBudget: 512 }).body.generationConfig.thinkingConfig.thinkingBudget).toBe(512);
    expect(thinkingFor({ thinkingBudget: 1024 }).body.generationConfig.thinkingConfig.thinkingBudget).toBe(1024);
  });

  it('clamps to 0..1024', () => {
    expect(thinkingFor({ thinkingBudget: 24576 }).body.generationConfig.thinkingConfig.thinkingBudget).toBe(1024);
    expect(thinkingFor({ thinkingBudget: -1 }).body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it('rejects non-numeric budgets and a non-object thinkingConfig', () => {
    expect(thinkingFor({ thinkingBudget: '0' }).status).toBe(400);
    expect(thinkingFor({ thinkingBudget: Number.NaN }).status).toBe(400);
    expect(thinkingFor('off').status).toBe(400);
  });
});

describe('inline parts', () => {
  it('allows one image or one audio clip, in either spelling', () => {
    expect(validateGeminiPayload(textBody({ contents: [{ parts: [imagePart(), { text: 'what is this' }] }] })).ok)
      .toBe(true);
    expect(validateGeminiPayload(textBody({
      contents: [{ parts: [{ inline_data: { mime_type: 'audio/mp4', data: 'B' } }] }],
    })).ok).toBe(true);
  });

  it('rejects more than one inline part, across all contents and the system instruction', () => {
    const twoInOne = textBody({ contents: [{ parts: [imagePart(), imagePart()] }] });
    const acrossTurns = textBody({ contents: [{ parts: [imagePart()] }, { parts: [imagePart()] }] });
    const inSystem = textBody({
      contents: [{ parts: [imagePart()] }],
      systemInstruction: { parts: [imagePart()] },
    });
    for (const body of [twoInOne, acrossTurns, inSystem]) {
      expect(validateGeminiPayload(body)).toEqual({
        ok: false, status: 400, error: 'Only one image or audio clip per request',
      });
    }
  });

  it('rejects other attachment types', () => {
    for (const mimeType of ['application/pdf', 'video/mp4', '', undefined]) {
      const part = { inlineData: { mimeType, data: 'A' } };
      const result = validateGeminiPayload(textBody({ contents: [{ parts: [part] }] }));
      expect(result).toEqual({ ok: false, status: 400, error: 'Unsupported attachment type' });
    }
  });
});

describe('size caps', () => {
  it('text-only: accepts just under 1,000,000 bytes, rejects over', () => {
    const under = textBody({ contents: [{ parts: [{ text: 'a'.repeat(999_000) }] }] });
    const over = textBody({ contents: [{ parts: [{ text: 'a'.repeat(1_000_000) }] }] });
    expect(validateGeminiPayload(under).ok).toBe(true);
    expect(validateGeminiPayload(over)).toMatchObject({ ok: false, status: 413, maxBytes: 1_000_000 });
  });

  it('text-only cap counts UTF-8 bytes, not characters', () => {
    const body = textBody({ contents: [{ parts: [{ text: '—'.repeat(340_000) }] }] });
    expect(validateGeminiPayload(body)).toMatchObject({ ok: false, status: 413 });
  });

  it('with an inline part: accepts just under 4,500,000 bytes, rejects over', () => {
    const under = textBody({ contents: [{ parts: [imagePart(4_499_000)] }] });
    const over = textBody({ contents: [{ parts: [imagePart(4_500_000)] }] });
    expect(validateGeminiPayload(under).ok).toBe(true);
    expect(validateGeminiPayload(over)).toMatchObject({ ok: false, status: 413, maxBytes: 4_500_000 });
  });
});

describe('validator does not mutate the input', () => {
  it('leaves the client body untouched', () => {
    const body = textBody({ generationConfig: { maxOutputTokens: 99999, thinkingConfig: { thinkingBudget: 9999 } } });
    const copy = structuredClone(body);
    validateGeminiPayload(body);
    expect(body).toEqual(copy);
  });
});

describe('handler: rejected payloads cost no daily unit and never reach Google', () => {
  const rejected = {
    'unknown field': { model: 'gemini-2.5-flash', ...textBody({ tools: [{ googleSearch: {} }] }) },
    candidateCount: { ...textBody({ generationConfig: { candidateCount: 4 } }) },
    'two images': { ...textBody({ contents: [{ parts: [imagePart(), imagePart()] }] }) },
    'text too large': { ...textBody({ contents: [{ parts: [{ text: 'a'.repeat(1_000_001) }] }] }) },
    'image too large': { ...textBody({ contents: [{ parts: [imagePart(4_600_000)] }] }) },
  };

  for (const [name, body] of Object.entries(rejected)) {
    it(name, async () => {
      const res = await call(body);
      expect([400, 413]).toContain(res.statusCode);
      expect(res.body.error).toEqual(expect.any(String));
      expect(callsWithPrefix('q:v1:')).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('an absent maxOutputTokens is sent to Google as 8192', async () => {
    const res = await call({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig).toEqual({ maxOutputTokens: 8192 });
  });
});
