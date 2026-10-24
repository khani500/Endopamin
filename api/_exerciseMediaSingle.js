import crypto from 'node:crypto';
import { enforceMinimumVersion } from './_appVersion.js';
import { getAppConfig, enforceVendorContentGate } from './_appConfig.js';
import { applyCorsHeaders } from './_cors.js';
import { createAdmin } from './_entitlement.js';
import {
  authenticate,
  bearerToken,
  BUCKET,
  checkMediaEntitlement,
  EXERCISE_ID,
  hasOnlyKeys,
  readMediaManifest,
  sendMediaError,
  SIGNED_URL_TTL_SECONDS,
} from './_exerciseMediaShared.js';
import { checkIpAbuseLimit, checkUserMinuteLimit } from './_rateLimit.js';
import { reportError } from './_sentry.js';

const ENDPOINT = 'exercise-media';

function parseBody(body) {
  if (!hasOnlyKeys(body, ['exerciseId', 'knownMediaVersion'])) return null;
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
  if (parsed === null) return sendMediaError(res, 'invalid_request');
  if (parsed.error) return sendMediaError(res, parsed.error);

  if (!(await ipLimit(req, res, { endpoint: ENDPOINT }))) return;
  const token = bearerToken(req);
  if (!token) return sendMediaError(res, 'authentication_required');
  const admin = deps.admin ?? createAdmin();
  if (!admin) return sendMediaError(res, 'media_unavailable');

  const user = await authenticate(admin, token);
  if (!user) return sendMediaError(res, 'authentication_required');

  const configReader = deps.getAppConfig ?? getAppConfig;
  let config;
  try {
    config = await configReader(admin, { now: deps.configNow });
  } catch {
    config = { vendorContentEnabled: false, libraryEnabled: false };
  }
  if (!enforceVendorContentGate(config, res)) return;

  let access;
  try {
    access = await entitlement(admin, user.id);
  } catch {
    return sendMediaError(res, 'entitlement_unavailable');
  }
  if (access.state === 'inactive') return sendMediaError(res, 'subscription_required');
  if (access.state !== 'active') return sendMediaError(res, 'entitlement_unavailable');

  if (!(await userLimit(res, { endpoint: ENDPOINT, userId: user.id, paid: false }))) return;

  let manifest;
  try {
    manifest = manifestReader();
  } catch {
    return sendMediaError(res, 'media_unavailable');
  }
  const manifestItem = manifest.media[parsed.exerciseId];
  if (!manifestItem) return sendMediaError(res, 'no_media');

  let row;
  try {
    row = await mediaRow(admin, parsed.exerciseId);
  } catch {
    return sendMediaError(res, 'media_unavailable');
  }
  if (!row) return sendMediaError(res, 'no_media');
  if (row.media_version !== manifestItem.mediaVersion
    || row.animation_path !== manifestItem.animationPath
    || row.thumbnail_path !== manifestItem.thumbnailPath) {
    return sendMediaError(res, 'media_unavailable');
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
    return sendMediaError(res, 'media_unavailable');
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
    return sendMediaError(res, 'media_unavailable');
  }
}
