import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exerciseMediaBatchHandler,
  exerciseMediaDispatcher,
  handleExerciseMedia,
  handleExerciseMediaBatch,
} from '../api/exercise-media.js';
import { getAppConfig, resetAppConfigCache } from '../api/_appConfig.js';

const A = 'fx_alpha';
const B = 'fx_beta';
const C = 'fx_unknown';
const MEDIA = {
  [A]: {
    mediaVersion: 1,
    animationPath: 'V1/exercisedb/a/a-360.gif',
    thumbnailPath: 'V1/exercisedb/a/a-180.gif',
  },
  [B]: {
    mediaVersion: 2,
    animationPath: 'V1/exercisedb/b/b-360.gif',
    thumbnailPath: 'V1/exercisedb/b/b-180.gif',
  },
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

function request(body = { exerciseIds: [A] }, overrides = {}) {
  return {
    method: 'POST',
    query: { __route: 'batch' },
    headers: { authorization: 'Bearer valid-token' },
    body,
    ...overrides,
  };
}

function rowsFor(ids = [A, B]) {
  return ids.map((exerciseId) => ({
    canonical_exercise_id: exerciseId,
    media_version: MEDIA[exerciseId].mediaVersion,
    animation_path: MEDIA[exerciseId].animationPath,
    thumbnail_path: MEDIA[exerciseId].thumbnailPath,
  }));
}

function service({ auth = true, signedResult, singleRow = rowsFor([A])[0] } = {}) {
  const createSignedUrl = vi.fn(async (path) => ({ data: { signedUrl: `https://signed.invalid/${path}` }, error: null }));
  const createSignedUrls = vi.fn(async (paths) => signedResult ?? ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.invalid/${path}`, error: null })),
    error: null,
  }));
  return {
    auth: {
      getUser: vi.fn(async () => (auth
        ? { data: { user: { id: 'user-1' } }, error: null }
        : { data: { user: null }, error: { message: 'bad token' } })),
    },
    from: vi.fn(() => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: singleRow, error: null }),
      };
      return query;
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl, createSignedUrls })) },
    createSignedUrl,
    createSignedUrls,
  };
}

function batchDependencies(overrides = {}) {
  return {
    admin: service(),
    applyCorsHeaders: () => true,
    enforceMinimumVersion: async () => false,
    checkIpAbuseLimit: vi.fn(async () => true),
    checkBatchIpItemLimit: vi.fn(async () => true),
    checkUserMinuteLimit: vi.fn(async () => true),
    checkBatchUserItemLimit: vi.fn(async () => true),
    getAppConfig: vi.fn(async () => ({ vendorContentEnabled: true, libraryEnabled: true })),
    checkMediaEntitlement: vi.fn(async () => ({ state: 'active' })),
    readMediaManifest: () => ({ media: MEDIA }),
    readActiveRows: vi.fn(async (_admin, ids) => rowsFor(ids)),
    now: () => 1_000,
    ...overrides,
  };
}

async function callBatch(req = request(), deps = batchDependencies()) {
  const res = response();
  await handleExerciseMediaBatch(req, res, deps);
  return { res, deps };
}

beforeEach(() => resetAppConfigCache());

describe('exercise media kill gates and dispatcher', () => {
  it('blocks the single endpoint when the vendor gate is off', async () => {
    const entitlement = vi.fn();
    const res = response();
    await handleExerciseMedia(request({ exerciseId: A }, { query: undefined }), res, {
      admin: service(),
      checkIpAbuseLimit: async () => true,
      getAppConfig: async () => ({ vendorContentEnabled: false, libraryEnabled: true }),
      checkMediaEntitlement: entitlement,
    });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('vendor_content_unavailable');
    expect(entitlement).not.toHaveBeenCalled();
  });

  it('blocks batch on the vendor gate before the Library gate', async () => {
    const { res, deps } = await callBatch(request(), batchDependencies({
      getAppConfig: async () => ({ vendorContentEnabled: false, libraryEnabled: false }),
    }));
    expect(res.body.code).toBe('vendor_content_unavailable');
    expect(deps.checkMediaEntitlement).not.toHaveBeenCalled();
  });

  it('blocks batch on the Library gate while the single endpoint still works', async () => {
    const config = async () => ({ vendorContentEnabled: true, libraryEnabled: false });
    const batch = await callBatch(request(), batchDependencies({ getAppConfig: config }));
    expect(batch.res.body.code).toBe('library_unavailable');

    const res = response();
    await handleExerciseMedia(request({ exerciseId: A }, { query: undefined }), res, {
      admin: service(),
      checkIpAbuseLimit: async () => true,
      getAppConfig: config,
      checkMediaEntitlement: async () => ({ state: 'active' }),
      checkUserMinuteLimit: async () => true,
      readMediaManifest: () => ({ media: MEDIA }),
      now: () => 1_000,
    });
    expect(res.statusCode).toBe(200);
  });

  it('fails closed when app_config cannot be read', async () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: { message: 'hidden' } }) };
    await expect(getAppConfig({ from: () => query })).resolves.toEqual({
      vendorContentEnabled: false,
      libraryEnabled: false,
    });
  });

  it('never uses an app_config cache entry older than 30 seconds', async () => {
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { vendor_content_enabled: true, library_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { vendor_content_enabled: false, library_enabled: false }, error: null });
    const query = { select: () => query, eq: () => query, maybeSingle };
    const admin = { from: () => query };
    expect((await getAppConfig(admin, { now: () => 0 })).vendorContentEnabled).toBe(true);
    expect((await getAppConfig(admin, { now: () => 30_001 })).vendorContentEnabled).toBe(false);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('dispatches a request without __route to the unchanged single handler', async () => {
    const req = request({ exerciseId: A }, { query: undefined });
    const res = response();
    await exerciseMediaDispatcher(req, res, batchDependencies({
      readActiveRows: undefined,
      getAppConfig: async () => ({ vendorContentEnabled: true, libraryEnabled: false }),
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body.exerciseId).toBe(A);
    expect(res.body.animationUrl).toContain('-360.gif');
  });

  it('returns a no-store 404 for an unknown internal route', async () => {
    const res = response();
    await exerciseMediaDispatcher(request(undefined, { query: { __route: 'unknown' } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('exercise-media-batch validation and results', () => {
  it('rejects 51 submitted items before the IP limiter', async () => {
    const deps = batchDependencies();
    const { res } = await callBatch(request({ exerciseIds: Array(51).fill(A) }), deps);
    expect(res.body).toMatchObject({ code: 'invalid_request', field: 'exerciseIds' });
    expect(deps.checkIpAbuseLimit).not.toHaveBeenCalled();
  });

  it('reports the malformed exercise item path', async () => {
    const { res } = await callBatch(request({ exerciseIds: [A, '0313'] }));
    expect(res.body).toMatchObject({ code: 'invalid_request', field: 'exerciseIds[1]' });
  });

  it('rejects a knownMediaVersions key outside the requested IDs', async () => {
    const { res } = await callBatch(request({ exerciseIds: [A], knownMediaVersions: { [B]: 2 } }));
    expect(res.body).toMatchObject({ code: 'invalid_request', field: `knownMediaVersions.${B}` });
  });

  it('rejects a non-positive knownMediaVersions value', async () => {
    const { res } = await callBatch(request({ exerciseIds: [A], knownMediaVersions: { [A]: 0 } }));
    expect(res.body).toMatchObject({ code: 'invalid_request', field: `knownMediaVersions.${A}` });
  });

  it('rejects an extra top-level key', async () => {
    const { res } = await callBatch(request({ exerciseIds: [A], all: true }));
    expect(res.body).toMatchObject({ code: 'invalid_request', field: 'all' });
  });

  it('deduplicates IDs and preserves first-occurrence order', async () => {
    const { res, deps } = await callBatch(request({ exerciseIds: [B, A, B, C] }));
    expect(res.body.items.map(({ exerciseId }) => exerciseId)).toEqual([B, A, C]);
    expect(deps.readActiveRows).toHaveBeenCalledWith(deps.admin, [B, A]);
  });

  it('returns an ok, notModified and no_media mix with thumbnail-only output', async () => {
    const { res } = await callBatch(request({
      exerciseIds: [A, B, C],
      knownMediaVersions: { [B]: 2 },
    }));
    expect(res.body.items).toEqual([
      {
        exerciseId: A,
        status: 'ok',
        mediaVersion: 1,
        thumbnailUrl: `https://signed.invalid/${MEDIA[A].thumbnailPath}`,
        expiresAt: new Date(601_000).toISOString(),
      },
      { exerciseId: B, status: 'notModified', mediaVersion: 2 },
      { exerciseId: C, status: 'no_media' },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/animation|Path|provider|external/i);
  });

  it('does not call storage signing when there are zero ok items', async () => {
    const admin = service();
    const { res } = await callBatch(request({
      exerciseIds: [B, C],
      knownMediaVersions: { [B]: 2 },
    }), batchDependencies({ admin }));
    expect(res.statusCode).toBe(200);
    expect(admin.createSignedUrls).not.toHaveBeenCalled();
  });

  it('maps signing cardinality mismatch to media_unavailable', async () => {
    const admin = service({ signedResult: { data: [], error: null } });
    const { res } = await callBatch(request(), batchDependencies({ admin }));
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('media_unavailable');
  });

  it('maps a row and manifest mismatch to media_unavailable', async () => {
    const mismatched = [{ ...rowsFor([A])[0], media_version: 99 }];
    const { res } = await callBatch(request(), batchDependencies({ readActiveRows: async () => mismatched }));
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('media_unavailable');
  });

  it.each([
    ['inactive', 402, 'subscription_required'],
    ['unavailable', 503, 'entitlement_unavailable'],
  ])('distinguishes %s entitlement state', async (state, status, code) => {
    const { res } = await callBatch(request(), batchDependencies({
      checkMediaEntitlement: async () => ({ state }),
    }));
    expect(res.statusCode).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('rejects a success response larger than 128 KiB', async () => {
    const huge = `https://signed.invalid/${'x'.repeat(132_000)}`;
    const admin = service({
      signedResult: { data: [{ path: MEDIA[A].thumbnailPath, signedUrl: huge, error: null }], error: null },
    });
    const { res } = await callBatch(request(), batchDependencies({ admin }));
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('media_unavailable');
  });

  it('sets no-store on batch responses', async () => {
    const res = response();
    await exerciseMediaBatchHandler(request({ exerciseIds: [] }), res, batchDependencies());
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
