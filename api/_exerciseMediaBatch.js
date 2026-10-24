import crypto from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { enforceMinimumVersion } from './_appVersion.js';
import { enforceLibraryContentGate, getAppConfig } from './_appConfig.js';
import { applyCorsHeaders } from './_cors.js';
import { createAdmin } from './_entitlement.js';
import {
  authenticate,
  bearerToken,
  BUCKET,
  checkMediaEntitlement,
  exactKeys,
  EXERCISE_ID,
  isPlainObject,
  readMediaManifest,
  sendMediaError,
  SIGNED_URL_TTL_SECONDS,
} from './_exerciseMediaShared.js';
import {
  checkIpAbuseLimit,
  checkUserMinuteLimit,
  LIMITS,
  RATE_LIMIT_MESSAGES,
} from './_rateLimit.js';
import { reportError } from './_sentry.js';

const ENDPOINT = 'exercise-media-batch';
const MAX_EXERCISE_IDS = 50;
const MAX_RESPONSE_BYTES = 128 * 1024;

LIMITS[ENDPOINT] ??= { ipPerMinute: 60, userPerMinute: 10 };

let redis = null;
const itemLimiters = {};

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token, retry: { retries: 1 } });
  return redis;
}

function getItemLimiter(layer) {
  if (itemLimiters[layer]) return itemLimiters[layer];
  const client = getRedis();
  if (!client) return null;
  const limit = layer === 'ip' ? 1200 : 200;
  itemLimiters[layer] = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(limit, '60 s'),
    prefix: `rl:v2:${layer}:${ENDPOINT}:items`,
    timeout: 1500,
  });
  return itemLimiters[layer];
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

async function checkItemLimit(res, { layer, identifier, units }) {
  const limiter = getItemLimiter(layer);
  if (!limiter) return true;
  let result;
  try {
    result = await limiter.limit(String(identifier), { rate: units });
  } catch {
    console.warn(JSON.stringify({ event: 'ratelimit.limiter_unavailable', endpoint: ENDPOINT, layer: `${layer}_items` }));
    return true;
  }
  if (result.reason === 'timeout') {
    console.warn(JSON.stringify({ event: 'ratelimit.limiter_unavailable', endpoint: ENDPOINT, layer: `${layer}_items` }));
    return true;
  }
  if (result.success) return true;
  const retryAfter = Math.max(1, Math.ceil((Number(result.reset) - Date.now()) / 1000) || 1);
  res.setHeader('Retry-After', String(retryAfter));
  const error = RATE_LIMIT_MESSAGES.minute;
  res.status(429).json({ error, message: error, code: 'rate_limited' });
  return false;
}

export function checkBatchIpItemLimit(req, res, units) {
  return checkItemLimit(res, { layer: 'ip', identifier: clientIp(req), units });
}

export function checkBatchUserItemLimit(res, userId, units) {
  return checkItemLimit(res, { layer: 'user', identifier: userId, units });
}

function invalid(field) {
  return { error: 'invalid_request', field };
}

export function parseBatchBody(body) {
  if (!exactKeys(body, ['exerciseIds', 'knownMediaVersions'])) {
    if (isPlainObject(body)) {
      const extra = Object.keys(body).find((key) => !['exerciseIds', 'knownMediaVersions'].includes(key));
      if (extra) return invalid(extra);
    }
    return invalid('body');
  }
  if (!Object.hasOwn(body, 'exerciseIds') || !Array.isArray(body.exerciseIds)
    || body.exerciseIds.length < 1 || body.exerciseIds.length > MAX_EXERCISE_IDS) {
    return invalid('exerciseIds');
  }
  for (let index = 0; index < body.exerciseIds.length; index += 1) {
    if (typeof body.exerciseIds[index] !== 'string' || !EXERCISE_ID.test(body.exerciseIds[index])) {
      return invalid(`exerciseIds[${index}]`);
    }
  }

  const exerciseIds = [...new Set(body.exerciseIds)];
  const knownMediaVersions = body.knownMediaVersions ?? {};
  if (!isPlainObject(knownMediaVersions)) return invalid('knownMediaVersions');
  const requested = new Set(exerciseIds);
  for (const [key, value] of Object.entries(knownMediaVersions)) {
    const field = `knownMediaVersions.${key}`;
    if (!EXERCISE_ID.test(key) || !requested.has(key)) return invalid(field);
    if (!Number.isInteger(value) || value < 1) return invalid(field);
  }
  return { exerciseIds, knownMediaVersions };
}

async function activeRows(admin, exerciseIds) {
  if (exerciseIds.length === 0) return [];
  const result = await admin.from('exercise_media')
    .select('canonical_exercise_id,media_version,animation_path,thumbnail_path')
    .in('canonical_exercise_id', exerciseIds)
    .eq('active', true);
  if (result.error || !Array.isArray(result.data)) throw new Error('exercise_media batch read failed');
  return result.data;
}

function validatedRows(rows, manifest, requestedIds) {
  const requested = new Set(requestedIds);
  const byId = new Map();
  for (const row of rows) {
    const exerciseId = row?.canonical_exercise_id;
    const item = manifest.media[exerciseId];
    if (!requested.has(exerciseId) || !item || byId.has(exerciseId)
      || row.media_version !== item.mediaVersion
      || row.animation_path !== item.animationPath
      || row.thumbnail_path !== item.thumbnailPath) {
      throw new Error('exercise_media manifest mismatch');
    }
    byId.set(exerciseId, row);
  }
  return byId;
}

function signedUrlsByPath(result, paths) {
  if (result?.error || !Array.isArray(result?.data) || result.data.length !== paths.length) {
    throw new Error('media signing cardinality mismatch');
  }
  const expected = new Set(paths);
  if (expected.size !== paths.length) throw new Error('duplicate thumbnail paths');
  const byPath = new Map();
  for (const item of result.data) {
    if (!item || item.error || typeof item.path !== 'string' || !expected.has(item.path)
      || typeof item.signedUrl !== 'string' || item.signedUrl.length === 0 || byPath.has(item.path)) {
      throw new Error('invalid signed URL result');
    }
    byPath.set(item.path, item.signedUrl);
  }
  if (byPath.size !== paths.length) throw new Error('media signing path mismatch');
  return byPath;
}

export async function handleExerciseMediaBatch(req, res, deps = {}) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  const parsed = parseBatchBody(req.body);
  if (parsed.error) return sendMediaError(res, parsed.error, { field: parsed.field });

  const ipLimit = deps.checkIpAbuseLimit ?? checkIpAbuseLimit;
  if (!(await ipLimit(req, res, { endpoint: ENDPOINT }))) return;
  const ipItems = deps.checkBatchIpItemLimit ?? checkBatchIpItemLimit;
  if (!(await ipItems(req, res, parsed.exerciseIds.length))) return;

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
  if (!enforceLibraryContentGate(config, res)) return;

  const entitlement = deps.checkMediaEntitlement ?? checkMediaEntitlement;
  let access;
  try {
    access = await entitlement(admin, user.id);
  } catch {
    return sendMediaError(res, 'entitlement_unavailable');
  }
  if (access.state === 'inactive') return sendMediaError(res, 'subscription_required');
  if (access.state !== 'active') return sendMediaError(res, 'entitlement_unavailable');

  const userLimit = deps.checkUserMinuteLimit ?? checkUserMinuteLimit;
  if (!(await userLimit(res, { endpoint: ENDPOINT, userId: user.id, paid: false }))) return;
  const userItems = deps.checkBatchUserItemLimit ?? checkBatchUserItemLimit;
  if (!(await userItems(res, user.id, parsed.exerciseIds.length))) return;

  const manifestReader = deps.readMediaManifest ?? readMediaManifest;
  let manifest;
  try {
    manifest = manifestReader();
  } catch {
    return sendMediaError(res, 'media_unavailable');
  }
  const manifestIds = parsed.exerciseIds.filter((exerciseId) => Object.hasOwn(manifest.media, exerciseId));

  let rows;
  try {
    rows = await (deps.readActiveRows ?? activeRows)(admin, manifestIds);
  } catch {
    return sendMediaError(res, 'media_unavailable');
  }

  let rowsById;
  try {
    rowsById = validatedRows(rows, manifest, manifestIds);
  } catch {
    return sendMediaError(res, 'media_unavailable');
  }

  const pending = [];
  const items = parsed.exerciseIds.map((exerciseId) => {
    const row = rowsById.get(exerciseId);
    if (!row) return { exerciseId, status: 'no_media' };
    if (parsed.knownMediaVersions[exerciseId] === row.media_version) {
      return { exerciseId, status: 'notModified', mediaVersion: row.media_version };
    }
    const item = { exerciseId, status: 'ok', mediaVersion: row.media_version };
    pending.push({ item, path: row.thumbnail_path });
    return item;
  });

  if (pending.length > 0) {
    try {
      const paths = pending.map(({ path }) => path);
      const storage = admin.storage.from(BUCKET);
      const signed = await storage.createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      const urls = signedUrlsByPath(signed, paths);
      const expiresAt = new Date((deps.now?.() ?? Date.now()) + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
      for (const entry of pending) {
        entry.item.thumbnailUrl = urls.get(entry.path);
        entry.item.expiresAt = expiresAt;
      }
    } catch {
      return sendMediaError(res, 'media_unavailable');
    }
  }

  const body = { items };
  const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (bytes > MAX_RESPONSE_BYTES) {
    console.error('exercise-media-batch response ceiling exceeded', { bytes });
    return sendMediaError(res, 'media_unavailable');
  }
  return res.status(200).json(body);
}

export async function exerciseMediaBatchHandler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const cors = deps.applyCorsHeaders ?? applyCorsHeaders;
  const minimumVersion = deps.enforceMinimumVersion ?? enforceMinimumVersion;
  const allowedOrigin = cors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS' && allowedOrigin) return res.status(204).end();
  if (await minimumVersion(req, res)) return;

  try {
    return await handleExerciseMediaBatch(req, res, deps);
  } catch (error) {
    const requestId = crypto.randomBytes(4).toString('hex');
    console.error('exercise-media-batch unhandled', { requestId, message: error?.message });
    try {
      await (deps.reportError ?? reportError)(error, { endpoint: ENDPOINT, stage: 'unhandled', requestId });
    } catch {
      // Reporting must never replace the endpoint response.
    }
    if (res.headersSent) return res.end();
    return sendMediaError(res, 'media_unavailable');
  }
}
