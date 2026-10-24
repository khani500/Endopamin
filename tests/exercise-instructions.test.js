import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exerciseMediaDispatcher } from '../api/exercise-media.js';
import { readLibraryInstructions } from '../api/_exerciseInstructions.js';
import { getAppConfig, resetAppConfigCache } from '../api/_appConfig.js';

const ID = 'fx_alternate_hammer_curl';
const REVIEWED = 'fx_dead_bug';
function response() {
  return { headers: {}, statusCode: null, body: null, headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(v) { this.statusCode = v; return this; },
    json(v) { this.body = v; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; } };
}
function dependencies(overrides = {}) {
  return {
    admin: { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) } },
    applyCorsHeaders: vi.fn(() => true), enforceMinimumVersion: vi.fn(async () => false),
    checkIpAbuseLimit: vi.fn(async () => true), checkUserMinuteLimit: vi.fn(async () => true),
    getAppConfig: vi.fn(async () => ({ vendorContentEnabled: true, libraryEnabled: true })),
    checkMediaEntitlement: vi.fn(async () => ({ state: 'active' })), ...overrides,
  };
}
async function call(body = { exerciseId: ID }, deps = dependencies(), overrides = {}) {
  const req = { method: 'POST', query: { __route: 'instructions' },
    headers: { authorization: 'Bearer valid-token' }, body, ...overrides };
  const res = response();
  await exerciseMediaDispatcher(req, res, deps);
  return { req, res, deps };
}
beforeEach(resetAppConfigCache);

describe('Library instructions route', () => {
  it.each([
    [false, false, 'vendor_content_unavailable'],
    [true, false, 'library_unavailable'],
  ])('refuses vendor=%s Library=%s before entitlement', async (vendorContentEnabled, libraryEnabled, code) => {
    const deps = dependencies({ getAppConfig: async () => ({ vendorContentEnabled, libraryEnabled }) });
    const { res } = await call(undefined, deps);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe(code);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(deps.checkMediaEntitlement).not.toHaveBeenCalled();
  });
  it.each([[ID, 'vendor_pack'], [REVIEWED, 'endopamin_reviewed']])('serves %s with both gates on', async (exerciseId, instructionsSource) => {
    const { res } = await call({ exerciseId });
    const entry = readLibraryInstructions().entries[exerciseId];
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ exerciseId, status: 'ok', instructions: entry.instructions, instructionsSource, contentVersion: 1 });
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it.each([
    [{ exerciseId: ID, extra: true }, 'extra'],
    [{ exerciseId: '0025' }, 'exerciseId'],
    [{}, 'exerciseId'],
  ])('rejects invalid body %j with a field path', async (body, field) => {
    const { res, deps } = await call(body);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request', code: 'invalid_request', field });
    expect(deps.checkIpAbuseLimit).not.toHaveBeenCalled();
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('returns no_content for a valid absent ID', async () => {
    const { res } = await call({ exerciseId: 'fx_not_in_library' });
    expect(res.body).toEqual({ exerciseId: 'fx_not_in_library', status: 'no_content' });
  });
  it.each([['inactive', 402, 'subscription_required'], ['unavailable', 503, 'entitlement_unavailable']])(
    'distinguishes entitlement %s', async (state, status, code) => {
      const lookup = vi.fn();
      const { res } = await call(undefined, dependencies({ checkMediaEntitlement: async () => ({ state }), readLibraryInstructions: lookup }));
      expect(res.statusCode).toBe(status);
      expect(res.body.code).toBe(code);
      expect(lookup).not.toHaveBeenCalled();
    });
  it('returns media_unavailable on artifact read/parse/hash failure', async () => {
    for (const read of [() => { throw new Error('missing'); }, () => '{', () => '{"artifactVersion":1,"recordCount":0,"entries":{},"sha256":"bad"}']) {
      const { res } = await call(undefined, dependencies({ readLibraryInstructions: () => readLibraryInstructions(read) }));
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('media_unavailable');
    }
  });
  it('keeps unknown dispatcher routes as no-store 404', async () => {
    const { res } = await call(undefined, dependencies(), { query: { __route: 'unknown' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('handles allowed OPTIONS before version/authentication', async () => {
    const { res, deps } = await call(undefined, dependencies(), { method: 'OPTIONS' });
    expect(res.statusCode).toBe(204);
    expect(deps.enforceMinimumVersion).not.toHaveBeenCalled();
    expect(deps.admin.auth.getUser).not.toHaveBeenCalled();
  });
  it('handles minimum version before method and body', async () => {
    const deps = dependencies({ enforceMinimumVersion: async (_req, res) => { res.status(426).json({ code: 'APP_UPDATE_REQUIRED' }); return true; } });
    const { res } = await call(null, deps, { method: 'GET' });
    expect(res.statusCode).toBe(426);
    expect(deps.checkIpAbuseLimit).not.toHaveBeenCalled();
  });
  it('refuses non-POST methods', async () => {
    expect((await call(undefined, dependencies(), { method: 'GET' })).res.statusCode).toBe(405);
  });
  it('uses the required gate order and independent request-limit keys', async () => {
    const events = [];
    const deps = dependencies({
      checkIpAbuseLimit: async (_req, _res, options) => { events.push('ip:' + options.endpoint); return true; },
      admin: { auth: { getUser: async () => { events.push('auth'); return { data: { user: { id: 'u1' } } }; } } },
      getAppConfig: async () => { events.push('config'); return { vendorContentEnabled: true, libraryEnabled: true }; },
      checkMediaEntitlement: async (_admin, id) => { events.push('entitlement:' + id); return { state: 'active' }; },
      checkUserMinuteLimit: async (_res, options) => { events.push('user:' + options.endpoint); return true; },
      readLibraryInstructions: () => { events.push('artifact'); return { entries: {} }; },
    });
    await call(undefined, deps);
    expect(events).toEqual(['ip:exercise-instructions', 'auth', 'config', 'entitlement:u1', 'user:exercise-instructions', 'artifact']);
  });
  it('requires authentication before flags or artifact lookup', async () => {
    const deps = dependencies();
    const { res } = await call(undefined, deps, { headers: {} });
    expect(res.statusCode).toBe(401);
    expect(deps.getAppConfig).not.toHaveBeenCalled();
  });
});

describe('app_config strict booleans', () => {
  async function config(data) {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data, error: null }) };
    resetAppConfigCache();
    return getAppConfig({ from: () => query });
  }
  it('treats missing fields as false while preserving an explicit true sibling', async () => {
    expect(await config({})).toEqual({ vendorContentEnabled: false, libraryEnabled: false });
    expect(await config({ vendor_content_enabled: true })).toEqual({ vendorContentEnabled: true, libraryEnabled: false });
    expect(await config({ library_enabled: true })).toEqual({ vendorContentEnabled: false, libraryEnabled: true });
  });
  it('treats every non-boolean flag value as false', async () => {
    for (const value of [null, 'true', 'false', 1, 0, {}, []]) {
      expect(await config({ vendor_content_enabled: value, library_enabled: value })).toEqual({ vendorContentEnabled: false, libraryEnabled: false });
    }
    expect(await config({ vendor_content_enabled: true, library_enabled: true })).toEqual({ vendorContentEnabled: true, libraryEnabled: true });
  });
});
