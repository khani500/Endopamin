// Pending Khani's ruling — confirm before ship.
export const MIN_AGE = 16;

const MAX_AGE = 100;

export const PROFILE_ENUMS = Object.freeze({
  experience: Object.freeze(['beginner', 'intermediate', 'advanced']),
  goal: Object.freeze([
    'weight_loss',
    'strength_gain',
    'muscle_gain',
    'fat_loss',
    'general_fitness',
    'endurance',
    'flexibility',
  ]),
  job_type: Object.freeze(['active', 'desk_worker', 'mixed']),
  coach_persona: Object.freeze(['aria', 'kane', 'blaze', 'nova', 'zara']),
});

export const EQUIPMENT_TOKENS = Object.freeze([
  'full_gym',
  'home_basic',
  'bodyweight',
  'home_full',
]);

export const HEIGHT_UNITS = Object.freeze(['cm', 'in']);
export const WEIGHT_UNITS = Object.freeze(['kg', 'lb']);

export const EQUIPMENT_REASONS = Object.freeze({
  emptyArray: 'empty array is not a known equipment selection',
  corruptObjectString: "literal '{}' is corrupt equipment data, not an empty selection",
  unknownToken: 'not a known equipment token',
  object: 'equipment object is not a known token or array of tokens',
  unknownInArray: 'equipment array contains a token that is not known',
  other: 'equipment is not a known token or array of known tokens',
});

export const TARGET_GOAL_INCONSISTENT = 'target_weight is inconsistent with goal';

const ENUM_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(PROFILE_ENUMS).map(([field, values]) => [field, new Set(values)]),
  ),
);
const EQUIPMENT_TOKEN_SET = new Set(EQUIPMENT_TOKENS);
const HEIGHT_UNIT_SET = new Set(HEIGHT_UNITS);
const WEIGHT_UNIT_SET = new Set(WEIGHT_UNITS);
const HEIGHT_BOUNDS = Object.freeze({
  cm: Object.freeze({ min: 90, max: 250 }),
  in: Object.freeze({ min: 36, max: 96 }),
});
const WEIGHT_BOUNDS = Object.freeze({
  kg: Object.freeze({ min: 30, max: 300 }),
  lb: Object.freeze({ min: 66, max: 660 }),
});
const LOSS_GOALS = new Set(['fat_loss', 'weight_loss']);
const GAIN_GOALS = new Set(['muscle_gain', 'strength_gain']);

function absent() {
  return { valid: true, absent: true };
}

function ok(value) {
  return { valid: true, value };
}

function invalid(reason) {
  return { valid: false, reason };
}

function isAbsent(value) {
  return value === null || value === undefined;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function parseFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function validateIntegerRange(value, { min, max, label }) {
  if (isAbsent(value)) return absent();
  const parsed = parseInteger(value);
  if (parsed === null) return invalid(`${label} must be an integer`);
  if (parsed < min || parsed > max) {
    return invalid(`${label} must be an integer from ${min} to ${max}`);
  }
  return ok(parsed);
}

function validateMeasured(value, unit, { units, bounds, label, unitLabel }) {
  if (isAbsent(value)) return absent();
  const parsed = parseFiniteNumber(value);
  if (parsed === null) return invalid(`${label} must be a number`);
  if (isAbsent(unit) || !units.has(unit)) {
    return invalid(`${unitLabel} must be ${[...units].join(' or ')}`);
  }
  const { min, max } = bounds[unit];
  if (parsed < min || parsed > max) {
    return invalid(`${label} is out of range for ${unit}`);
  }
  return ok(parsed);
}

export function validateAge(value) {
  if (isAbsent(value)) return absent();
  const parsed = parseInteger(value);
  if (parsed === null) return invalid('age must be an integer');
  if (parsed < MIN_AGE || parsed > MAX_AGE) {
    return invalid(`age must be an integer from ${MIN_AGE} to ${MAX_AGE}`);
  }
  return ok(parsed);
}

export function validateHeight(value, unit) {
  return validateMeasured(value, unit, {
    units: HEIGHT_UNIT_SET,
    bounds: HEIGHT_BOUNDS,
    label: 'height',
    unitLabel: 'height_unit',
  });
}

export function validateWeight(value, unit) {
  return validateMeasured(value, unit, {
    units: WEIGHT_UNIT_SET,
    bounds: WEIGHT_BOUNDS,
    label: 'weight',
    unitLabel: 'weight_unit',
  });
}

function isKnownGoal(goal) {
  if (isAbsent(goal)) return false;
  if (typeof goal !== 'string') return false;
  return goal.trim() !== '';
}

// The goal/target_weight pair is resolved only here. Both field validators
// reach this through applyPairConsistency so neither write direction can drift.
export function validateTargetGoalConsistency(target, current, goal) {
  if (isAbsent(target) || isAbsent(current) || !isKnownGoal(goal)) return absent();
  const targetNumber = parseFiniteNumber(target);
  const currentNumber = parseFiniteNumber(current);
  if (targetNumber === null || currentNumber === null) {
    return invalid(TARGET_GOAL_INCONSISTENT);
  }
  if (LOSS_GOALS.has(goal) && targetNumber > currentNumber) {
    return invalid(TARGET_GOAL_INCONSISTENT);
  }
  if (GAIN_GOALS.has(goal) && targetNumber < currentNumber) {
    return invalid(TARGET_GOAL_INCONSISTENT);
  }
  return ok(targetNumber);
}

function applyPairConsistency(fieldResult, target, current, goal) {
  if (fieldResult.absent || !fieldResult.valid) return fieldResult;
  const consistency = validateTargetGoalConsistency(target, current, goal);
  if (consistency.absent) return fieldResult;
  if (!consistency.valid) return consistency;
  return fieldResult;
}

export function validateTargetWeight(value, unit, { weight, goal } = {}) {
  const boundsResult = validateMeasured(value, unit, {
    units: WEIGHT_UNIT_SET,
    bounds: WEIGHT_BOUNDS,
    label: 'target_weight',
    unitLabel: 'weight_unit',
  });
  return applyPairConsistency(boundsResult, boundsResult.value, weight, goal);
}

export function validateHeightUnit(value) {
  if (isAbsent(value)) return absent();
  if (HEIGHT_UNIT_SET.has(value)) return ok(value);
  return invalid('height_unit must be cm or in');
}

export function validateWeightUnit(value) {
  if (isAbsent(value)) return absent();
  if (WEIGHT_UNIT_SET.has(value)) return ok(value);
  return invalid('weight_unit must be kg or lb');
}

export function validateEnum(field, value) {
  const allowed = ENUM_SETS[field];
  if (!allowed) return invalid(`${field} is not a profile enum`);
  if (isAbsent(value)) return absent();
  if (allowed.has(value)) return ok(value);
  return invalid(`${field} is not an allowed value`);
}

export function validateExperience(value) {
  return validateEnum('experience', value);
}

export function validateGoal(value, { weight, target_weight } = {}) {
  return applyPairConsistency(validateEnum('goal', value), target_weight, weight, value);
}

export function validateJobType(value) {
  return validateEnum('job_type', value);
}

export function validateCoachPersona(value) {
  return validateEnum('coach_persona', value);
}

export function validateDaysPerWeek(value) {
  return validateIntegerRange(value, { min: 1, max: 7, label: 'days_per_week' });
}

export function validateSessionDuration(value) {
  return validateIntegerRange(value, { min: 15, max: 120, label: 'session_duration' });
}

export function validateEquipment(value) {
  if (isAbsent(value)) return absent();
  if (value === '{}') return invalid(EQUIPMENT_REASONS.corruptObjectString);
  if (typeof value === 'string') {
    if (EQUIPMENT_TOKEN_SET.has(value)) return ok(value);
    return invalid(EQUIPMENT_REASONS.unknownToken);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return invalid(EQUIPMENT_REASONS.emptyArray);
    if (value.every(token => EQUIPMENT_TOKEN_SET.has(token))) return ok(value);
    return invalid(EQUIPMENT_REASONS.unknownInArray);
  }
  if (isPlainObject(value)) return invalid(EQUIPMENT_REASONS.object);
  return invalid(EQUIPMENT_REASONS.other);
}

// public.profiles.health_conditions is text, nullable, no default.
// Encoding: canonical compact JSON array of tokens in HEALTH_CONDITION_TOKENS
// order, e.g. ["none"], ["prefer_not_to_answer"], ["pregnancy","pregnancy_routine"].
// HTTP value may be a token array or a JSON array string. Both are parsed,
// validated against the closed set, and re-serialized. Free text is rejected.
export const HEALTH_CONDITION_TOKENS = Object.freeze([
  'none',
  'prefer_not_to_answer',
  'heart_bp_chest',
  'dizziness_fainting',
  'breathing',
  'blood_sugar',
  'pregnancy',
  'pregnancy_routine',
  'pregnancy_unsure',
  'pregnancy_high_risk',
  'musculoskeletal',
  'musculoskeletal_acute',
  'clinician_advised',
  'other',
]);

const HEALTH_CONDITION_TOKEN_SET = new Set(HEALTH_CONDITION_TOKENS);
const HEALTH_EXCLUSIVE_TOKENS = new Set(['none', 'prefer_not_to_answer']);
const PREGNANCY_STATUS_TOKENS = new Set([
  'pregnancy_routine',
  'pregnancy_unsure',
  'pregnancy_high_risk',
]);

export const HEALTH_CONDITION_REASONS = Object.freeze({
  emptyArray: 'empty array is not a known health_conditions selection',
  unknownToken: 'health_conditions array contains a token that is not known',
  duplicate: 'health_conditions must not contain duplicate tokens',
  exclusiveMix: 'none and prefer_not_to_answer cannot mix with other tokens',
  exclusiveBoth: 'none and prefer_not_to_answer cannot be stored together',
  pregnancyStatus: 'pregnancy requires exactly one status token',
  pregnancyOrphan: 'pregnancy status tokens require pregnancy',
  musculoskeletalOrphan: 'musculoskeletal_acute requires musculoskeletal',
  object: 'health_conditions object is not a token array',
  other: 'health_conditions is not an array of known tokens',
});

function parseHealthConditionTokens(value) {
  if (Array.isArray(value)) return { tokens: value };
  if (typeof value !== 'string') return { error: HEALTH_CONDITION_REASONS.other };
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return { tokens: parsed };
  } catch {
    return { error: HEALTH_CONDITION_REASONS.other };
  }
  return { error: HEALTH_CONDITION_REASONS.other };
}

export function encodeHealthConditions(tokens) {
  const selected = new Set(tokens);
  return JSON.stringify(HEALTH_CONDITION_TOKENS.filter((token) => selected.has(token)));
}

export function validateHealthConditions(value) {
  if (isAbsent(value)) return absent();
  if (isPlainObject(value)) return invalid(HEALTH_CONDITION_REASONS.object);

  const parsed = parseHealthConditionTokens(value);
  if (parsed.error) return invalid(parsed.error);

  const tokens = parsed.tokens;
  if (tokens.length === 0) return invalid(HEALTH_CONDITION_REASONS.emptyArray);
  if (!tokens.every((token) => typeof token === 'string' && HEALTH_CONDITION_TOKEN_SET.has(token))) {
    return invalid(HEALTH_CONDITION_REASONS.unknownToken);
  }
  if (new Set(tokens).size !== tokens.length) {
    return invalid(HEALTH_CONDITION_REASONS.duplicate);
  }

  const selected = new Set(tokens);
  if (selected.has('none') && selected.has('prefer_not_to_answer')) {
    return invalid(HEALTH_CONDITION_REASONS.exclusiveBoth);
  }
  if ([...selected].some((token) => HEALTH_EXCLUSIVE_TOKENS.has(token)) && selected.size !== 1) {
    return invalid(HEALTH_CONDITION_REASONS.exclusiveMix);
  }

  const pregnancyStatuses = [...PREGNANCY_STATUS_TOKENS].filter((token) => selected.has(token));
  if (selected.has('pregnancy') && pregnancyStatuses.length !== 1) {
    return invalid(HEALTH_CONDITION_REASONS.pregnancyStatus);
  }
  if (!selected.has('pregnancy') && pregnancyStatuses.length > 0) {
    return invalid(HEALTH_CONDITION_REASONS.pregnancyOrphan);
  }
  if (selected.has('musculoskeletal_acute') && !selected.has('musculoskeletal')) {
    return invalid(HEALTH_CONDITION_REASONS.musculoskeletalOrphan);
  }

  return ok(encodeHealthConditions(tokens));
}
