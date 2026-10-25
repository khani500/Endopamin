import { describe, expect, it, vi } from 'vitest';
import {
  checkMediaEntitlement,
  exerciseMediaHandler,
  handleExerciseMedia,
  readMediaManifest,
} from '../api/exercise-media.js';

const EXERCISE_ID = 'fx_alternate_hammer_curl';
const ITEM = {
  provider: 'exercisedb',
  externalMediaId: '0313',
  mediaVersion: 1,
  animationPath: 'V1/exercisedb/0313/0313-360.gif',
  thumbnailPath: 'V1/exercisedb/0313/0313-180.gif',
};

function response() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token' },
    body: { exerciseId: EXERCISE_ID },
    ...overrides,
  };
}

function chain(result) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve(result),
  };
  return query;
}

function admin({ auth = true, row = ITEM, signError = false } = {}) {
  const createSignedUrl = vi.fn(async (objectPath) => (signError
    ? { data: null, error: { message: 'hidden' } }
    : { data: { signedUrl: `https://signed.invalid/${objectPath}` }, error: null }));
  return {
    auth: {
      getUser: vi.fn(async () => (auth
        ? { data: { user: { id: 'user-1' } }, error: null }
        : { data: { user: null }, error: { message: 'bad token' } })),
    },
    from: vi.fn((table) => table === 'app_config' ? chain({
      data: { vendor_content_enabled: true, library_enabled: false }, error: null,
    }) : chain({
      data: row ? {
        canonical_exercise_id: EXERCISE_ID,
        media_version: row.mediaVersion,
        animation_path: row.animationPath,
        thumbnail_path: row.thumbnailPath,
      } : null,
      error: null,
    })),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
    createSignedUrl,
  };
}

function dependencies(overrides = {}) {
  return {
    admin: admin(),
    checkIpAbuseLimit: vi.fn(async () => true),
    checkUserMinuteLimit: vi.fn(async () => true),
    checkMediaEntitlement: vi.fn(async () => ({ state: 'active' })),
    readMediaManifest: () => ({ media: { [EXERCISE_ID]: ITEM } }),
    ...overrides,
  };
}

async function call(req = request(), deps = dependencies()) {
  const res = response();
  await handleExerciseMedia(req, res, deps);
  return { res, deps };
}

describe('exercise-media request gates', () => {
  it('runs the minimum-version guard before every business check', async () => {
    const events = [];
    const res = response();
    await exerciseMediaHandler(request(), res, dependencies({
      applyCorsHeaders: () => true,
      enforceMinimumVersion: async (_req, guardedRes) => {
        events.push('minimum');
        guardedRes.status(426).json({ code: 'APP_UPDATE_REQUIRED' });
        return true;
      },
      checkIpAbuseLimit: async () => { events.push('ip'); return true; },
    }));
    expect(events).toEqual(['minimum']);
    expect(res.statusCode).toBe(426);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['wrong method', request({ method: 'GET' }), 405, 'method_not_allowed'],
    ['non-object body', request({ body: null }), 400, 'invalid_request'],
    ['malformed ID', request({ body: { exerciseId: '0313' } }), 400, 'invalid_exercise_id'],
    ['bad known version', request({ body: { exerciseId: EXERCISE_ID, knownMediaVersion: 0 } }), 400, 'invalid_request'],
  ])('refuses %s before the IP limiter', async (_label, req, status, code) => {
    const deps = dependencies();
    const { res } = await call(req, deps);
    expect(res.statusCode).toBe(status);
    expect(res.body.code).toBe(code);
    expect(deps.checkIpAbuseLimit).not.toHaveBeenCalled();
  });

  it('stops at the IP limit before bearer authentication', async () => {
    const service = admin();
    const { res } = await call(request(), dependencies({
      admin: service,
      checkIpAbuseLimit: async (_req, limitedRes) => {
        limitedRes.status(429).json({ error: 'Slow down', code: 'rate_limited' });
        return false;
      },
    }));
    expect(res.body.code).toBe('rate_limited');
    expect(service.auth.getUser).not.toHaveBeenCalled();
  });

  it('returns typed 401 before entitlement for a missing or invalid token', async () => {
    for (const req of [request({ headers: {} }), request()]) {
      const gate = vi.fn();
      const { res } = await call(req, dependencies({
        admin: admin({ auth: req.headers.authorization === undefined ? true : false }),
        checkMediaEntitlement: gate,
      }));
      expect(res.statusCode).toBe(401);
      expect(res.body.code).toBe('authentication_required');
      expect(gate).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['inactive', 402, 'subscription_required'],
    ['unavailable', 503, 'entitlement_unavailable'],
  ])('fails closed for entitlement state %s without signing', async (state, status, code) => {
    const service = admin();
    const { res } = await call(request(), dependencies({
      admin: service,
      checkMediaEntitlement: async () => ({ state }),
    }));
    expect(res.statusCode).toBe(status);
    expect(res.body.code).toBe(code);
    expect(service.createSignedUrl).not.toHaveBeenCalled();
  });

  it('treats an effective active trial row as entitled and lookup errors/timeouts as unavailable', async () => {
    const future = '2026-10-29T00:00:00.000Z';
    const active = { from: () => chain({ data: { active: true, access_expires_at: future }, error: null }) };
    const errored = { from: () => chain({ data: null, error: { message: 'hidden' } }) };
    expect(await checkMediaEntitlement(active, 'u1', { now: () => new Date('2026-10-22T00:00:00Z') })).toEqual({ state: 'active' });
    expect(await checkMediaEntitlement(errored, 'u1')).toEqual({ state: 'unavailable' });
    const pending = { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: () => new Promise(() => {}) }) };
    expect(await checkMediaEntitlement(pending, 'u1', { timeoutMs: 2 })).toEqual({ state: 'unavailable' });
  });

  it('applies the user limit after entitlement and before manifest membership', async () => {
    const manifest = vi.fn();
    const { res, deps } = await call(request(), dependencies({
      readMediaManifest: manifest,
      checkUserMinuteLimit: async (limitedRes) => {
        limitedRes.status(429).json({ error: 'Slow down', code: 'rate_limited' });
        return false;
      },
    }));
    expect(res.body.code).toBe('rate_limited');
    expect(deps.checkMediaEntitlement).toHaveBeenCalled();
    expect(manifest).not.toHaveBeenCalled();
  });

  it('returns no_media for an unknown valid ID or an absent active row', async () => {
    const unknown = await call(request({ body: { exerciseId: 'valid_but_unknown' } }));
    expect(unknown.res.body.code).toBe('no_media');
    const absent = await call(request(), dependencies({ admin: admin({ row: null }) }));
    expect(absent.res.body.code).toBe('no_media');
  });

  it('authorizes before notModified and returns no signed URLs for a known version', async () => {
    const service = admin();
    const gate = vi.fn(async () => ({ state: 'active' }));
    const { res } = await call(request({ body: { exerciseId: EXERCISE_ID, knownMediaVersion: 1 } }), dependencies({
      admin: service,
      checkMediaEntitlement: gate,
    }));
    expect(gate).toHaveBeenCalled();
    expect(res.body).toEqual({ exerciseId: EXERCISE_ID, mediaVersion: 1, notModified: true });
    expect(service.createSignedUrl).not.toHaveBeenCalled();
  });

  it('signs only the two manifest paths for 600 seconds and returns a 600-second expiry', async () => {
    const service = admin();
    const { res } = await call(request(), dependencies({ admin: service, now: () => 1_000 }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      exerciseId: EXERCISE_ID,
      mediaVersion: 1,
      animationUrl: `https://signed.invalid/${ITEM.animationPath}`,
      thumbnailUrl: `https://signed.invalid/${ITEM.thumbnailPath}`,
      expiresAt: new Date(601_000).toISOString(),
      notModified: false,
    });
    expect(service.createSignedUrl.mock.calls).toEqual([
      [ITEM.animationPath, 600],
      [ITEM.thumbnailPath, 600],
    ]);
  });

  it('maps row drift and signing failure to media_unavailable without leaking internals', async () => {
    for (const service of [admin({ row: { ...ITEM, mediaVersion: 2 } }), admin({ signError: true })]) {
      const { res } = await call(request(), dependencies({ admin: service }));
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: 'Exercise media is temporarily unavailable', code: 'media_unavailable' });
      expect(JSON.stringify(res.body)).not.toContain('hidden');
    }
  });

  it('loads and validates the committed 517-record manifest', () => {
    const manifest = readMediaManifest();
    expect(manifest.recordCount).toBe(517);
    expect(Object.keys(manifest.media)).toHaveLength(517);
  });
});
