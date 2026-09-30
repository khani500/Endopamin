import { readFileSync } from 'node:fs';
import { APP_UPDATE_REQUIRED, evaluateMinVersion, resolveStoreUrl } from './_minVersionRule.js';
import { reportError } from './_sentry.js';

// Single source of truth: the same file the website serves at /app-config.json.
// Read with readFileSync, not a JSON import, so a broken file turns enforcement
// off instead of crashing every handler at module load.
const APP_CONFIG_URL = new URL('../site/app-config.json', import.meta.url);

export const PLATFORM_HEADER = 'x-endopamin-platform';
export const APP_VERSION_HEADER = 'x-endopamin-app-version';
export const BUILD_HEADER = 'x-endopamin-build';

export function readAppConfig(read = () => readFileSync(APP_CONFIG_URL, 'utf8')) {
  try {
    const parsed = JSON.parse(read());
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// A repeated header arrives as an array; treat it as absent rather than guess.
function headerValue(req, name) {
  const value = req?.headers?.[name];
  return typeof value === 'string' ? value : null;
}

export function readClientVersion(req) {
  return {
    platform: headerValue(req, PLATFORM_HEADER),
    version: headerValue(req, APP_VERSION_HEADER),
    build: headerValue(req, BUILD_HEADER),
  };
}

/**
 * Returns an async guard: resolves true after sending 426 when the caller's app
 * version is below the configured minimum, false otherwise. A malformed config is
 * reported to Sentry once per guard and never blocks.
 */
export function createMinimumVersionGuard({ config, report = reportError } = {}) {
  let reportedMalformed = false;

  return async function enforce(req, res) {
    const client = readClientVersion(req);
    const verdict = evaluateMinVersion(config?.minVersion, client);

    if (verdict.reason === 'config-malformed' && !reportedMalformed) {
      reportedMalformed = true;
      await report(new Error('app-config.json minVersion is malformed; enforcement is off'), {
        area: 'app-version',
      });
    }

    if (verdict.decision !== 'update_required') return false;

    res.status(426).json({
      error: 'Update required',
      code: APP_UPDATE_REQUIRED,
      storeUrl: resolveStoreUrl(config, client.platform),
    });
    return true;
  };
}

let defaultGuard = null;

// Handlers call: if (await enforceMinimumVersion(req, res)) return;
export function enforceMinimumVersion(req, res) {
  if (!defaultGuard) {
    defaultGuard = createMinimumVersionGuard({ config: readAppConfig() });
  }
  return defaultGuard(req, res);
}
