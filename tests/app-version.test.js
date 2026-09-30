import { describe, expect, it, vi } from 'vitest';
import {
  APP_VERSION_HEADER,
  BUILD_HEADER,
  PLATFORM_HEADER,
  createMinimumVersionGuard,
  enforceMinimumVersion,
  readAppConfig,
  readClientVersion,
} from '../api/_appVersion.js';
import { evaluateMinVersion } from '../api/_minVersionRule.js';

function mockRes() {
  const res = {
    statusCode: null,
    body: undefined,
    status: vi.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

function reqWith(headers = {}) {
  return { method: 'POST', headers };
}

function versionHeaders(platform, version, build) {
  return {
    [PLATFORM_HEADER]: platform,
    [APP_VERSION_HEADER]: version,
    [BUILD_HEADER]: build,
  };
}

const enforcingConfig = {
  minVersion: {
    enforce: true,
    rejectMissing: false,
    ios: { version: '1.0.3', build: null },
    android: { versionCode: 20 },
  },
  storeUrls: {
    ios: 'https://apps.apple.com/app/id6784407758',
    android: 'https://play.google.com/store/apps/details?id=com.endopamin.app',
  },
};

describe('committed site/app-config.json', () => {
  it('ships with enforcement off and no minimums', () => {
    const config = readAppConfig();
    expect(config).toEqual({
      minVersion: {
        enforce: false,
        rejectMissing: false,
        ios: { version: null, build: null },
        android: { versionCode: null },
      },
      storeUrls: {
        ios: 'https://apps.apple.com/app/id6784407758',
        android: 'https://play.google.com/store/apps/details?id=com.endopamin.app',
      },
    });
    expect(evaluateMinVersion(config.minVersion, null)).toEqual({ decision: 'allow', reason: 'off' });
  });
});

describe('readAppConfig', () => {
  it('returns null for invalid JSON', () => {
    expect(readAppConfig(() => '{ not json')).toBeNull();
  });

  it('returns null for a non-object', () => {
    expect(readAppConfig(() => '[]')).toBeNull();
    expect(readAppConfig(() => 'null')).toBeNull();
  });

  it('returns null when the file cannot be read', () => {
    expect(readAppConfig(() => { throw new Error('ENOENT'); })).toBeNull();
  });
});

describe('readClientVersion', () => {
  it('reads the three headers', () => {
    expect(readClientVersion(reqWith(versionHeaders('ios', '1.0.3', '42')))).toEqual({
      platform: 'ios',
      version: '1.0.3',
      build: '42',
    });
  });

  it('treats absent and repeated headers as null', () => {
    expect(readClientVersion(reqWith({ [PLATFORM_HEADER]: ['ios', 'android'] }))).toEqual({
      platform: null,
      version: null,
      build: null,
    });
    expect(readClientVersion(undefined)).toEqual({ platform: null, version: null, build: null });
  });
});

describe('createMinimumVersionGuard', () => {
  it('sends 426 with the code and store link when below the minimum', async () => {
    const guard = createMinimumVersionGuard({ config: enforcingConfig, report: vi.fn() });
    const res = mockRes();
    await expect(guard(reqWith(versionHeaders('android', '1.0.2', '19')), res)).resolves.toBe(true);
    expect(res.statusCode).toBe(426);
    expect(res.body).toEqual({
      error: 'Update required',
      code: 'APP_UPDATE_REQUIRED',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.endopamin.app',
    });
  });

  it('lets a current build through without touching the response', async () => {
    const guard = createMinimumVersionGuard({ config: enforcingConfig, report: vi.fn() });
    const res = mockRes();
    await expect(guard(reqWith(versionHeaders('ios', '1.0.3', '1')), res)).resolves.toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('lets old builds with no headers through while rejectMissing is off', async () => {
    const guard = createMinimumVersionGuard({ config: enforcingConfig, report: vi.fn() });
    const res = mockRes();
    await expect(guard(reqWith({}), res)).resolves.toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks requests with no headers once rejectMissing is on, with no store link', async () => {
    const config = {
      ...enforcingConfig,
      minVersion: { ...enforcingConfig.minVersion, rejectMissing: true },
    };
    const guard = createMinimumVersionGuard({ config, report: vi.fn() });
    const res = mockRes();
    await expect(guard(reqWith({}), res)).resolves.toBe(true);
    expect(res.statusCode).toBe(426);
    expect(res.body).toEqual({ error: 'Update required', code: 'APP_UPDATE_REQUIRED', storeUrl: null });
  });

  it('never blocks on a malformed config and reports it to Sentry once', async () => {
    const report = vi.fn();
    const config = { minVersion: { enforce: 'yes' }, storeUrls: {} };
    const guard = createMinimumVersionGuard({ config, report });

    for (const headers of [{}, versionHeaders('ios', '0.0.1', '1'), versionHeaders('android', '1', '1')]) {
      const res = mockRes();
      await expect(guard(reqWith(headers), res)).resolves.toBe(false);
      expect(res.status).not.toHaveBeenCalled();
    }
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(report.mock.calls[0][1]).toEqual({ area: 'app-version' });
  });

  it('treats a missing config file (null) as malformed, never a lockout', async () => {
    const report = vi.fn();
    const guard = createMinimumVersionGuard({ config: null, report });
    const res = mockRes();
    await expect(guard(reqWith(versionHeaders('ios', '0.0.1', '1')), res)).resolves.toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('enforceMinimumVersion (committed config)', () => {
  it('lets every request through, with or without headers', async () => {
    for (const headers of [{}, versionHeaders('ios', '0.0.1', '1'), versionHeaders('android', '0', '1')]) {
      const res = mockRes();
      await expect(enforceMinimumVersion(reqWith(headers), res)).resolves.toBe(false);
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});
