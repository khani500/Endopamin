import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { enforceMinimumVersion, readClientVersion } from './_appVersion.js';
import { applyCorsHeaders } from './_cors.js';
import { enforceEntitlement } from './_entitlementGate.js';
import { checkIpAbuseLimit, checkUserMinuteLimit } from './_rateLimit.js';
import { reportError, reportMessage } from './_sentry.js';
import { classifyStoredAge } from '../src/lib/adultAge.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '256kb',
    },
  },
};

const MAX_BODY_BYTES = 256 * 1024;

// Keep all five ids: live rows and saves still carry legacy personas.
const COACH_IDS = new Set(['aria', 'kane', 'blaze', 'nova', 'zara']);
const PLAN_TYPES = new Set(['weekly']);
const GENDERS = new Set(['male', 'female']);

const WEEK_START_MIN_DAYS = -14;
const WEEK_START_MAX_DAYS = 60;
const WEEK_NUMBER_MIN = 1;
const WEEK_NUMBER_MAX = 520;
const DAYS_PER_PLAN = 7;
const MAX_EXERCISES_PER_DAY = 20;
const MAX_EXERCISES_TOTAL = 100;
const MAX_EXERCISE_NAME_CHARS = 120;
const MAX_TEXT_CHARS = 200;

// Day i of a stored plan is exactly PLAN_WEEK_DAYS[i] (after trim, case-sensitive).
export const PLAN_WEEK_DAYS = Object.freeze([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);
const DAY_TYPES = new Set(['training', 'rest']);
const DAYS_PER_WEEK_MIN = 1;
const DAYS_PER_WEEK_MAX = 7;

export const PLAN_STRUCTURE_INVALID = 'plan_structure_invalid';
export const DAYS_PER_WEEK_UNAVAILABLE = 'days_per_week_unavailable';
const PLAN_STRUCTURE_INVALID_MESSAGE = 'Workout plan structure is invalid';
const DAYS_PER_WEEK_UNAVAILABLE_MESSAGE = 'Profile training days per week is unavailable';
// Fixed console / Sentry literal for every structure or days_per_week 422.
// Never interpolate this string.
export const STRUCTURE_REJECTED_EVENT = 'replace-plans structure-rejected';

const ALLOWED_TOP_LEVEL = new Set([
  'clientAttemptId',
  'coachId',
  'planSchemaVersion',
  'planType',
  'weekStart',
  'weekNumber',
  'activateOn',
  'workoutPlan',
  'nutritionPlan',
  'expectedSafetyFingerprint',
  'operation',
]);

// The client's declared intent for this save. The RPC proves it under its
// per-user lock (migration C); the endpoint only checks the spelling.
export const PLAN_OPERATIONS = new Set([
  'initial_setup',
  'feedback_adjustment',
  'safety_regeneration',
]);
// Greppable log / Sentry tag when the client sent no operation.
export const PLAN_OPERATION_ABSENT = 'legacy';

// Server-computed next allowed adjustment time, from the RPC's 45414 DETAIL.
const ISO_UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// Optimistic concurrency token: the profiles.safety_fingerprint the client
// read with the profile it generated the plan from. The RPC compares it with
// the current value and never stores it; the plan stores the value it reads.
const SAFETY_FINGERPRINT_RE = /^v1:[0-9a-f]{64}$/;

// First versioned-client signal only. Absence keeps current behavior.
// S1 does not switch validation on this value.
export const PLAN_SCHEMA_VERSION = 1;
// Greppable success-log / Sentry tag when the client omitted planSchemaVersion.
export const PLAN_SCHEMA_VERSION_ABSENT = 'legacy';

// Any of these in the body means the caller misunderstood the contract: the
// owner is taken only from the verified token. Presence is an error, not
// something to ignore.
const FORBIDDEN_OWNER_KEYS = ['userId', 'user_id', 'ownerId', 'owner_id', 'uid'];

const ALLOWED_DAY_KEYS = new Set(['day', 'type', 'focus', 'exercises']);
const ALLOWED_EXERCISE_KEYS = new Set([
  'name', 'sets', 'reps', 'rest', 'notes', 'muscle', 'equipment', 'exerciseId',
]);
const MAX_EXERCISE_ID_CHARS = 80;
const EXERCISE_ID_RE = /^(fx|gx)_[0-9a-z_]+$/;

// Stable first-token so Vercel logs can filter this later.
// Also the fixed Sentry captureMessage literal (at most one event per request).
export const UNKNOWN_EXERCISE_KEY_EVENT = 'replace-plans unknown-exercise-key';
export const UNKNOWN_EXERCISE_KEY_NAME_CAP = 8;
export const UNKNOWN_EXERCISE_KEY_NAME_MAX = 40;
// Durable Sentry captureMessage literal for the contract-version success
// signal. One info event per successful request. Never interpolate this string.
export const PLAN_SAVE_OK_EVENT = 'replace-plans ok';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function badRequest(field, message, code) {
  return { error: { status: 400, field, message, ...(code ? { code } : {}) } };
}

// A structure refusal names the rule and the field path only, never content.
function structureError(field, reason) {
  return {
    error: {
      status: 422,
      field,
      message: PLAN_STRUCTURE_INVALID_MESSAGE,
      code: PLAN_STRUCTURE_INVALID,
      reason,
    },
  };
}

// Parses an ISO date as UTC midnight and confirms the round trip, so
// '2026-02-31' is rejected rather than rolled forward.
function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  if (d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

function dayOffset(date, todayUtcMidnightMs) {
  return Math.round((date.getTime() - todayUtcMidnightMs) / 86400000);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function validateExerciseId(value, field) {
  if (typeof value !== 'string') {
    return badRequest(field, 'Must be a string');
  }
  if (value.length > MAX_EXERCISE_ID_CHARS) {
    return badRequest(field, 'Too long');
  }
  // Exact match only: no trim, lowercase, or other repair.
  if (value !== value.trim() || !EXERCISE_ID_RE.test(value)) {
    return badRequest(field, 'Must be a canonical exercise id');
  }
  return { value };
}

function validateWorkoutPlan(plan) {
  if (!isPlainObject(plan)) return badRequest('workoutPlan', 'Must be an object');
  if (!Array.isArray(plan.days)) return badRequest('workoutPlan.days', 'Must be an array');
  if (plan.days.length !== DAYS_PER_PLAN) {
    return badRequest('workoutPlan.days', `Must contain exactly ${DAYS_PER_PLAN} days`);
  }
  if ('resolution' in plan) {
    return badRequest('workoutPlan.resolution', 'Server-owned; must not be supplied');
  }

  const days = [];
  let total = 0;
  let trainingDays = 0;
  const unknownExerciseKeys = [];
  const seenUnknown = new Set();

  for (let d = 0; d < plan.days.length; d += 1) {
    const raw = plan.days[d];
    if (!isPlainObject(raw)) return badRequest(`workoutPlan.days[${d}]`, 'Must be an object');

    for (const key of Object.keys(raw)) {
      if (!ALLOWED_DAY_KEYS.has(key)) {
        return badRequest(`workoutPlan.days[${d}].${key}`, 'Unknown field');
      }
    }

    const day = cleanText(raw.day, MAX_TEXT_CHARS);
    if (day === null) return badRequest(`workoutPlan.days[${d}].day`, 'Must be a non-empty string');
    if (day !== PLAN_WEEK_DAYS[d]) return structureError(`workoutPlan.days[${d}].day`, 'day-name');
    const type = cleanText(raw.type, MAX_TEXT_CHARS);
    if (type === null) return badRequest(`workoutPlan.days[${d}].type`, 'Must be a non-empty string');
    if (!DAY_TYPES.has(type)) return structureError(`workoutPlan.days[${d}].type`, 'day-type');
    const focus = cleanText(raw.focus, MAX_TEXT_CHARS);
    if (focus === null) return badRequest(`workoutPlan.days[${d}].focus`, 'Must be a non-empty string');

    if (!Array.isArray(raw.exercises)) {
      return badRequest(`workoutPlan.days[${d}].exercises`, 'Must be an array');
    }
    // A rest day may carry zero or more exercises. A training day needs at
    // least one; every exercise below must have a non-empty name.
    if (type === 'training') {
      if (raw.exercises.length === 0) {
        return structureError(`workoutPlan.days[${d}].exercises`, 'empty-training-day');
      }
      trainingDays += 1;
    }
    if (raw.exercises.length > MAX_EXERCISES_PER_DAY) {
      return badRequest(
        `workoutPlan.days[${d}].exercises`,
        `At most ${MAX_EXERCISES_PER_DAY} exercises per day`,
      );
    }

    total += raw.exercises.length;
    if (total > MAX_EXERCISES_TOTAL) {
      return badRequest('workoutPlan.days', `At most ${MAX_EXERCISES_TOTAL} exercises in total`);
    }

    const exercises = [];
    for (let e = 0; e < raw.exercises.length; e += 1) {
      const src = raw.exercises[e];
      const where = `workoutPlan.days[${d}].exercises[${e}]`;
      if (!isPlainObject(src)) return badRequest(where, 'Must be an object');

      const name = cleanText(src.name, MAX_EXERCISE_NAME_CHARS);
      if (name === null) {
        return badRequest(`${where}.name`, `Must be a non-empty string of at most ${MAX_EXERCISE_NAME_CHARS} characters`);
      }
      if ('resolution' in src) {
        return badRequest(`${where}.resolution`, 'Server-owned; must not be supplied');
      }

      // Unknown fields are dropped rather than stored: unbounded jsonb written
      // from a client is an injection surface into every future reader.
      // S1 still drops them (no 400). A structured diagnostic is recorded so
      // later fail-closed can be decided from logs rather than guesswork.
      const kept = { name };
      for (const key of Object.keys(src)) {
        if (key === 'name') continue;
        if (!ALLOWED_EXERCISE_KEYS.has(key)) {
          const field = `${where}.${key}`;
          if (!seenUnknown.has(field)) {
            seenUnknown.add(field);
            unknownExerciseKeys.push({ field, key });
          }
          continue;
        }
        if (key === 'exerciseId') {
          const id = validateExerciseId(src.exerciseId, `${where}.exerciseId`);
          if (id.error) return id;
          kept.exerciseId = src.exerciseId;
          continue;
        }
        const v = src[key];
        if (typeof v === 'string') {
          const t = v.trim();
          if (t.length > MAX_TEXT_CHARS) return badRequest(`${where}.${key}`, 'Too long');
          if (t) kept[key] = t;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          kept[key] = v;
        } else if (v !== null && v !== undefined) {
          return badRequest(`${where}.${key}`, 'Must be a string or a number');
        }
      }
      exercises.push(kept);
    }

    days.push({ day, type, focus, exercises });
  }

  return { value: { days }, unknownExerciseKeys, trainingDays };
}

function validateNutritionPlan(plan) {
  if (!isPlainObject(plan)) return badRequest('nutritionPlan', 'Must be an object');
  if ('resolution' in plan) {
    return badRequest('nutritionPlan.resolution', 'Server-owned; must not be supplied');
  }
  const keys = Object.keys(plan);
  if (keys.length === 0) return badRequest('nutritionPlan', 'Must not be empty');
  if (keys.length > 32) return badRequest('nutritionPlan', 'Too many fields');
  return { value: plan };
}

// Exported for tests. Pure: no I/O, no clock of its own.
export function validatePlanRequest(body, now = new Date()) {
  if (!isPlainObject(body)) return badRequest('body', 'Must be a JSON object');

  for (const key of FORBIDDEN_OWNER_KEYS) {
    if (key in body) {
      return badRequest(key, 'Owner id must not be sent; it is taken from the access token');
    }
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) return badRequest(key, 'Unknown field');
  }

  if (!UUID_RE.test(String(body.clientAttemptId ?? ''))) {
    return badRequest('clientAttemptId', 'Must be an RFC 4122 UUID');
  }
  if (!COACH_IDS.has(body.coachId)) {
    return badRequest('coachId', `Must be one of: ${[...COACH_IDS].join(', ')}`);
  }
  if (!PLAN_TYPES.has(body.planType)) {
    return badRequest('planType', `Must be one of: ${[...PLAN_TYPES].join(', ')}`);
  }

  const todayMs = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

  const weekStart = parseIsoDate(body.weekStart);
  if (!weekStart) return badRequest('weekStart', 'Must be an ISO date (YYYY-MM-DD)');
  const wsOffset = dayOffset(weekStart, todayMs);
  if (wsOffset < WEEK_START_MIN_DAYS || wsOffset > WEEK_START_MAX_DAYS) {
    return badRequest(
      'weekStart',
      `Must be between ${WEEK_START_MIN_DAYS} and +${WEEK_START_MAX_DAYS} days from today`,
    );
  }

  if (!Number.isInteger(body.weekNumber)
      || body.weekNumber < WEEK_NUMBER_MIN
      || body.weekNumber > WEEK_NUMBER_MAX) {
    return badRequest('weekNumber', `Must be an integer between ${WEEK_NUMBER_MIN} and ${WEEK_NUMBER_MAX}`);
  }

  let activateOn = null;
  if (body.activateOn !== undefined && body.activateOn !== null) {
    const parsed = parseIsoDate(body.activateOn);
    if (!parsed) return badRequest('activateOn', 'Must be an ISO date (YYYY-MM-DD) or null');
    const offset = dayOffset(parsed, todayMs);
    if (offset < WEEK_START_MIN_DAYS || offset > WEEK_START_MAX_DAYS) {
      return badRequest(
        'activateOn',
        `Must be between ${WEEK_START_MIN_DAYS} and +${WEEK_START_MAX_DAYS} days from today`,
      );
    }
    activateOn = body.activateOn;
  }

  let planSchemaVersion;
  if ('planSchemaVersion' in body) {
    if (!Number.isInteger(body.planSchemaVersion) || body.planSchemaVersion !== PLAN_SCHEMA_VERSION) {
      return badRequest('planSchemaVersion', `Must be the integer ${PLAN_SCHEMA_VERSION}`);
    }
    planSchemaVersion = body.planSchemaVersion;
  }

  // Required on fresh saves and replays. Validate intent before the token.
  if (typeof body.operation !== 'string' || !PLAN_OPERATIONS.has(body.operation)) {
    return badRequest('operation', `Must be one of: ${[...PLAN_OPERATIONS].join(', ')}`, 'invalid_operation');
  }
  const operation = body.operation;

  if (typeof body.expectedSafetyFingerprint !== 'string'
      || !SAFETY_FINGERPRINT_RE.test(body.expectedSafetyFingerprint)) {
    return badRequest('expectedSafetyFingerprint', 'Must match ^v1:[0-9a-f]{64}$', 'invalid_safety_fingerprint');
  }
  const expectedSafetyFingerprint = body.expectedSafetyFingerprint;

  const workout = validateWorkoutPlan(body.workoutPlan);
  if (workout.error) return workout;

  let nutrition = null;
  if (body.nutritionPlan !== undefined && body.nutritionPlan !== null) {
    const result = validateNutritionPlan(body.nutritionPlan);
    if (result.error) return result;
    nutrition = result.value;
  }

  return {
    value: {
      clientAttemptId: body.clientAttemptId,
      coachId: body.coachId,
      planType: body.planType,
      weekStart: body.weekStart,
      weekNumber: body.weekNumber,
      activateOn,
      workoutPlan: workout.value,
      nutritionPlan: nutrition,
      expectedSafetyFingerprint,
      operation,
    },
    // Signal + diagnostics only. Never copied into workoutPlan or RPC args.
    planSchemaVersion,
    unknownExerciseKeys: workout.unknownExerciseKeys,
    // Compared with the profile's days_per_week by the handler, not here.
    trainingDays: workout.trainingDays,
  };
}

// Exported for tests. Pure. Null when the plan's training-day count matches
// the profile, otherwise the 422 error for the handler to send.
export function checkDaysPerWeek(daysPerWeek, trainingDays) {
  if (daysPerWeek === null || daysPerWeek === undefined) {
    return {
      error: {
        status: 422, code: DAYS_PER_WEEK_UNAVAILABLE, reason: 'missing', field: 'days_per_week',
      },
    };
  }
  if (!Number.isInteger(daysPerWeek)
      || daysPerWeek < DAYS_PER_WEEK_MIN
      || daysPerWeek > DAYS_PER_WEEK_MAX) {
    return {
      error: {
        status: 422, code: DAYS_PER_WEEK_UNAVAILABLE, reason: 'invalid', field: 'days_per_week',
      },
    };
  }
  if (trainingDays !== daysPerWeek) return structureError('workoutPlan.days', 'training-count');
  return null;
}

// The 45414 DETAIL, only when it is a real ISO-8601 UTC timestamp. Returned
// as sent; anything else is null and the caller omits it.
export function parseNextAvailableAt(details) {
  if (typeof details !== 'string' || !ISO_UTC_TIMESTAMP_RE.test(details)) return null;
  const ms = Date.parse(details);
  if (!Number.isFinite(ms)) return null;
  // Round trip to the second, so '2026-02-31T…' is rejected, not rolled over.
  if (new Date(ms).toISOString().slice(0, 19) !== details.slice(0, 19)) return null;
  return details;
}

// Exported for tests. Takes the RPC error (or its SQLSTATE alone). A mapped
// `code` replaces the SQLSTATE in the response body; mappings without one
// keep returning the SQLSTATE as before. None of these is ever a 429: the app
// retries 429s, and none of these refusals goes away on a retry.
export function mapRpcError(errorOrCode) {
  const isError = typeof errorOrCode === 'object' && errorOrCode !== null;
  const code = isError ? errorOrCode.code : errorOrCode;
  switch (code) {
    case '45414': {
      const mapped = {
        status: 409,
        code: 'plan_adjustment_cooldown',
        error: 'Plan adjustment not available yet',
      };
      const nextAvailableAt = parseNextAvailableAt(isError ? errorOrCode.details : null);
      if (nextAvailableAt) mapped.nextAvailableAt = nextAvailableAt;
      return mapped;
    }
    case '45415': return {
      status: 409,
      code: 'plan_operation_not_allowed',
      error: 'This plan change is not allowed right now',
    };
    case '22023': return {
      status: 400,
      code: 'invalid_operation',
      error: 'Unknown operation',
      field: 'operation',
    };
    case '45416': return {
      status: 400,
      code: 'invalid_safety_fingerprint',
      error: 'Invalid safety fingerprint',
      field: 'expectedSafetyFingerprint',
    };
    case '45409': return { status: 409, error: 'Idempotency key reused with a different request shape' };
    case '45410': return { status: 409, error: 'Idempotency key already used by another write path' };
    case '45404': return { status: 401, error: 'Invalid or expired token' };
    case '22004': return { status: 400, error: 'Owner id and attempt id are required' };
    case '45413': return {
      status: 409,
      code: 'safety_profile_changed',
      error: 'Your profile changed while this plan was being built',
    };
    case '45412': return {
      status: 422,
      code: 'safety_fingerprint_unavailable',
      error: 'Profile safety data is unavailable',
    };
    default: return null;
  }
}

// The RPC can commit and still look like a failure (no return row, a
// transport error, a timeout). Both plan tables have a partial unique
// index on (user_id, client_attempt_id), so this read is at most one
// row per table. Returns the success body, or null to keep the original 500.
async function reconcilePlanWrite(admin, {
  userId, attemptId, requestId, reason, nutritionExpected,
}) {
  let workout;
  let nutrition;
  try {
    workout = await admin
      .from('workout_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('client_attempt_id', attemptId)
      .maybeSingle();

    if (workout.error) {
      console.error('replace-plans reconcile failed', {
        requestId,
        userId,
        attemptId,
        reason,
        table: 'workout_plans',
        code: workout.error.code ?? null,
        message: workout.error.message ?? null,
      });
      return null;
    }

    nutrition = await admin
      .from('nutrition_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('client_attempt_id', attemptId)
      .maybeSingle();

    if (nutrition.error) {
      console.error('replace-plans reconcile failed', {
        requestId,
        userId,
        attemptId,
        reason,
        table: 'nutrition_plans',
        code: nutrition.error.code ?? null,
        message: nutrition.error.message ?? null,
      });
      return null;
    }
  } catch (err) {
    console.error('replace-plans reconcile failed', {
      requestId,
      userId,
      attemptId,
      reason,
      message: err?.message ?? null,
    });
    return null;
  }

  const workoutPlanId = workout.data?.id ?? null;
  const nutritionPlanId = nutrition.data?.id ?? null;
  if (!workoutPlanId) return null;

  // Workout-only writes leave nutrition absent. A requested nutrition row
  // missing after a landed workout write is still returned as null rather
  // than 500: the RPC is one transaction, and a 500 here is the false
  // failure this read exists to close.
  console.warn('replace-plans reconciled', {
    requestId,
    userId,
    attemptId,
    reason,
    workoutPlanId,
    nutritionPlanId,
    nutritionExpected: nutritionExpected === true,
  });

  return {
    workoutPlanId,
    nutritionPlanId: nutritionPlanId ?? null,
    replayed: false,
  };
}

function createAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function schemaVersionMarker(planSchemaVersion) {
  return planSchemaVersion === undefined ? PLAN_SCHEMA_VERSION_ABSENT : planSchemaVersion;
}

function operationMarker(operation) {
  return operation ?? PLAN_OPERATION_ABSENT;
}

// A replay is a pure read in the RPC and ignores the declared operation. A
// different stored label means the client reused an attempt id across
// operations; record it and change nothing. Never throws.
async function warnOnReplayOperationMismatch(admin, {
  requestId, userId, workoutPlanId, declared,
}) {
  try {
    const { data, error } = await admin
      .from('workout_plans')
      .select('operation')
      .eq('id', workoutPlanId)
      .maybeSingle();
    if (error) {
      console.warn('replace-plans replay operation read failed', {
        requestId, userId, code: error.code ?? null,
      });
      return;
    }
    const stored = data?.operation ?? null;
    if (stored !== declared) {
      console.warn('replace-plans replay operation mismatch', {
        requestId, userId, declared, stored,
      });
    }
  } catch (err) {
    console.warn('replace-plans replay operation read failed', {
      requestId, userId, message: err?.message ?? null,
    });
  }
}

function logUnknownExerciseKeys(requestId, unknownExerciseKeys, planSchemaVersion) {
  if (!unknownExerciseKeys?.length) return;
  for (const entry of unknownExerciseKeys) {
    const payload = {
      requestId,
      field: entry.field,
      key: entry.key,
    };
    if (planSchemaVersion !== undefined) payload.planSchemaVersion = planSchemaVersion;
    console.warn(UNKNOWN_EXERCISE_KEY_EVENT, payload);
  }
}

// One Sentry message per request. Key names only: no values, field paths, or body.
async function reportUnknownExerciseKeys(unknownExerciseKeys, planSchemaVersion) {
  if (!unknownExerciseKeys?.length) return;

  const seen = new Set();
  const distinct = [];
  for (const entry of unknownExerciseKeys) {
    const raw = typeof entry.key === 'string' ? entry.key : '';
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    distinct.push(raw);
  }

  const reportedKeys = distinct
    .slice(0, UNKNOWN_EXERCISE_KEY_NAME_CAP)
    .map((key) => key.slice(0, UNKNOWN_EXERCISE_KEY_NAME_MAX));

  await reportMessage(
    UNKNOWN_EXERCISE_KEY_EVENT,
    'warning',
    {
      unknownKeyCount: distinct.length,
      planSchemaVersion: schemaVersionMarker(planSchemaVersion),
    },
    {
      unknownKeys: reportedKeys,
    },
  );
}

const CLIENT_PLATFORMS = new Set(['ios', 'android']);
const CLIENT_VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,3}$/;

// Client headers are untrusted: only a known platform or a plain dotted
// version is logged; anything else (or absence) is 'unknown'.
function clientTags(req) {
  const { platform, version } = readClientVersion(req);
  return {
    platform: CLIENT_PLATFORMS.has(platform) ? platform : 'unknown',
    appVersion: typeof version === 'string' && CLIENT_VERSION_RE.test(version) ? version : 'unknown',
  };
}

// The one response path for every structure / days_per_week 422. Logs the
// rule and field path only: no user id, exercise names, or plan content.
async function sendStructureRejection(req, res, requestId, error) {
  const { platform, appVersion } = clientTags(req);
  console.warn(STRUCTURE_REJECTED_EVENT, {
    requestId, code: error.code, reason: error.reason, field: error.field, platform, appVersion,
  });
  await reportMessage(STRUCTURE_REJECTED_EVENT, 'warning', {
    code: error.code, reason: error.reason, platform, appVersion,
  });

  if (error.code === DAYS_PER_WEEK_UNAVAILABLE) {
    return res.status(error.status).json({
      error: DAYS_PER_WEEK_UNAVAILABLE_MESSAGE,
      code: error.code,
      fields: { days_per_week: error.reason },
      requestId,
    });
  }
  return res.status(error.status).json({
    error: error.message,
    code: error.code,
    reason: error.reason,
    field: error.field,
    requestId,
  });
}

// True only when this user already saved this attempt: the RPC's replay
// branch then returns the prior result, so the profile-dependent checks are
// skipped. A read error or throw is false (the checks run: fail closed).
async function attemptAlreadySaved(admin, { userId, attemptId, requestId }) {
  try {
    const { data, error } = await admin
      .from('workout_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('client_attempt_id', attemptId)
      .maybeSingle();
    if (error) {
      console.warn('replace-plans attempt lookup failed', { requestId, code: error.code ?? null });
      return false;
    }
    return Boolean(data?.id);
  } catch (err) {
    console.warn('replace-plans attempt lookup failed', { requestId, message: err?.message ?? null });
    return false;
  }
}

export async function handleRequest(req, res, requestId, deps = {}) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  // Rate limits fail open on a limiter outage; every check below still runs.
  if (!(await checkIpAbuseLimit(req, res, { endpoint: 'replace-plans', requestId }))) return;

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
  // The single source of the owner id. Nothing else may supply it.
  const userId = userData.user.id;

  if (!(await checkUserMinuteLimit(res, { endpoint: 'replace-plans', userId, requestId }))) return;
  if (await enforceEntitlement(req, res, {
    admin, userId, endpoint: 'replace-plans', requestId,
  })) return;

  const validated = validatePlanRequest(req.body);
  if (validated.error?.code === PLAN_STRUCTURE_INVALID) {
    return sendStructureRejection(req, res, requestId, validated.error);
  }
  if (validated.error) {
    return res.status(validated.error.status).json({
      error: validated.error.message,
      field: validated.error.field,
      ...(validated.error.code ? { code: validated.error.code } : {}),
      requestId,
    });
  }
  const input = validated.value;
  const requestPlanSchemaVersion = validated.planSchemaVersion;
  logUnknownExerciseKeys(requestId, validated.unknownExerciseKeys, requestPlanSchemaVersion);
  await reportUnknownExerciseKeys(validated.unknownExerciseKeys, requestPlanSchemaVersion);

  // gender is re-derived from the profile and the body value is ignored. Fail
  // closed rather than trusting client input: a client-controlled gender drives
  // a destructive archive path on read.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('gender, age, days_per_week')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    console.error('replace-plans profile read failed', {
      requestId,
      userId,
      code: profileErr.code,
      message: profileErr.message,
      details: profileErr.details,
      hint: profileErr.hint,
    });
    await reportError(profileErr, { endpoint: 'replace-plans', stage: 'profile-lookup', requestId });
    return res.status(500).json({ error: 'Could not read profile', requestId });
  }

  const gender = String(profile?.gender || '').toLowerCase();
  if (!GENDERS.has(gender)) {
    console.warn('replace-plans gender missing', { requestId, userId });
    return res.status(422).json({
      error: 'Profile gender is not set; complete your profile before generating a plan',
      requestId,
    });
  }

  const ageStatus = classifyStoredAge(profile?.age);
  if (ageStatus !== 'ok') {
    return res.status(422).json({
      error: 'Profile validation failed',
      code: 'age_ineligible',
      requestId,
      fields: { age: ageStatus },
    });
  }

  // The training-day count must match the profile, except for an attempt
  // this user already saved: its replay returns the stored plan unchanged.
  const alreadySaved = await attemptAlreadySaved(admin, {
    userId, attemptId: input.clientAttemptId, requestId,
  });
  if (!alreadySaved) {
    const countError = checkDaysPerWeek(profile?.days_per_week, validated.trainingDays);
    if (countError) return sendStructureRejection(req, res, requestId, countError.error);
  }

  const workoutPlanData = { coachId: input.coachId, days: input.workoutPlan.days, gender };

  // p_operation exists only after migration C
  // (20261002120000_plan_operation_cooldown.sql), which is applied. This
  // endpoint must never be deployed against the migration A catalog: there
  // this named argument matches no signature and every save fails.
  // p_expected_safety_fingerprint and p_operation are required and validated
  // before reaching the RPC, including on replay requests.
  const rpcArgs = {
    p_user_id: userId,
    p_client_attempt_id: input.clientAttemptId,
    p_workout_coach_id: input.coachId,
    p_workout_plan_type: input.planType,
    p_workout_week_start: input.weekStart,
    p_workout_week_number: input.weekNumber,
    p_workout_activate_on: input.activateOn,
    p_workout_plan_data: workoutPlanData,
    p_nutrition_plan_data: input.nutritionPlan,
    p_expected_safety_fingerprint: input.expectedSafetyFingerprint,
    p_operation: input.operation,
  };

  const reconcileArgs = {
    userId,
    attemptId: input.clientAttemptId,
    requestId,
    nutritionExpected: input.nutritionPlan != null,
  };

  let data;
  let error;
  try {
    ({ data, error } = await admin.rpc('replace_user_plans_atomic', rpcArgs));
  } catch (rpcThrown) {
    // supabase-js usually returns { error } for transport failures; a
    // thrown timeout after commit still has to be reconciled here or it
    // becomes the unhandled 500.
    const recovered = await reconcilePlanWrite(admin, {
      ...reconcileArgs,
      reason: 'rpc-thrown',
    });
    if (recovered) return res.status(200).json(recovered);
    throw rpcThrown;
  }

  if (error) {
    const mapped = mapRpcError(error);
    if (mapped) {
      console.warn('replace-plans mapped error', {
        requestId,
        userId,
        attemptId: input.clientAttemptId,
        code: error.code,
        status: mapped.status,
        operation: operationMarker(input.operation),
      });
      if (error.code === '45414' && !mapped.nextAvailableAt) {
        console.warn('replace-plans cooldown without a valid nextAvailableAt', {
          requestId,
          userId,
          details: typeof error.details === 'string' ? error.details.slice(0, 64) : null,
        });
      }
      // Mapped errors never reach the reconcile read, and never echo the SQL message.
      const payload = {
        error: mapped.error,
        code: mapped.code ?? error.code,
        requestId,
      };
      if (mapped.field) payload.field = mapped.field;
      if (mapped.nextAvailableAt) payload.nextAvailableAt = mapped.nextAvailableAt;
      return res.status(mapped.status).json(payload);
    }
    console.error('replace-plans rpc error', {
      requestId,
      userId,
      attemptId: input.clientAttemptId,
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
      constraint: error.constraint ?? null,
      table: error.table ?? null,
      column: error.column ?? null,
      schema: error.schema ?? null,
      operation: operationMarker(input.operation),
    });
    await reportError(error, {
      endpoint: 'replace-plans', stage: 'rpc', requestId, operation: operationMarker(input.operation),
    });
    const recovered = await reconcilePlanWrite(admin, {
      ...reconcileArgs,
      reason: 'rpc-error',
    });
    if (recovered) return res.status(200).json(recovered);
    return res.status(500).json({ error: 'Could not save plan', requestId });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.workout_plan_id) {
    console.error('replace-plans no row', { requestId, userId, attemptId: input.clientAttemptId });
    await reportError(new Error('replace_user_plans_atomic returned no row'), {
      endpoint: 'replace-plans', stage: 'rpc-result', requestId,
    });
    const recovered = await reconcilePlanWrite(admin, {
      ...reconcileArgs,
      reason: 'no-row',
    });
    if (recovered) return res.status(200).json(recovered);
    return res.status(500).json({ error: 'Could not save plan', requestId });
  }

  console.info('replace-plans ok', {
    requestId,
    userId,
    attemptId: input.clientAttemptId,
    planSchemaVersion: schemaVersionMarker(requestPlanSchemaVersion),
    operation: operationMarker(input.operation),
  });

  await reportMessage(
    PLAN_SAVE_OK_EVENT,
    'info',
    {
      planSchemaVersion: schemaVersionMarker(requestPlanSchemaVersion),
      operation: operationMarker(input.operation),
    },
    { requestId },
  );

  // Logging only: the response below is the same whatever this finds.
  if (row.replayed === true && input.operation !== null) {
    await warnOnReplayOperationMismatch(admin, {
      requestId, userId, workoutPlanId: row.workout_plan_id, declared: input.operation,
    });
  }

  return res.status(200).json({
    workoutPlanId: row.workout_plan_id,
    nutritionPlanId: row.nutrition_plan_id ?? null,
    replayed: row.replayed === true,
  });
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
    console.error('replace-plans unhandled', { requestId, message: err?.message, stack: err?.stack });
    try {
      await reportError(err, { endpoint: 'replace-plans', stage: 'unhandled', requestId });
    } catch {
      // Error reporting must never replace the endpoint's own 500 response.
    }

    if (res.headersSent) return res.end();
    return res.status(500).json({ error: 'Internal server error', requestId });
  }
}
