import crypto from 'node:crypto';
import { enforceMinimumVersion } from './_appVersion.js';
import { applyCorsHeaders } from './_cors.js';
import { createAdmin, missingEnv, reconcileUser } from './_entitlement.js';
import { checkIpAbuseLimit, checkUserMinuteLimit } from './_rateLimit.js';
import { reportError } from './_sentry.js';

const ENDPOINT = 'entitlement-sync';
const UNAVAILABLE = { code: 'entitlement_sync_unavailable' };

export async function handleRequest(req, res, requestId, deps = {}) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  // Rate limits fail open on a limiter outage; every check below still runs.
  if (!(await checkIpAbuseLimit(req, res, { endpoint: ENDPOINT, requestId }))) return;

  const missing = missingEnv();
  if (missing.length > 0) {
    await reportError(new Error(`Missing environment variables: ${missing.join(', ')}`), {
      endpoint: ENDPOINT, stage: 'config', requestId,
    });
    return res.status(503).json(UNAVAILABLE);
  }

  const admin = deps.admin || createAdmin();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token', requestId });
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired token', requestId });
  }
  // The user id comes ONLY from the token. The request body is never read.
  const userId = userData.user.id;

  if (!(await checkUserMinuteLimit(res, { endpoint: ENDPOINT, userId, requestId }))) return;

  const result = await reconcileUser(admin, userId, { source: 'app_sync' });
  if (!result.ok) {
    return res.status(503).json(UNAVAILABLE);
  }

  return res.status(200).json({ active: result.active, accessExpiresAt: result.accessExpiresAt });
}

export default async function handler(req, res) {
  const requestId = crypto.randomBytes(4).toString('hex');
  const allowedOrigin = applyCorsHeaders(req, res);

  try {
    if (req.method === 'OPTIONS' && allowedOrigin) {
      return res.status(204).end();
    }
    if (await enforceMinimumVersion(req, res)) return;

    return await handleRequest(req, res, requestId);
  } catch (err) {
    console.error('entitlement-sync unhandled', { requestId, message: err?.message, stack: err?.stack });
    try {
      await reportError(err, { endpoint: ENDPOINT, stage: 'unhandled', requestId });
    } catch {
      // Error reporting must never replace the endpoint's own response.
    }

    if (res.headersSent) return res.end();
    return res.status(503).json(UNAVAILABLE);
  }
}
