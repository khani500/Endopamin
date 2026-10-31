import { classifyStoredAge } from '../src/lib/adultAge.js';
import { validateInjuries, validateHealthConditions } from '../src/lib/profileValidation.js';
import {
  resolveEquipmentCapability,
  EQUIPMENT_STATUS_OK,
  EQUIPMENT_STATUS_REASON_EXTRAS,
} from '../core/lib/plan/equipmentContract.js';

const FIELDS = [
  'id', 'age', 'gender', 'goal', 'experience', 'location', 'days_per_week',
  'session_duration', 'equipment', 'equipment_extras', 'injuries',
  'health_conditions', 'priority_muscle', 'safety_fingerprint',
];
const NULLABLE = new Set(['equipment_extras', 'injuries', 'health_conditions']);
const ENUMS = {
  gender: ['male', 'female'],
  goal: ['muscle_gain', 'fat_loss', 'endurance'],
  experience: ['beginner', 'intermediate', 'advanced'],
  location: ['gym', 'home'],
};
// V3 setup labels, including the persisted lowercase spellings.
const PRIORITIES = new Set([
  'No preference', 'no preference', 'Glutes', 'glutes', 'Legs', 'legs',
  'Back', 'back', 'Chest', 'chest', 'Shoulders', 'shoulders', 'Arms', 'arms',
]);
const absent = (value) => value == null || (typeof value === 'string' && value.trim() === '');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const failure = (field, reason) => ({ ok: false, errors: [{ field, reason }] });

/** Pure stored-profile boundary. Success validates inputs only; injury enforcement
 * and independent output validation are still required before generation/serving.
 * No body measurements are consumed because no reviewed planning rule needs them.
 */
export function normalizeEngineProfile(row) {
  if (!record(row)) return failure('profile', 'invalid_row');
  const errors = [];
  const add = (field, reason) => errors.push({ field, reason });
  const missing = new Set();
  for (const field of FIELDS) {
    if (field === 'priority_muscle') continue;
    if (!Object.hasOwn(row, field) || row[field] === undefined
      || (!NULLABLE.has(field) && absent(row[field]))) {
      missing.add(field);
      add(field, 'missing_field');
    }
  }
  if (!missing.has('id') && typeof row.id !== 'string') add('id', 'invalid_type');
  if (!missing.has('age')) {
    const age = classifyStoredAge(row.age);
    if (age !== 'ok') add('age', age === 'underage' ? 'underage' : 'invalid_age');
  }
  // Persisted plans accept male/female after lowercasing the stored gender.
  const gender = typeof row.gender === 'string' ? row.gender.toLowerCase() : row.gender;
  for (const [field, values] of Object.entries(ENUMS)) {
    if (!missing.has(field) && !values.includes(field === 'gender' ? gender : row[field])) {
      add(field, 'unsupported_value');
    }
  }
  if (!missing.has('days_per_week')
    && (!Number.isInteger(row.days_per_week) || row.days_per_week < 2 || row.days_per_week > 6)) {
    add('days_per_week', 'invalid_frequency');
  }
  if (!missing.has('session_duration')
    && ![20, 30, 45, 60, 75, 90].includes(row.session_duration)) {
    add('session_duration', 'unsupported_duration');
  }
  const equipment = resolveEquipmentCapability(row.equipment, row.equipment_extras);
  if (equipment.equipmentStatus !== EQUIPMENT_STATUS_OK) {
    const field = equipment.equipmentStatusReason === EQUIPMENT_STATUS_REASON_EXTRAS
      ? 'equipment_extras' : 'equipment';
    if (!missing.has(field)) add(field, equipment.equipmentReasonCode || equipment.equipmentStatus);
  }
  const priority = row.priority_muscle;
  if (!absent(priority) && !PRIORITIES.has(priority)) add('priority_muscle', 'invalid_priority');

  let injuryState = { kind: 'unknown' };
  if (!missing.has('injuries') && !absent(row.injuries)) {
    const injury = validateInjuries(row.injuries);
    if (!injury.valid) add('injuries', 'invalid_injuries');
    else if (injury.value === 'none') injuryState = { kind: 'none' };
    else if (injury.value === 'prefer_not_to_answer') injuryState = { kind: 'prefer_not' };
    else injuryState = { kind: 'reported', text: injury.value };
  }
  let healthState = { kind: 'unknown' };
  if (!missing.has('health_conditions') && row.health_conditions !== null) {
    // The stored column is text, even though the save boundary also accepts arrays.
    const health = typeof row.health_conditions === 'string'
      ? validateHealthConditions(row.health_conditions) : { valid: false };
    if (!health.valid) add('health_conditions', 'invalid_health_conditions');
    else {
      const tokens = JSON.parse(health.value);
      if (tokens[0] === 'none') healthState = { kind: 'none' };
      else if (tokens[0] === 'prefer_not_to_answer') healthState = { kind: 'prefer_not' };
      else healthState = { kind: 'reported', tokens };
    }
  }
  if (!missing.has('safety_fingerprint')
    && (typeof row.safety_fingerprint !== 'string' || !/^v1:[0-9a-f]{64}$/.test(row.safety_fingerprint))) {
    add('safety_fingerprint', 'invalid_safety_token');
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    context: {
      userId: row.id,
      age: Number(row.age),
      gender,
      goal: row.goal,
      tier: row.experience,
      location: row.location,
      daysPerWeek: row.days_per_week,
      durationMinutes: row.session_duration === 90 ? 75 : row.session_duration,
      equipmentBucket: equipment.equipmentBucket,
      equipmentContext: { availableEquipment: equipment.availableEquipment, goal: row.goal },
      priorityMuscles: absent(priority) || priority.toLowerCase() === 'no preference' ? [] : [priority],
    },
    injuryState,
    healthState,
    safetyToken: row.safety_fingerprint,
  };
}

/** The caller must supply userId from its verified authenticated session only.
 * This unwired helper does not authenticate requests or accept profile snapshots.
 */
export async function readEngineProfile({ supabase, userId }) {
  if (typeof userId !== 'string' || absent(userId)) return failure('userId', 'missing_authenticated_user');
  let result;
  try {
    result = await supabase.from('profiles').select(FIELDS.join(',')).eq('id', userId).maybeSingle();
  } catch {
    return failure('profile', 'db_read_failed');
  }
  if (!result || result.error || result.data === undefined) return failure('profile', 'db_read_failed');
  if (result.data === null) return failure('profile', 'missing_row');
  const row = result.data;
  if (record(row) && Object.hasOwn(row, 'id') && !absent(row.id) && row.id !== userId) {
    return failure('id', 'ownership_mismatch');
  }
  return normalizeEngineProfile(row);
}
