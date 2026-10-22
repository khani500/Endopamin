import crypto from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { enforceMinimumVersion } from './_appVersion.js';
import { applyCorsHeaders } from './_cors.js';
import { createAdmin, hasEffectiveAccess } from './_entitlement.js';
import { checkIpAbuseLimit, checkUserMinuteLimit } from './_rateLimit.js';
import { reportError } from './_sentry.js';

const ENDPOINT = 'exercise-media';
const BUCKET = 'exercise-media';
const SIGNED_URL_TTL_SECONDS = 600;
const ENTITLEMENT_TIMEOUT_MS = 2500;
const EXERCISE_ID = /^[a-z][a-z0-9_]*$/;
const MANIFEST_URL = new URL('../core/data/media-manifest.json', import.meta.url);
const MANIFEST_KEYS = ['manifestVersion', 'mediaVersion', 'recordCount', 'media', 'sha256'];

const RESPONSES = Object.freeze({
  invalid_request: [400, 'Invalid request'],
  invalid_exercise_id: [400, 'Invalid exercise ID'],
  authentication_required: [401, 'Authentication required'],
  subscription_required: [402, 'Subscription required'],
  entitlement_unavailable: [503, 'Entitlement verification is temporarily unavailable'],
  no_media: [404, 'No media is available for this exercise'],
  media_unavailable: [503, 'Exercise media is temporarily unavailable'],
});

const codeUnitCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function canonical(value) {
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

function exactKeys(value, allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

export function readMediaManifest(read = () => readFileSync(MANIFEST_URL, 'utf8')) {
  const manifest = JSON.parse(read());
  if (!exactKeys(manifest, MANIFEST_KEYS)
    || !MANIFEST_KEYS.every((key) => Object.hasOwn(manifest, key))
    || manifest.manifestVersion !== 1
    || !Number.isInteger(manifest.mediaVersion)
    || !Number.isInteger(manifest.recordCount)
    || manifest.media === null
    || typeof manifest.media !== 'object'
    || Array.isArray(manifest.media)
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

function send(res, code) {
  const [status, error] = RESPONSES[code];
  return res.status(status).json({ error, code });
}

function parseBody(body) {
  if (!exactKeys(body, ['exerciseId', 'knownMediaVersion'])) return null;
  if (!Object.hasOwn(body, 'exerciseId')
    || typeof body.exerciseId !== 'string'
    || !EXERCISE_ID.test(body.exerciseId)) {
    return { error: 'invalid_exercise_id' };
  }
  if (Object.hasOwn(body, 'knownMediaVersion')
    && (!Number.isInteger(body.knownMediaVersion) || body.knownMediaVersion < 1)) {
    return { error: 'invalid_request' };
  }
  return {
    exerciseId: body.exerciseId,
    knownMediaVersion: body.knownMediaVersion ?? null,
  };
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

// Media is deliberately fail-closed and does not use the shared fail-open gate.
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

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function authenticate(admin, token) {
  try {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data?.user ? null : data.user;
  } catch {
    return null;
  }
}

async function mediaRow(admin, exerciseId) {
  const result = await admin.from('exercise_media')
    .select('canonical_exercise_id,media_version,animation_path,thumbnail_path')
    .eq('canonical_exercise_id', exerciseId)
    .eq('active', true)
    .maybeSingle();
  if (result.error) throw new Error('exercise_media read failed');
  return result.data ?? null;
}

async function signedUrl(storage, objectPath) {
  const { data, error } = await storage.createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error('media signing failed');
  return data.signedUrl;
}

export async function handleExerciseMedia(req, res, deps = {}) {
  const ipLimit = deps.checkIpAbuseLimit ?? checkIpAbuseLimit;
  const userLimit = deps.checkUserMinuteLimit ?? checkUserMinuteLimit;
  const entitlement = deps.checkMediaEntitlement ?? checkMediaEntitlement;
  const manifestReader = deps.readMediaManifest ?? readMediaManifest;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }

  const parsed = parseBody(req.body);
  if (parsed === null) return send(res, 'invalid_request');
  if (parsed.error) return send(res, parsed.error);

  if (!(await ipLimit(req, res, { endpoint: ENDPOINT }))) return;
  const token = bearerToken(req);
  if (!token) return send(res, 'authentication_required');
  const admin = deps.admin ?? createAdmin();
  if (!admin) return send(res, 'media_unavailable');

  const user = await authenticate(admin, token);
  if (!user) return send(res, 'authentication_required');

  let access;
  try {
    access = await entitlement(admin, user.id);
  } catch {
    return send(res, 'entitlement_unavailable');
  }
  if (access.state === 'inactive') return send(res, 'subscription_required');
  if (access.state !== 'active') return send(res, 'entitlement_unavailable');

  if (!(await userLimit(res, { endpoint: ENDPOINT, userId: user.id, paid: false }))) return;

  let manifest;
  try {
    manifest = manifestReader();
  } catch {
    return send(res, 'media_unavailable');
  }
  const manifestItem = manifest.media[parsed.exerciseId];
  if (!manifestItem) return send(res, 'no_media');

  let row;
  try {
    row = await mediaRow(admin, parsed.exerciseId);
  } catch {
    return send(res, 'media_unavailable');
  }
  if (!row) return send(res, 'no_media');
  if (row.media_version !== manifestItem.mediaVersion
    || row.animation_path !== manifestItem.animationPath
    || row.thumbnail_path !== manifestItem.thumbnailPath) {
    return send(res, 'media_unavailable');
  }

  if (parsed.knownMediaVersion === row.media_version) {
    return res.status(200).json({
      exerciseId: parsed.exerciseId,
      mediaVersion: row.media_version,
      notModified: true,
    });
  }

  try {
    const storage = admin.storage.from(BUCKET);
    const [animationUrl, thumbnailUrl] = await Promise.all([
      signedUrl(storage, row.animation_path),
      signedUrl(storage, row.thumbnail_path),
    ]);
    const expiresAt = new Date((deps.now?.() ?? Date.now()) + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
    return res.status(200).json({
      exerciseId: parsed.exerciseId,
      mediaVersion: row.media_version,
      animationUrl,
      thumbnailUrl,
      expiresAt,
      notModified: false,
    });
  } catch {
    return send(res, 'media_unavailable');
  }
}

export async function exerciseMediaHandler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const cors = deps.applyCorsHeaders ?? applyCorsHeaders;
  const minimumVersion = deps.enforceMinimumVersion ?? enforceMinimumVersion;
  const allowedOrigin = cors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS' && allowedOrigin) return res.status(204).end();
  if (await minimumVersion(req, res)) return;

  try {
    return await handleExerciseMedia(req, res, deps);
  } catch (error) {
    const requestId = crypto.randomBytes(4).toString('hex');
    console.error('exercise-media unhandled', { requestId, message: error?.message });
    try {
      await (deps.reportError ?? reportError)(error, { endpoint: ENDPOINT, stage: 'unhandled', requestId });
    } catch {
      // Reporting must never replace the endpoint response.
    }
    if (res.headersSent) return res.end();
    return send(res, 'media_unavailable');
  }
}

export default function handler(req, res) {
  return exerciseMediaHandler(req, res);
}
