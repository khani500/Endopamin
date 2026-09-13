import { supabase } from './supabase';

export const REPLACE_PLANS_URL = 'https://www.endopamin.com/api/replace-plans';

const COACH_IDS = new Set(['aria', 'kane', 'blaze', 'nova', 'zara']);
const EXERCISE_KEYS = ['sets', 'reps', 'rest', 'notes', 'muscle', 'equipment'];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_CHARS = 200;

const ERROR_KIND_BY_STATUS = {
  400: 'invalid_request',
  401: 'unauthorized',
  405: 'method_not_allowed',
  409: 'idempotency_conflict',
  413: 'payload_too_large',
  422: 'profile_incomplete',
  429: 'rate_limited',
  500: 'server_error',
};

export class ReplacePlansError extends Error {
  constructor(message, {
    status = 0,
    kind = 'network_error',
    code = null,
    field = null,
    retryAfter = null,
    endpointAttempted = false,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReplacePlansError';
    this.status = status;
    this.kind = kind;
    this.code = code;
    this.field = field;
    this.retryAfter = retryAfter;
    this.endpointAttempted = endpointAttempted;
  }
}

function payloadError(field, message) {
  return new ReplacePlansError(message, {
    status: 400,
    kind: 'invalid_request',
    field,
    endpointAttempted: false,
  });
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(value, field, max = MAX_TEXT_CHARS) {
  if (typeof value !== 'string') throw payloadError(field, 'Must be a string');
  const text = value.trim();
  if (!text || text.length > max) {
    throw payloadError(field, `Must be a non-empty string of at most ${max} characters`);
  }
  return text;
}

function sanitizeDate(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
    throw payloadError(field, 'Must be an ISO date (YYYY-MM-DD)');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw payloadError(field, 'Must be a valid ISO date (YYYY-MM-DD)');
  }
  return value;
}

function sanitizeWorkoutPlan(plan) {
  if (!isPlainObject(plan) || !Array.isArray(plan.days)) {
    throw payloadError('workoutPlan.days', 'Must be an array');
  }
  if (plan.days.length !== 7) {
    throw payloadError('workoutPlan.days', 'Must contain exactly 7 days');
  }

  let totalExercises = 0;
  const days = plan.days.map((sourceDay, dayIndex) => {
    const base = `workoutPlan.days[${dayIndex}]`;
    if (!isPlainObject(sourceDay)) throw payloadError(base, 'Must be an object');
    if (!Array.isArray(sourceDay.exercises)) {
      throw payloadError(`${base}.exercises`, 'Must be an array');
    }
    if (sourceDay.exercises.length > 20) {
      throw payloadError(`${base}.exercises`, 'Must contain at most 20 exercises');
    }

    totalExercises += sourceDay.exercises.length;
    if (totalExercises > 100) {
      throw payloadError('workoutPlan.days', 'Must contain at most 100 exercises in total');
    }

    const exercises = sourceDay.exercises.map((sourceExercise, exerciseIndex) => {
      const exerciseBase = `${base}.exercises[${exerciseIndex}]`;
      if (!isPlainObject(sourceExercise)) {
        throw payloadError(exerciseBase, 'Must be an object');
      }

      const exercise = {
        name: requireText(sourceExercise.name, `${exerciseBase}.name`, 120),
      };

      for (const key of EXERCISE_KEYS) {
        const value = sourceExercise[key];
        if (value === null || value === undefined) continue;
        if (typeof value === 'number' && Number.isFinite(value)) {
          exercise[key] = value;
          continue;
        }
        if (typeof value !== 'string') {
          throw payloadError(`${exerciseBase}.${key}`, 'Must be a string or a number');
        }
        const text = value.trim();
        if (text.length > MAX_TEXT_CHARS) {
          throw payloadError(`${exerciseBase}.${key}`, 'Must be at most 200 characters');
        }
        if (text) exercise[key] = text;
      }

      return exercise;
    });

    return {
      day: requireText(sourceDay.day, `${base}.day`),
      type: requireText(sourceDay.type, `${base}.type`),
      focus: requireText(sourceDay.focus, `${base}.focus`),
      exercises,
    };
  });

  return { days };
}

function sanitizeNutritionPlan(plan) {
  if (plan === null || plan === undefined) return null;
  if (!isPlainObject(plan)) throw payloadError('nutritionPlan', 'Must be an object');

  const nutritionPlan = {};
  for (const [key, value] of Object.entries(plan)) {
    if (key === 'resolution') continue;
    nutritionPlan[key] = value;
  }

  const keys = Object.keys(nutritionPlan);
  if (keys.length === 0) throw payloadError('nutritionPlan', 'Must not be empty');
  if (keys.length > 32) throw payloadError('nutritionPlan', 'Must contain at most 32 fields');
  return nutritionPlan;
}

export function createClientAttemptId() {
  const bytes = new Uint8Array(16);
  const cryptoObject = globalThis.crypto;

  if (typeof cryptoObject?.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function resolveWeekNumber(planRow) {
  const weekNumber = planRow?.week_number;
  return Number.isInteger(weekNumber) && weekNumber >= 1 && weekNumber <= 520
    ? weekNumber
    : 1;
}

export async function getRegenerationWeekNumber(userId) {
  if (!supabase || !userId) {
    throw new ReplacePlansError('Cannot resolve plan week without an authenticated user', {
      status: 401,
      kind: 'unauthorized',
    });
  }

  const { data, error } = await supabase
    .from('workout_plans')
    .select('week_number')
    .eq('user_id', userId)
    .order('is_active', { ascending: false, nullsFirst: false })
    .order('generated_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ReplacePlansError('Could not determine the current plan week', {
      status: 0,
      kind: 'week_lookup_failed',
      cause: error,
    });
  }

  return resolveWeekNumber(data);
}

export function sanitizeReplacePlansPayload(input) {
  if (!isPlainObject(input)) throw payloadError('body', 'Must be an object');
  if (!UUID_RE.test(String(input.clientAttemptId ?? ''))) {
    throw payloadError('clientAttemptId', 'Must be an RFC 4122 version 4 UUID');
  }
  if (!COACH_IDS.has(input.coachId)) {
    throw payloadError('coachId', 'Must be a supported coach id');
  }
  if (input.planType !== 'weekly') {
    throw payloadError('planType', 'Must be weekly');
  }
  if (!Number.isInteger(input.weekNumber)
      || input.weekNumber < 1
      || input.weekNumber > 520) {
    throw payloadError('weekNumber', 'Must be an integer between 1 and 520');
  }

  return {
    clientAttemptId: input.clientAttemptId,
    coachId: input.coachId,
    planType: input.planType,
    weekStart: sanitizeDate(input.weekStart, 'weekStart'),
    weekNumber: input.weekNumber,
    activateOn: sanitizeDate(input.activateOn, 'activateOn', { nullable: true }),
    workoutPlan: sanitizeWorkoutPlan(input.workoutPlan),
    nutritionPlan: sanitizeNutritionPlan(input.nutritionPlan),
  };
}

function messageForStatus(status) {
  switch (status) {
    case 400: return 'The plan request was rejected';
    case 401: return 'Your session has expired. Please sign in again';
    case 405: return 'The plan service rejected the request method';
    case 409: return 'This plan attempt conflicts with an earlier request';
    case 413: return 'The generated plan is too large to save';
    case 422: return 'Complete your profile before generating a plan';
    case 429: return 'Too many plan requests. Please try again shortly';
    case 500: return 'The plan service could not save your plan';
    default: return `The plan service returned HTTP ${status}`;
  }
}

export async function replacePlans(input) {
  const payload = sanitizeReplacePlansPayload(input);

  if (!supabase) {
    throw new ReplacePlansError('Plan service is not configured', {
      status: 500,
      kind: 'server_error',
      endpointAttempted: false,
    });
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (sessionError || !accessToken) {
    throw new ReplacePlansError('Your session has expired. Please sign in again', {
      status: 401,
      kind: 'unauthorized',
      endpointAttempted: false,
      cause: sessionError,
    });
  }

  let response;
  try {
    response = await fetch(REPLACE_PLANS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new ReplacePlansError('Could not reach the plan service', {
      status: 0,
      kind: 'network_error',
      endpointAttempted: true,
      cause: error,
    });
  }

  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    throw new ReplacePlansError('Could not read the plan service response', {
      status: 0,
      kind: 'network_error',
      endpointAttempted: true,
      cause: error,
    });
  }
  let responseBody;
  try {
    responseBody = raw ? JSON.parse(raw) : {};
  } catch {
    responseBody = {};
  }

  if (response.status !== 200) {
    const status = response.status;
    throw new ReplacePlansError(
      responseBody.error || messageForStatus(status),
      {
        status,
        kind: ERROR_KIND_BY_STATUS[status] || 'http_error',
        code: responseBody.code ?? null,
        field: responseBody.field ?? null,
        retryAfter: response.headers.get('Retry-After'),
        endpointAttempted: true,
      },
    );
  }

  if (!responseBody.workoutPlanId) {
    throw new ReplacePlansError('The plan service returned an invalid success response', {
      status: 500,
      kind: 'invalid_response',
      endpointAttempted: true,
    });
  }

  return {
    workoutPlanId: responseBody.workoutPlanId,
    nutritionPlanId: responseBody.nutritionPlanId ?? null,
    replayed: responseBody.replayed === true,
  };
}

export function canUseLegacyPlanFallback(error) {
  return error instanceof ReplacePlansError
    && error.endpointAttempted
    && (error.status === 0 || error.status >= 500);
}
