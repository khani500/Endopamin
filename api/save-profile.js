import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from './_cors.js';
import { checkRateLimit } from './_rateLimit.js';
import { reportError } from './_sentry.js';
import {
  validateAge,
  validateCoachPersona,
  validateDaysPerWeek,
  validateEquipment,
  validateExperience,
  validateGoal,
  validateHeight,
  validateHeightUnit,
  validateJobType,
  validateSessionDuration,
  validateTargetWeight,
  validateWeight,
  validateWeightUnit,
} from '../src/lib/profileValidation.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 500;
const PROVENANCE_SOURCE = 'save-profile';

const ALLOWED_TOP_LEVEL = new Set(['fields']);
const IGNORED_TOP_LEVEL = new Set(['provenance', 'field_provenance', 'source', 'state']);
const FORBIDDEN_OWNER_KEYS = ['userId', 'user_id', 'ownerId', 'owner_id', 'uid'];
const FORBIDDEN_WRITE_KEYS = new Set([
  'id',
  'is_pro',
  'stripe_customer_id',
  'stripe_subscription_id',
  'pro_expires_at',
  'dopa_level',
  'dopa_xp',
  'streak_count',
  'created_at',
  'onboarding_completed',
]);

export const CLEARABLE_FIELDS = Object.freeze([
  'age',
  'height',
  'weight',
  'target_weight',
  'injuries',
  'priority_muscle',
]);

const CLEARABLE = new Set(CLEARABLE_FIELDS);

const WRITABLE_FIELDS = Object.freeze([
  'age',
  'height',
  'height_unit',
  'weight',
  'weight_unit',
  'target_weight',
  'experience',
  'goal',
  'job_type',
  'coach_persona',
  'days_per_week',
  'session_duration',
  'equipment',
  'injuries',
  'priority_muscle',
]);

const WRITABLE = new Set(WRITABLE_FIELDS);
const INTENTS = new Set(['confirmed', 'cleared']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contractError(field, message) {
  return { error: { status: 400, field, message } };
}

function validationError(fields) {
  return {
    error: {
      status: 422,
      message: 'Profile validation failed',
      fields,
    },
  };
}

function validateText(value, field) {
  if (typeof value !== 'string') {
    return { valid: false, reason: `${field} must be a string` };
  }
  if (value.length > MAX_TEXT_CHARS) {
    return { valid: false, reason: `${field} must be at most ${MAX_TEXT_CHARS} characters` };
  }
  return { valid: true, value };
}

function containsNotLoaded(node) {
  if (Array.isArray(node)) return node.some(containsNotLoaded);
  if (!isPlainObject(node)) return false;
  return Object.entries(node).some(([key, value]) => {
    if ((key === 'intent' || key === 'state') && value === 'not_loaded') return true;
    return containsNotLoaded(value);
  });
}

function priorProvenance(existing) {
  return isPlainObject(existing?.field_provenance) ? { ...existing.field_provenance } : {};
}

function stamp(state, at) {
  return { state, at: at.toISOString(), source: PROVENANCE_SOURCE };
}

function overlayContext(fields, existing) {
  const ctx = {
    height_unit: existing?.height_unit,
    weight_unit: existing?.weight_unit,
    weight: existing?.weight,
    goal: existing?.goal,
  };

  const unit = fields.height_unit;
  if (unit?.intent === 'confirmed') {
    const result = validateHeightUnit(unit.value);
    if (result.valid && !result.absent) ctx.height_unit = result.value;
  }

  const weightUnit = fields.weight_unit;
  if (weightUnit?.intent === 'confirmed') {
    const result = validateWeightUnit(weightUnit.value);
    if (result.valid && !result.absent) ctx.weight_unit = result.value;
  }

  if (fields.weight?.intent === 'cleared') {
    ctx.weight = null;
  } else if (fields.weight?.intent === 'confirmed') {
    const result = validateWeight(fields.weight.value, ctx.weight_unit);
    if (result.valid && !result.absent) ctx.weight = result.value;
  }

  if (fields.goal?.intent === 'confirmed') {
    const result = validateGoal(fields.goal.value);
    if (result.valid && !result.absent) ctx.goal = result.value;
  }

  return ctx;
}

function validateConfirmed(field, value, ctx) {
  switch (field) {
    case 'age': return validateAge(value);
    case 'height': return validateHeight(value, ctx.height_unit);
    case 'height_unit': return validateHeightUnit(value);
    case 'weight': return validateWeight(value, ctx.weight_unit);
    case 'weight_unit': return validateWeightUnit(value);
    case 'target_weight':
      return validateTargetWeight(value, ctx.weight_unit, {
        weight: ctx.weight,
        goal: ctx.goal,
      });
    case 'experience': return validateExperience(value);
    case 'goal': return validateGoal(value);
    case 'job_type': return validateJobType(value);
    case 'coach_persona': return validateCoachPersona(value);
    case 'days_per_week': return validateDaysPerWeek(value);
    case 'session_duration': return validateSessionDuration(value);
    case 'equipment': return validateEquipment(value);
    case 'injuries': return validateText(value, 'injuries');
    case 'priority_muscle': return validateText(value, 'priority_muscle');
    default: return { valid: false, reason: `${field} is not writable` };
  }
}

// Exported for tests. Pure: no I/O. Derives provenance; never trusts a client state.
export function planProfileWrite(body, { existing = {}, now = new Date() } = {}) {
  if (!isPlainObject(body)) return contractError('body', 'Must be a JSON object');

  for (const key of FORBIDDEN_OWNER_KEYS) {
    if (key in body) {
      return contractError(key, 'Owner id must not be sent; it is taken from the access token');
    }
  }

  if (containsNotLoaded(body)) {
    return contractError('body', 'not_loaded is a client-side state and must not be sent');
  }

  for (const key of Object.keys(body)) {
    if (IGNORED_TOP_LEVEL.has(key)) continue;
    if (!ALLOWED_TOP_LEVEL.has(key)) return contractError(key, 'Unknown field');
  }

  if (!isPlainObject(body.fields)) {
    return contractError('fields', 'Must be an object');
  }

  const fields = body.fields;
  for (const name of Object.keys(fields)) {
    if (FORBIDDEN_WRITE_KEYS.has(name)) {
      return contractError(name, 'This column cannot be written through save-profile');
    }
    if (!WRITABLE.has(name)) return contractError(name, 'Unknown field');
    const entry = fields[name];
    if (!isPlainObject(entry)) return contractError(name, 'Must be an object with intent');
    if (!INTENTS.has(entry.intent)) {
      return contractError(`${name}.intent`, 'Must be confirmed or cleared');
    }
    if (entry.intent === 'cleared' && !CLEARABLE.has(name)) {
      return contractError(name, 'This field cannot be cleared');
    }
  }

  const ctx = overlayContext(fields, existing);
  const reasons = {};
  const patch = {};
  const written = {};
  const provenance = priorProvenance(existing);

  for (const name of Object.keys(fields)) {
    const entry = fields[name];
    if (entry.intent === 'cleared') {
      patch[name] = null;
      written[name] = { state: 'cleared' };
      provenance[name] = stamp('cleared', now);
      continue;
    }

    const result = validateConfirmed(name, entry.value, ctx);
    if (result.absent || !result.valid) {
      reasons[name] = result.reason || 'confirmed field must have a value';
      continue;
    }
    patch[name] = result.value;
    written[name] = { state: 'confirmed' };
    provenance[name] = stamp('confirmed', now);
  }

  if (Object.keys(reasons).length > 0) return validationError(reasons);
  if (Object.keys(written).length === 0) return { value: { patch: null, written: {} } };

  patch.field_provenance = provenance;
  return { value: { patch, written } };
}

function createAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function handleRequest(req, res, requestId, deps = {}) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  const allowed = await checkRateLimit(req, res, { name: 'save-profile', max: 10, windowSec: 60 });
  if (!allowed) return;

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large', maxBytes: MAX_BODY_BYTES, requestId });
  }

  const admin = deps.admin || createAdmin();
  if (!admin) {
    return res.status(500).json({ error: 'Server not configured', requestId });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token', requestId });
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired token', requestId });
  }
  const userId = userData.user.id;

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('field_provenance, height_unit, weight_unit, weight, goal')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    console.error('save-profile profile read failed', {
      requestId,
      userId,
      code: profileErr.code,
      message: profileErr.message,
    });
    await reportError(profileErr, { endpoint: 'save-profile', stage: 'profile-lookup', requestId });
    return res.status(500).json({ error: 'Could not read profile', requestId });
  }

  if (!profile) {
    return res.status(422).json({
      error: 'Profile is not set; complete your profile before saving',
      requestId,
    });
  }

  const planned = planProfileWrite(req.body, { existing: profile });
  if (planned.error) {
    const payload = {
      error: planned.error.message,
      requestId,
    };
    if (planned.error.field) payload.field = planned.error.field;
    if (planned.error.fields) payload.fields = planned.error.fields;
    return res.status(planned.error.status).json(payload);
  }

  if (!planned.value.patch) {
    return res.status(200).json({ written: {}, requestId });
  }

  const { error: updateErr } = await admin
    .from('profiles')
    .update(planned.value.patch)
    .eq('id', userId);

  if (updateErr) {
    console.error('save-profile update failed', {
      requestId,
      userId,
      code: updateErr.code,
      message: updateErr.message,
    });
    await reportError(updateErr, { endpoint: 'save-profile', stage: 'update', requestId });
    return res.status(500).json({ error: 'Could not save profile', requestId });
  }

  console.info('save-profile ok', { requestId, userId, written: Object.keys(planned.value.written) });

  return res.status(200).json({
    written: planned.value.written,
    requestId,
  });
}

export default async function handler(req, res) {
  const requestId = crypto.randomBytes(4).toString('hex');
  const allowedOrigin = applyCorsHeaders(req, res);

  try {
    if (req.method === 'OPTIONS' && allowedOrigin) {
      return res.status(204).end();
    }

    return await handleRequest(req, res, requestId);
  } catch (err) {
    console.error('save-profile unhandled', { requestId, message: err?.message, stack: err?.stack });
    try {
      await reportError(err, { endpoint: 'save-profile', stage: 'unhandled', requestId });
    } catch {
      // Error reporting must never replace the endpoint's own 500 response.
    }

    if (res.headersSent) return res.end();
    return res.status(500).json({ error: 'Internal server error', requestId });
  }
}
