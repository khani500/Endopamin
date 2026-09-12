import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './_rateLimit.js';
import { reportError } from './_sentry.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '256kb',
    },
  },
};

const MAX_BODY_BYTES = 256 * 1024;

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

const ALLOWED_TOP_LEVEL = new Set([
  'clientAttemptId',
  'coachId',
  'planType',
  'weekStart',
  'weekNumber',
  'activateOn',
  'workoutPlan',
  'nutritionPlan',
]);

// Any of these in the body means the caller misunderstood the contract: the
// owner is taken only from the verified token. Presence is an error, not
// something to ignore.
const FORBIDDEN_OWNER_KEYS = ['userId', 'user_id', 'ownerId', 'owner_id', 'uid'];

const ALLOWED_DAY_KEYS = new Set(['day', 'type', 'focus', 'exercises']);
const ALLOWED_EXERCISE_KEYS = new Set([
  'name', 'sets', 'reps', 'rest', 'notes', 'muscle', 'equipment',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function badRequest(field, message) {
  return { error: { status: 400, field, message } };
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
    const type = cleanText(raw.type, MAX_TEXT_CHARS);
    if (type === null) return badRequest(`workoutPlan.days[${d}].type`, 'Must be a non-empty string');
    const focus = cleanText(raw.focus, MAX_TEXT_CHARS);
    if (focus === null) return badRequest(`workoutPlan.days[${d}].focus`, 'Must be a non-empty string');

    if (!Array.isArray(raw.exercises)) {
      return badRequest(`workoutPlan.days[${d}].exercises`, 'Must be an array');
    }
    // A rest day is valid and may carry zero exercises. Emptiness is not an error.
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
      const kept = { name };
      for (const key of Object.keys(src)) {
        if (key === 'name' || !ALLOWED_EXERCISE_KEYS.has(key)) continue;
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

  return { value: { days } };
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
    },
  };
}

// Exported for tests.
export function mapRpcError(code) {
  switch (code) {
    case '45409': return { status: 409, error: 'Idempotency key reused with a different request shape' };
    case '45410': return { status: 409, error: 'Idempotency key already used by another write path' };
    case '45404': return { status: 401, error: 'Invalid or expired token' };
    case '22004': return { status: 400, error: 'Owner id and attempt id are required' };
    default: return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const allowed = await checkRateLimit(req, res, { name: 'replace-plans', max: 5, windowSec: 60 });
  if (!allowed) return;

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large', maxBytes: MAX_BODY_BYTES });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // The single source of the owner id. Nothing else may supply it.
  const userId = userData.user.id;

  const validated = validatePlanRequest(req.body);
  if (validated.error) {
    return res.status(validated.error.status).json({
      error: validated.error.message,
      field: validated.error.field,
    });
  }
  const input = validated.value;

  // gender is re-derived from the profile and the body value is ignored. Fail
  // closed rather than trusting client input: a client-controlled gender drives
  // a destructive archive path on read.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('gender')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    reportError(profileErr, { endpoint: 'replace-plans', stage: 'profile-lookup' });
    return res.status(500).json({ error: 'Could not read profile' });
  }

  const gender = String(profile?.gender || '').toLowerCase();
  if (!GENDERS.has(gender)) {
    return res.status(422).json({
      error: 'Profile gender is not set; complete your profile before generating a plan',
    });
  }

  const workoutPlanData = { coachId: input.coachId, days: input.workoutPlan.days, gender };

  const { data, error } = await admin.rpc('replace_user_plans_atomic', {
    p_user_id: userId,
    p_client_attempt_id: input.clientAttemptId,
    p_workout_coach_id: input.coachId,
    p_workout_plan_type: input.planType,
    p_workout_week_start: input.weekStart,
    p_workout_week_number: input.weekNumber,
    p_workout_activate_on: input.activateOn,
    p_workout_plan_data: workoutPlanData,
    p_nutrition_plan_data: input.nutritionPlan,
  });

  if (error) {
    const mapped = mapRpcError(error.code);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.error, code: error.code });
    }
    reportError(error, { endpoint: 'replace-plans', stage: 'rpc' });
    return res.status(500).json({ error: 'Could not save plan' });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.workout_plan_id) {
    reportError(new Error('replace_user_plans_atomic returned no row'), {
      endpoint: 'replace-plans', stage: 'rpc-result',
    });
    return res.status(500).json({ error: 'Could not save plan' });
  }

  return res.status(200).json({
    workoutPlanId: row.workout_plan_id,
    nutritionPlanId: row.nutrition_plan_id ?? null,
    replayed: row.replayed === true,
  });
}
