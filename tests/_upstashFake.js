// In-memory stand-in for @upstash/ratelimit and @upstash/redis, shared by handler tests.
// Windows are bucketed on Date.now(), like Upstash fixedWindow.
// Usage in a test file:
//   vi.mock('@upstash/redis', async () => (await import('./_upstashFake.js')).redisModule);
//   vi.mock('@upstash/ratelimit', async () => (await import('./_upstashFake.js')).ratelimitModule);

export const upstash = {
  mode: 'normal', // 'normal' | 'throw' | 'timeout'
  counts: new Map(),
  calls: [],
};

export function resetUpstash() {
  upstash.mode = 'normal';
  upstash.counts.clear();
  upstash.calls.length = 0;
}

// Pre-fill a window so the next call is over the limit.
export function seedWindow(prefix, identifier, windowMs, used) {
  const bucket = Math.floor(Date.now() / windowMs);
  upstash.counts.set(`${prefix}:${identifier}:${bucket}`, used);
}

export function callsWithPrefix(start) {
  return upstash.calls.filter((call) => call.prefix.startsWith(start));
}

const toMs = (window) => {
  const [n, unit] = window.split(' ');
  return Number(n) * ({ s: 1000, d: 86400000 })[unit];
};

class Ratelimit {
  constructor(config) {
    this.config = config;
  }

  static slidingWindow(max, window) {
    return { max, windowMs: toMs(window) };
  }

  static fixedWindow(max, window) {
    return { max, windowMs: toMs(window) };
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

export const ratelimitModule = { Ratelimit };
export const redisModule = { Redis: class {} };
