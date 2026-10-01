import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION_HEADER, BUILD_HEADER, PLATFORM_HEADER } from '../api/_appVersion.js';

vi.mock('@upstash/redis', async () => (await import('./_upstashFake.js')).redisModule);
vi.mock('@upstash/ratelimit', async () => (await import('./_upstashFake.js')).ratelimitModule);
vi.mock('../api/_sentry.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  reportMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    throw new Error('Supabase must not be reached in these tests');
  },
}));

// Only site/app-config.json is intercepted, and only when a test sets an override.
// With no override the handlers read the committed file.
const appConfig = vi.hoisted(() => ({ override: null }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const readFileSync = (path, ...rest) => {
    if (appConfig.override !== null && String(path).endsWith('/site/app-config.json')) {
      return JSON.stringify(appConfig.override);
    }
    return actual.readFileSync(path, ...rest);
  };
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

const storeUrls = {
  ios: 'https://apps.apple.com/app/id6784407758',
  android: 'https://play.google.com/store/apps/details?id=com.endopamin.app',
};

function minVersionConfig({ enforce, rejectMissing }) {
  return {
    minVersion: {
      enforce,
      rejectMissing,
      ios: { version: '1.0.3', build: null },
      android: { versionCode: 20 },
    },
    storeUrls,
  };
}

const belowMinimum = {
  [PLATFORM_HEADER]: 'android',
  [APP_VERSION_HEADER]: '1.0.2',
  [BUILD_HEADER]: '19',
};

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

// Each request is shaped to stop at the handler's first check that needs no
// network, Redis or Supabase: a wrong method (405) or, for usda-search, a
// one-letter query (400). Reaching that check proves the guard let it through.
const guardedHandlers = [
  { name: 'entitlement-sync', method: 'GET', query: {}, passStatus: 405 },
  { name: 'gemini', method: 'GET', query: {}, passStatus: 405 },
  { name: 'replace-plans', method: 'GET', query: {}, passStatus: 405 },
  { name: 'save-profile', method: 'GET', query: {}, passStatus: 405 },
  { name: 'tts', method: 'GET', query: {}, passStatus: 405 },
  { name: 'usda-search', method: 'GET', query: { query: 'a' }, passStatus: 400 },
];

// A fresh module graph per call, so the guard reads the config set by the test.
async function call(name, { method, query = {}, headers = {} }) {
  vi.resetModules();
  const { default: handler } = await import(`../api/${name}.js`);
  const res = fakeRes();
  await handler({ method, query, headers, body: {} }, res);
  return res;
}

beforeEach(() => {
  appConfig.override = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  appConfig.override = null;
  vi.restoreAllMocks();
});

describe.each(guardedHandlers)('$name minimum version guard', ({ name, method, query, passStatus }) => {
  it('with the committed config and no headers, behaves as before', async () => {
    const res = await call(name, { method, query });
    expect(res.statusCode).toBe(passStatus);
    expect(res.body?.code).toBeUndefined();
  });

  it('returns 426 when the app is below the minimum and enforcement is on', async () => {
    appConfig.override = minVersionConfig({ enforce: true, rejectMissing: false });
    const res = await call(name, { method, query, headers: belowMinimum });
    expect(res.statusCode).toBe(426);
    expect(res.body).toEqual({
      error: 'Update required',
      code: 'APP_UPDATE_REQUIRED',
      storeUrl: storeUrls.android,
    });
  });

  it('returns 426 for a request with no headers once rejectMissing is on', async () => {
    appConfig.override = minVersionConfig({ enforce: true, rejectMissing: true });
    const res = await call(name, { method, query });
    expect(res.statusCode).toBe(426);
    expect(res.body).toEqual({ error: 'Update required', code: 'APP_UPDATE_REQUIRED', storeUrl: null });
  });
});

describe('delete-account is never gated by app version', () => {
  it.each([
    ['below the minimum', belowMinimum],
    ['with no headers', {}],
  ])('does not return 426 %s, even with enforce and rejectMissing on', async (_label, headers) => {
    appConfig.override = minVersionConfig({ enforce: true, rejectMissing: true });
    const res = await call('delete-account', { method: 'GET', headers });
    expect(res.statusCode).toBe(405);
  });
});
