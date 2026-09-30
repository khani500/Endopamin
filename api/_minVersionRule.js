// Minimum supported app version rule.
// This file is byte-identical in the Server repo (api/_minVersionRule.js) and the
// Mobile repo (src/lib/minVersionRule.js). Both test it against the same case table,
// tests/fixtures/minVersionCases.json. Change both copies together, never one.
// Pure: no imports, no I/O.

export const APP_UPDATE_REQUIRED = 'APP_UPDATE_REQUIRED';

export const FALLBACK_STORE_URLS = Object.freeze({
  ios: 'https://apps.apple.com/app/id6784407758',
  android: 'https://play.google.com/store/apps/details?id=com.endopamin.app',
});

const STORE_URL_PREFIXES = Object.freeze({
  ios: 'https://apps.apple.com/',
  android: 'https://play.google.com/',
});

const VERSION_PATTERN = /^\d{1,4}(\.\d{1,4}){0,3}$/;
const BUILD_PATTERN = /^\d{1,10}$/;
const MAX_MIN_BUILD = 2147483647;
const MAX_STORE_URL_LENGTH = 500;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMinVersion(value) {
  return value === null || (typeof value === 'string' && VERSION_PATTERN.test(value));
}

function isMinBuild(value) {
  return value === null || (Number.isInteger(value) && value >= 1 && value <= MAX_MIN_BUILD);
}

export function isValidMinVersionConfig(config) {
  return isPlainObject(config)
    && typeof config.enforce === 'boolean'
    && typeof config.rejectMissing === 'boolean'
    && isPlainObject(config.ios)
    && isMinVersion(config.ios.version)
    && isMinBuild(config.ios.build)
    && isPlainObject(config.android)
    && isMinBuild(config.android.versionCode);
}

// Client values arrive as strings (HTTP headers, expo-application). Anything else is malformed.
function parseClientVersion(value) {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : null;
}

function parseClientBuild(value) {
  return typeof value === 'string' && BUILD_PATTERN.test(value) ? Number(value) : null;
}

// Numeric, segment by segment; a missing segment counts as 0, so "1.1" equals "1.1.0".
function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function result(decision, reason) {
  return { decision, reason };
}

const allow = (reason) => result('allow', reason);
const updateRequired = (reason) => result('update_required', reason);

function evaluateIos(min, client) {
  if (min.version === null) return allow('no-minimum');
  const version = parseClientVersion(client.version);
  if (version === null) return updateRequired('client-malformed');
  const order = compareVersions(version, min.version);
  if (order < 0) return updateRequired('below-minimum');
  if (order > 0 || min.build === null) return allow('at-or-above-minimum');
  const build = parseClientBuild(client.build);
  if (build === null) return updateRequired('client-malformed');
  return build >= min.build ? allow('at-or-above-minimum') : updateRequired('below-minimum');
}

function evaluateAndroid(min, client) {
  if (min.versionCode === null) return allow('no-minimum');
  const build = parseClientBuild(client.build);
  if (build === null) return updateRequired('client-malformed');
  return build >= min.versionCode ? allow('at-or-above-minimum') : updateRequired('below-minimum');
}

/**
 * config: the `minVersion` block of app-config.json.
 * client: { platform, version, build } as strings, or null when unknown.
 * A malformed config never blocks anyone: it is treated as enforcement off.
 */
export function evaluateMinVersion(config, client) {
  if (!isValidMinVersionConfig(config)) return allow('config-malformed');
  if (!config.enforce) return allow('off');

  const platform = isPlainObject(client) ? client.platform : null;
  if (platform !== 'ios' && platform !== 'android') {
    return config.rejectMissing ? updateRequired('missing') : allow('missing');
  }
  return platform === 'ios'
    ? evaluateIos(config.ios, client)
    : evaluateAndroid(config.android, client);
}

/**
 * config: the whole app-config.json object. Returns the store link for the platform,
 * falling back to the built-in link when the configured one is missing or not an
 * https link on the expected store host. Unknown platform → null.
 */
export function resolveStoreUrl(config, platform) {
  if (platform !== 'ios' && platform !== 'android') return null;
  const storeUrls = isPlainObject(config) && isPlainObject(config.storeUrls) ? config.storeUrls : null;
  const candidate = storeUrls ? storeUrls[platform] : null;
  if (
    typeof candidate === 'string'
    && candidate.length <= MAX_STORE_URL_LENGTH
    && candidate.startsWith(STORE_URL_PREFIXES[platform])
    && !/\s/.test(candidate)
  ) {
    return candidate;
  }
  return FALLBACK_STORE_URLS[platform];
}
