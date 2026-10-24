import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { enforceMinimumVersion } from './_appVersion.js';
import { applyCorsHeaders } from './_cors.js';
import { getAppConfig, enforceLibraryContentGate } from './_appConfig.js';
import { createAdmin } from './_entitlement.js';
import { checkIpAbuseLimit, checkUserMinuteLimit, LIMITS } from './_rateLimit.js';
import { reportError } from './_sentry.js';
import { authenticate, bearerToken, canonical, checkMediaEntitlement, exactKeys,
  EXERCISE_ID, isPlainObject, sendMediaError } from './_exerciseMediaShared.js';

const ENDPOINT = 'exercise-instructions';
const ARTIFACT_URL = new URL('../core/data/library-instructions.json', import.meta.url);
LIMITS[ENDPOINT] ??= { ...LIMITS['exercise-media'] };

export function readLibraryInstructions(read = () => readFileSync(ARTIFACT_URL, 'utf8')) {
  const artifact = JSON.parse(read());
  const keys = ['artifactVersion', 'recordCount', 'entries', 'sha256'];
  if (!exactKeys(artifact, keys) || !keys.every(key => Object.hasOwn(artifact, key))
    || artifact.artifactVersion !== 1 || !Number.isInteger(artifact.recordCount)
    || !isPlainObject(artifact.entries) || artifact.recordCount !== Object.keys(artifact.entries).length) {
    throw new Error('invalid Library instructions artifact');
  }
  const hashed = { artifactVersion: artifact.artifactVersion, recordCount: artifact.recordCount, entries: artifact.entries };
  if (createHash('sha256').update(canonical(hashed)).digest('hex') !== artifact.sha256) throw new Error('Library artifact hash mismatch');
  for (const [id, entry] of Object.entries(artifact.entries)) {
    if (!EXERCISE_ID.test(id) || !exactKeys(entry, ['instructions', 'instructionsSource', 'contentVersion'])
      || !Array.isArray(entry.instructions) || !entry.instructions.length
      || !entry.instructions.every(step => typeof step === 'string' && step.trim().length > 0)
      || !['vendor_pack', 'endopamin_reviewed'].includes(entry.instructionsSource)
      || !Number.isInteger(entry.contentVersion) || entry.contentVersion < 1) throw new Error('invalid Library instruction entry');
  }
  return artifact;
}

export async function handleExerciseInstructions(req, res, deps = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  const body = req.body;
  let field;
  if (!isPlainObject(body)) field = 'body';
  else if (!exactKeys(body, ['exerciseId'])) field = Object.keys(body).find(key => key !== 'exerciseId');
  else if (!Object.hasOwn(body, 'exerciseId') || typeof body.exerciseId !== 'string' || !EXERCISE_ID.test(body.exerciseId)) field = 'exerciseId';
  if (field !== undefined) return sendMediaError(res, 'invalid_request', { field });

  if (!(await (deps.checkIpAbuseLimit ?? checkIpAbuseLimit)(req, res, { endpoint: ENDPOINT }))) return;
  const token = bearerToken(req);
  if (!token) return sendMediaError(res, 'authentication_required');
  const admin = deps.admin ?? createAdmin();
  if (!admin) return sendMediaError(res, 'media_unavailable');
  const user = await authenticate(admin, token);
  if (!user) return sendMediaError(res, 'authentication_required');
  let config;
  try { config = await (deps.getAppConfig ?? getAppConfig)(admin, { now: deps.configNow }); }
  catch { config = { vendorContentEnabled: false, libraryEnabled: false }; }
  if (!enforceLibraryContentGate(config, res)) return;

  let access;
  try { access = await (deps.checkMediaEntitlement ?? checkMediaEntitlement)(admin, user.id); }
  catch { return sendMediaError(res, 'entitlement_unavailable'); }
  if (access?.state === 'inactive') return sendMediaError(res, 'subscription_required');
  if (access?.state !== 'active') return sendMediaError(res, 'entitlement_unavailable');
  if (!(await (deps.checkUserMinuteLimit ?? checkUserMinuteLimit)(res, { endpoint: ENDPOINT, userId: user.id, paid: false }))) return;

  let artifact;
  try { artifact = (deps.readLibraryInstructions ?? readLibraryInstructions)(); }
  catch { return sendMediaError(res, 'media_unavailable'); }
  const exerciseId = body.exerciseId;
  if (!Object.hasOwn(artifact.entries, exerciseId)) return res.status(200).json({ exerciseId, status: 'no_content' });
  const entry = artifact.entries[exerciseId];
  return res.status(200).json({ exerciseId, status: 'ok', instructions: entry.instructions,
    instructionsSource: entry.instructionsSource, contentVersion: entry.contentVersion });
}

export async function exerciseInstructionsHandler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const allowed = (deps.applyCorsHeaders ?? applyCorsHeaders)(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS' && allowed) return res.status(204).end();
  if (await (deps.enforceMinimumVersion ?? enforceMinimumVersion)(req, res)) return;
  try { return await handleExerciseInstructions(req, res, deps); }
  catch (error) {
    const requestId = randomBytes(4).toString('hex');
    try { await (deps.reportError ?? reportError)(error, { endpoint: ENDPOINT, stage: 'unhandled', requestId }); }
    catch { /* Reporting must not replace the endpoint response. */ }
    if (res.headersSent) return res.end();
    return sendMediaError(res, 'media_unavailable');
  }
}
