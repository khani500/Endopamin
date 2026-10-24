import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hasEffectiveAccess } from './_entitlement.js';

export const BUCKET = 'exercise-media';
export const SIGNED_URL_TTL_SECONDS = 600;
export const ENTITLEMENT_TIMEOUT_MS = 2500;
export const EXERCISE_ID = /^[a-z][a-z0-9_]*$/;

const MANIFEST_URL = new URL('../core/data/media-manifest.json', import.meta.url);
const MANIFEST_KEYS = ['manifestVersion', 'mediaVersion', 'recordCount', 'media', 'sha256'];

export const RESPONSES = Object.freeze({
  invalid_request: [400, 'Invalid request'],
  invalid_exercise_id: [400, 'Invalid exercise ID'],
  authentication_required: [401, 'Authentication required'],
  subscription_required: [402, 'Subscription required'],
  entitlement_unavailable: [503, 'Entitlement verification is temporarily unavailable'],
  no_media: [404, 'No media is available for this exercise'],
  media_unavailable: [503, 'Exercise media is temporarily unavailable'],
});

const codeUnitCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort(codeUnitCompare)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error('unsupported manifest value');
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasOnlyKeys(value, allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

export function exactKeys(value, allowed) {
  return isPlainObject(value) && hasOnlyKeys(value, allowed);
}

export function readMediaManifest(read = () => readFileSync(MANIFEST_URL, 'utf8')) {
  const manifest = JSON.parse(read());
  if (!exactKeys(manifest, MANIFEST_KEYS)
    || !MANIFEST_KEYS.every((key) => Object.hasOwn(manifest, key))
    || manifest.manifestVersion !== 1
    || !Number.isInteger(manifest.mediaVersion)
    || !Number.isInteger(manifest.recordCount)
    || !isPlainObject(manifest.media)
    || manifest.recordCount !== Object.keys(manifest.media).length
    || typeof manifest.sha256 !== 'string') {
    throw new Error('invalid media manifest');
  }
  const hashed = {
    manifestVersion: manifest.manifestVersion,
    mediaVersion: manifest.mediaVersion,
    recordCount: manifest.recordCount,
    media: manifest.media,
  };
  const digest = createHash('sha256').update(canonical(hashed)).digest('hex');
  if (digest !== manifest.sha256) throw new Error('media manifest sha256 mismatch');
  return manifest;
}

export function sendMediaError(res, code, extra) {
  const [status, error] = RESPONSES[code];
  return res.status(status).json(extra ? { error, code, ...extra } : { error, code });
}

async function withTimeout(operation, timeoutMs = ENTITLEMENT_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkMediaEntitlement(admin, userId, { now = () => new Date(), timeoutMs } = {}) {
  let result;
  try {
    result = await withTimeout(
      admin.from('user_entitlements')
        .select('active,access_expires_at')
        .eq('user_id', userId)
        .maybeSingle(),
      timeoutMs,
    );
  } catch {
    return { state: 'unavailable' };
  }
  if (result?.error) return { state: 'unavailable' };
  if (!result?.data || !hasEffectiveAccess({
    active: result.data.active,
    accessExpiresAt: result.data.access_expires_at ?? null,
  }, now())) return { state: 'inactive' };
  return { state: 'active' };
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export async function authenticate(admin, token) {
  try {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data?.user ? null : data.user;
  } catch {
    return null;
  }
}
