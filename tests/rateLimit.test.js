import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for Upstash. Windows are bucketed on Date.now(), like Upstash fixedWindow.
const upstash = vi.hoisted(() => ({
  mode: 'normal', // 'normal' | 'throw' | 'timeout'
  counts: new Map(),
  limiterConfigs: [],
  redisConfigs: [],
  calls: [],
}));

const sentry = vi.hoisted(() => ({ reportMessage: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(config) {
      upstash.redisConfigs.push(config);
    }
  },
}));

vi.mock('@upstash/ratelimit', () => {
  const toMs = (window) => {
    const [n, unit] = window.split(' ');
    return Number(n) * ({ s: 1000, d: 86400000 })[unit];
  };
  class Ratelimit {
    constructor(config) {
      this.config = config;
      upstash.limiterConfigs.push(config);
    }

    static slidingWindow(max, window) {
      return { kind: 'sliding', max, windowMs: toMs(window) };
    }

    static fixedWindow(max, window) {
      return { kind: 'fixed', max, windowMs: toMs(window) };
    }

    async limit(identifier, opts) {
      upstash.calls.push({ prefix: this.config.prefix, identifier, opts });
      if (upstash.mode === 'throw') throw new Error('connect ECONNREFUSED');
      if (upstash.mode === 'timeout') {
        return { success: true, limit: 0, remaining: 0, reset: 0, reason: 'timeout' };
      }
      const { max, windowMs } = this.config.limiter;
      const bucket = Math.floor(Date.now() / windowMs);
      const key = `${this.config.prefix}:${identifier}:${bucket}`;
      const used = (upstash.counts.get(key) || 0) + (opts?.rate ?? 1);
      upstash.counts.set(key, used);
      return {
        success: used <= max,
        limit: max,
        remaining: Math.max(0, max - used),
        reset: (bucket + 1) * windowMs,
      };
    }
  }
  return { Ratelimit };
});

vi.mock('../api/_sentry.js', () => ({ reportMessage: sentry.reportMessage }));

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

function fakeReq(ip = '203.0.113.7') {
  return { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } };
}

let limiter;
let warn;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-29T12:00:00Z') });
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  upstash.mode = 'normal';
  upstash.counts.clear();
  upstash.limiterConfigs.length = 0;
  upstash.redisConfigs.length = 0;
  upstash.calls.length = 0;
  sentry.reportMessage.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.resetModules();
  limiter = await import('../api/_rateLimit.js');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

function loggedEvents() {
  return warn.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe('client configuration', () => {
  it('limits Redis retries and sets a short limiter timeout', async () => {
    await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'gemini', userId: 'u1', paid: true });
    expect(upstash.redisConfigs[0].retry).toEqual({ retries: 1 });
    expect(upstash.limiterConfigs[0].timeout).toBe(1500);
  });
});

describe('per-user minute limit', () => {
  it('allows the configured number per minute, then returns 429 with Retry-After', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'gemini', userId: 'u1', paid: true })).toBe(true);
    }
    const res = fakeRes();
    expect(await limiter.checkUserMinuteLimit(res, { endpoint: 'gemini', userId: 'u1', paid: true })).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error: limiter.RATE_LIMIT_MESSAGES.minute,
      message: limiter.RATE_LIMIT_MESSAGES.minute,
      code: 'rate_limited',
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(res.headers['x-ratelimit-limit']).toBe('20');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
    expect(loggedEvents()).toContainEqual(expect.objectContaining({
      event: 'ratelimit.minute_rejected', endpoint: 'gemini', layer: 'user', subject: 'u1',
    }));
  });

  it('keys by user id, so another user is not affected', async () => {
    for (let i = 0; i < 5; i += 1) {
      await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'replace-plans', userId: 'u1' });
    }
    expect(await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'replace-plans', userId: 'u1' })).toBe(false);
    expect(await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'replace-plans', userId: 'u2' })).toBe(true);
  });

  it('echoes requestId when given', async () => {
    for (let i = 0; i < 10; i += 1) {
      await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'save-profile', userId: 'u1' });
    }
    const res = fakeRes();
    await limiter.checkUserMinuteLimit(res, { endpoint: 'save-profile', userId: 'u1', requestId: 'abcd1234' });
    expect(res.body.requestId).toBe('abcd1234');
  });
});

describe('IP abuse limit', () => {
  it('keys by the first forwarded IP and logs only a hash of it', async () => {
    for (let i = 0; i < 100; i += 1) {
      expect(await limiter.checkIpAbuseLimit(fakeReq(), fakeRes(), { endpoint: 'gemini' })).toBe(true);
    }
    const res = fakeRes();
    expect(await limiter.checkIpAbuseLimit(fakeReq(), res, { endpoint: 'gemini' })).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(upstash.calls.at(-1).identifier).toBe('203.0.113.7');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('203.0.113.7');

    expect(await limiter.checkIpAbuseLimit(fakeReq('198.51.100.1'), fakeRes(), { endpoint: 'gemini' })).toBe(true);
  });
});

describe('daily quota', () => {
  it('allows the daily quota, then returns 429 with Retry-After until 00:00 UTC', async () => {
    for (let i = 0; i < 300; i += 1) {
      expect(await limiter.consumeDailyQuota(fakeRes(), { endpoint: 'gemini', userId: 'u1' })).toBe(true);
    }
    const res = fakeRes();
    expect(await limiter.consumeDailyQuota(res, { endpoint: 'gemini', userId: 'u1' })).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('daily_limit_reached');
    expect(res.body.message).toBe(limiter.RATE_LIMIT_MESSAGES.daily);
    expect(res.headers['retry-after']).toBe(String(12 * 60 * 60));
    expect(loggedEvents()).toContainEqual(expect.objectContaining({
      event: 'ratelimit.daily_rejected', endpoint: 'gemini', subject: 'u1',
    }));
  });

  it('resets at 00:00 UTC', async () => {
    vi.setSystemTime(new Date('2026-09-29T23:59:59Z'));
    for (let i = 0; i < 500; i += 1) {
      await limiter.consumeDailyQuota(fakeRes(), { endpoint: 'tts', userId: 'u1' });
    }
    const res = fakeRes();
    expect(await limiter.consumeDailyQuota(res, { endpoint: 'tts', userId: 'u1' })).toBe(false);
    expect(res.headers['retry-after']).toBe('1');

    vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
    expect(await limiter.consumeDailyQuota(fakeRes(), { endpoint: 'tts', userId: 'u1' })).toBe(true);
  });

  it('keys by endpoint and action, and supports weighted units', async () => {
    await limiter.consumeDailyQuota(fakeRes(), { endpoint: 'gemini', userId: 'u1' });
    await limiter.consumeDailyQuota(fakeRes(), { endpoint: 'gemini', userId: 'u1', action: 'image', units: 3 });
    expect(upstash.calls[0]).toEqual({ prefix: 'q:v1:gemini:all', identifier: 'u1', opts: undefined });
    expect(upstash.calls[1]).toEqual({ prefix: 'q:v1:gemini:image', identifier: 'u1', opts: { rate: 3 } });
  });

  it('refuses endpoints without a daily quota', async () => {
    await expect(limiter.consumeDailyQuota(fakeRes(), { endpoint: 'save-profile', userId: 'u1' }))
      .rejects.toThrow(/No daily quota/);
  });
});

describe('secondsUntilUtcMidnight', () => {
  it('counts to the next UTC midnight', () => {
    expect(limiter.secondsUntilUtcMidnight(Date.parse('2026-09-29T00:00:00Z'))).toBe(86400);
    expect(limiter.secondsUntilUtcMidnight(Date.parse('2026-09-29T23:59:59.500Z'))).toBe(1);
  });
});

describe('limiter unavailable', () => {
  const failures = [
    ['error', () => { upstash.mode = 'throw'; }],
    ['timeout', () => { upstash.mode = 'timeout'; }],
    ['not_configured', () => { delete process.env.UPSTASH_REDIS_REST_URL; }],
  ];

  for (const [failure, arrange] of failures) {
    it(`${failure}: paid checks return 503, non-paid checks allow`, async () => {
      arrange();

      const paid = fakeRes();
      expect(await limiter.checkUserMinuteLimit(paid, { endpoint: 'gemini', userId: 'u1', paid: true })).toBe(false);
      expect(paid.statusCode).toBe(503);
      expect(paid.headers['retry-after']).toBe('30');
      expect(paid.body).toEqual({
        error: limiter.RATE_LIMIT_MESSAGES.unavailable,
        message: limiter.RATE_LIMIT_MESSAGES.unavailable,
        code: 'temporarily_unavailable',
      });

      const daily = fakeRes();
      expect(await limiter.consumeDailyQuota(daily, { endpoint: 'tts', userId: 'u1' })).toBe(false);
      expect(daily.statusCode).toBe(503);

      const free = fakeRes();
      expect(await limiter.checkUserMinuteLimit(free, { endpoint: 'save-profile', userId: 'u1' })).toBe(true);
      expect(free.statusCode).toBeNull();

      const ip = fakeRes();
      expect(await limiter.checkIpAbuseLimit(fakeReq(), ip, { endpoint: 'gemini' })).toBe(true);
      expect(ip.statusCode).toBeNull();

      const events = loggedEvents();
      expect(events).toContainEqual(expect.objectContaining({ event: 'ratelimit.limiter_unavailable', failure }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'ratelimit.paid_blocked_unavailable', endpoint: 'gemini', failure,
      }));
      const logs = JSON.stringify(warn.mock.calls);
      expect(logs).not.toContain('ECONNREFUSED');
      expect(logs).not.toMatch(/upstash/i);
      expect(JSON.stringify(paid.body)).not.toMatch(/redis|upstash/i);
    });
  }
});

describe('Sentry throttle', () => {
  it('reports at most once per endpoint and failure type per 5 minutes', async () => {
    upstash.mode = 'throw';
    for (let i = 0; i < 5; i += 1) {
      await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'gemini', userId: 'u1', paid: true });
    }
    expect(sentry.reportMessage).toHaveBeenCalledTimes(1);
    expect(sentry.reportMessage).toHaveBeenCalledWith(
      'Rate limiter unavailable',
      'warning',
      { endpoint: 'gemini', failure: 'error' },
    );

    await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'tts', userId: 'u1', paid: true });
    upstash.mode = 'timeout';
    await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'gemini', userId: 'u1', paid: true });
    expect(sentry.reportMessage).toHaveBeenCalledTimes(3);

    upstash.mode = 'throw';
    vi.advanceTimersByTime(4 * 60 * 1000);
    await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'gemini', userId: 'u1', paid: true });
    expect(sentry.reportMessage).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(60 * 1000);
    await limiter.checkUserMinuteLimit(fakeRes(), { endpoint: 'gemini', userId: 'u1', paid: true });
    expect(sentry.reportMessage).toHaveBeenCalledTimes(4);
  });
});
