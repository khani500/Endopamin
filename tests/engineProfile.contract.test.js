import { describe, expect, it, vi } from 'vitest';
import { normalizeEngineProfile, readEngineProfile } from '../api/_engineProfile.js';

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'v1:' + 'a'.repeat(64);
const profile = () => ({
  id: USER, age: 35, gender: 'female', goal: 'muscle_gain', experience: 'intermediate',
  location: 'home', days_per_week: 4, session_duration: 60, equipment: 'bodyweight',
  equipment_extras: null, injuries: null, health_conditions: null,
  priority_muscle: null, safety_fingerprint: TOKEN,
});
const expected = () => ({
  ok: true,
  context: {
    userId: USER, age: 35, gender: 'female', goal: 'muscle_gain', tier: 'intermediate',
    location: 'home', daysPerWeek: 4, durationMinutes: 60, equipmentBucket: 'bodyweight',
    equipmentContext: { availableEquipment: ['bodyweight'], goal: 'muscle_gain' },
    priorityMuscles: [],
  },
  injuryState: { kind: 'unknown' }, healthState: { kind: 'unknown' }, safetyToken: TOKEN,
});
const rejected = (field, reason) => ({ ok: false, errors: [{ field, reason }] });
function client(result) {
  const db = {
    from: vi.fn(() => db), select: vi.fn(() => db), eq: vi.fn(() => db),
    maybeSingle: vi.fn(async () => result),
  };
  return db;
}

describe('Engine A stored profile contract (input validation, never safety clearance)', () => {
  it('returns the hand-authored context without inventing health or injury clearance', () => {
    expect(normalizeEngineProfile(profile())).toEqual(expected());
  });

  it.each([
    'id', 'age', 'gender', 'goal', 'experience', 'location', 'days_per_week',
    'session_duration', 'equipment', 'equipment_extras', 'injuries',
    'health_conditions', 'safety_fingerprint',
  ])('rejects missing selected field %s without a context', (field) => {
    const row = profile();
    delete row[field];
    expect(normalizeEngineProfile(row)).toEqual(rejected(field, 'missing_field'));
    row[field] = undefined;
    expect(normalizeEngineProfile(row)).toEqual(rejected(field, 'missing_field'));
    if (!['equipment_extras', 'injuries', 'health_conditions'].includes(field)) {
      row[field] = null;
      expect(normalizeEngineProfile(row)).toEqual(rejected(field, 'missing_field'));
    }
  });

  it.each([
    ['bodyweight', ['bodyweight']],
    ['home_basic', ['bodyweight', 'bands', 'foam_roller', 'exercise_ball']],
    ['home_full', ['bodyweight', 'dumbbell', 'bands', 'kettlebell', 'exercise_ball', 'foam_roller']],
    ['full_gym', ['bodyweight', 'barbell', 'dumbbell', 'cable', 'machine', 'kettlebell',
      'bands', 'plate', 'pullup_bar', 'exercise_ball', 'foam_roller', 'medicine_ball',
      'suspension', 'conditioning_tool', 'sled', 'strongman', 'bench']],
  ])('resolves %s with null extras to exactly the published capability', (bucket, tokens) => {
    const want = expected();
    want.context.equipmentBucket = bucket;
    want.context.equipmentContext.availableEquipment = tokens;
    expect(normalizeEngineProfile({ ...profile(), equipment: bucket })).toEqual(want);
  });

  it('supports each duration and normalizes only stored 90 to internal 75', () => {
    for (const [stored, normalized] of [[15, 15], [30, 30], [45, 45], [60, 60], [75, 75], [90, 75]]) {
      const row = { ...profile(), session_duration: stored };
      const want = expected();
      want.context.durationMinutes = normalized;
      expect(normalizeEngineProfile(row)).toEqual(want);
      expect(row.session_duration).toBe(stored);
    }
  });

  it('delegates adult age classification, including stored integer strings', () => {
    for (const age of [17, '17', 1]) {
      expect(normalizeEngineProfile({ ...profile(), age })).toEqual(rejected('age', 'underage'));
    }
    for (const age of [0, -1, 101, 17.5, '18.0', 'abc', true, [], NaN, Infinity]) {
      expect(normalizeEngineProfile({ ...profile(), age })).toEqual(rejected('age', 'invalid_age'));
    }
    for (const [age, normalized] of [[18, 18], [100, 100], [' 35 ', 35]]) {
      const want = expected();
      want.context.age = normalized;
      expect(normalizeEngineProfile({ ...profile(), age })).toEqual(want);
    }
    expect(normalizeEngineProfile({ ...profile(), age: ' ' })).toEqual(rejected('age', 'missing_field'));
  });

  it('rejects invalid enums and unsupported legacy goals, accepting existing gender casing', () => {
    for (const [field, value] of [
      ['gender', 'other'], ['gender', 1], ['location', 'outdoors'], ['location', []],
      ['experience', 'expert'], ['experience', true], ['goal', 'strength_gain'],
      ['goal', 'weight_loss'], ['goal', 'general_fitness'], ['goal', 'flexibility'], ['goal', {}],
    ]) expect(normalizeEngineProfile({ ...profile(), [field]: value })).toEqual(rejected(field, 'unsupported_value'));
    const want = expected();
    want.context.gender = 'male';
    expect(normalizeEngineProfile({ ...profile(), gender: 'MALE' })).toEqual(want);
    for (const goal of ['fat_loss', 'endurance']) {
      const goalWant = expected();
      goalWant.context.goal = goal;
      goalWant.context.equipmentContext.goal = goal;
      expect(normalizeEngineProfile({ ...profile(), goal })).toEqual(goalWant);
    }
    for (const tier of ['beginner', 'advanced']) {
      const tierWant = expected();
      tierWant.context.tier = tier;
      expect(normalizeEngineProfile({ ...profile(), experience: tier })).toEqual(tierWant);
    }
    const gymWant = expected();
    gymWant.context.location = 'gym';
    expect(normalizeEngineProfile({ ...profile(), location: 'gym' })).toEqual(gymWant);
  });

  it('requires integer frequency from two through six without string coercion', () => {
    for (const days of [0, 1, 7, 3.5, '4', true, [], NaN]) {
      expect(normalizeEngineProfile({ ...profile(), days_per_week: days })).toEqual(rejected('days_per_week', 'invalid_frequency'));
    }
    for (const days of [2, 3, 5, 6]) {
      const want = expected();
      want.context.daysPerWeek = days;
      expect(normalizeEngineProfile({ ...profile(), days_per_week: days })).toEqual(want);
    }
  });

  it('rejects unsupported and incorrectly typed durations', () => {
    for (const duration of [0, 20, 89, 91, 120, '60', 45.5, true, [], NaN]) {
      expect(normalizeEngineProfile({ ...profile(), session_duration: duration })).toEqual(rejected('session_duration', 'unsupported_duration'));
    }
  });

  it('uses extras-only dependencies, validation and stable capability union', () => {
    for (const [extras, reason] of [
      ['bands', 'not_array'], [[null], 'invalid_element'], [['bench'], 'unknown_token'],
      [['bands', 'bands'], 'duplicate_token'], [['door_anchor'], 'door_anchor_requires_bands'],
    ]) {
      expect(normalizeEngineProfile({ ...profile(), equipment: 'full_gym', equipment_extras: extras }))
        .toEqual(rejected('equipment_extras', reason));
    }
    const want = expected();
    want.context.equipmentContext.availableEquipment = ['bodyweight', 'bands', 'pullup_bar', 'door_anchor'];
    expect(normalizeEngineProfile({ ...profile(), equipment_extras: ['door_anchor', 'pullup_bar', 'bands'] })).toEqual(want);
    expect(normalizeEngineProfile({ ...profile(), equipment_extras: [] })).toEqual(expected());
  });

  it('rejects legacy and invalid buckets; Library selections cannot supply planning equipment', () => {
    for (const [equipment, reason] of [
      ['{}', 'equipment_legacy_object_string'], ['gym', 'equipment_unknown_token'],
      ['toString', 'equipment_unknown_token'], [[], 'equipment_array_not_allowed'],
      [{}, 'equipment_object_not_allowed'], [0, 'equipment_invalid_type'],
      ['', 'missing_field'], [' ', 'missing_field'],
    ]) {
      expect(normalizeEngineProfile({ ...profile(), equipment, my_equipment_home: ['dumbbell'] }))
        .toEqual(rejected('equipment', reason));
    }
    expect(normalizeEngineProfile({ ...profile(), my_equipment_home: ['dumbbell'], my_equipment_gym: ['barbell'] }))
      .toEqual(expected());
  });

  it('treats absent priority as no preference and rejects invalid priorities', () => {
    for (const priority of [undefined, null, '', 'No preference', 'no preference']) {
      expect(normalizeEngineProfile({ ...profile(), priority_muscle: priority })).toEqual(expected());
    }
    const row = profile();
    delete row.priority_muscle;
    expect(normalizeEngineProfile(row)).toEqual(expected());
    for (const priority of [0, [], 'hamstrings', 'toString', ' Glutes ']) {
      expect(normalizeEngineProfile({ ...profile(), priority_muscle: priority })).toEqual(rejected('priority_muscle', 'invalid_priority'));
    }
    for (const priority of ['Glutes', 'Legs', 'Back', 'Chest', 'Shoulders', 'Arms', 'glutes']) {
      const want = expected();
      want.context.priorityMuscles = [priority];
      expect(normalizeEngineProfile({ ...profile(), priority_muscle: priority })).toEqual(want);
    }
  });

  it('preserves each injury disclosure without producing a clearance list', () => {
    for (const [injuries, state] of [
      [null, { kind: 'unknown' }], ['', { kind: 'unknown' }], [' ', { kind: 'unknown' }],
      ['none', { kind: 'none' }], ['prefer_not_to_answer', { kind: 'prefer_not' }],
      [' knee pain ', { kind: 'reported', text: 'knee pain' }],
    ]) {
      const want = expected();
      want.injuryState = state;
      expect(normalizeEngineProfile({ ...profile(), injuries })).toEqual(want);
    }
  });

  it('refuses malformed injury disclosures', () => {
    for (const injuries of [[], {}, 0, 'None', ' NONE ', 'PREFER_NOT_TO_ANSWER', 'x'.repeat(501)]) {
      expect(normalizeEngineProfile({ ...profile(), injuries })).toEqual(rejected('injuries', 'invalid_injuries'));
    }
  });

  it('preserves unknown and explicit health disclosures, retaining canonical reported tokens', () => {
    for (const [health, state] of [
      [null, { kind: 'unknown' }], ['["none"]', { kind: 'none' }],
      ['["prefer_not_to_answer"]', { kind: 'prefer_not' }],
      ['["breathing"]', { kind: 'reported', tokens: ['breathing'] }],
      ['["pregnancy_routine","pregnancy"]', { kind: 'reported', tokens: ['pregnancy', 'pregnancy_routine'] }],
    ]) {
      const want = expected();
      want.healthState = state;
      expect(normalizeEngineProfile({ ...profile(), health_conditions: health })).toEqual(want);
    }
  });

  it('rejects malformed and inconsistent stored health data', () => {
    for (const health of [
      '', '[]', 'asthma', '{}', '["unknown"]', '["none","breathing"]', '["breathing","breathing"]',
      '["pregnancy"]', '["pregnancy_routine"]', '["musculoskeletal_acute"]', ['none'], 0,
    ]) expect(normalizeEngineProfile({ ...profile(), health_conditions: health })).toEqual(rejected('health_conditions', 'invalid_health_conditions'));
  });

  it('does not consume absent, zero or malformed body measurements and units', () => {
    for (const extras of [{}, { height: null, weight: null }, { height: 0, weight: 0 },
      { height: 'invalid', weight: -1, height_unit: 'unknown', weight_unit: null }]) {
      expect(normalizeEngineProfile({ ...profile(), ...extras })).toEqual(expected());
    }
  });

  it('reads only selected stored fields scoped to the authenticated session identity', async () => {
    const db = client({ data: profile(), error: null });
    expect(await readEngineProfile({ supabase: db, userId: USER, profile: { goal: 'endurance' } })).toEqual(expected());
    expect(db.from).toHaveBeenCalledExactlyOnceWith('profiles');
    expect(db.select).toHaveBeenCalledExactlyOnceWith('id,age,gender,goal,experience,location,days_per_week,session_duration,equipment,equipment_extras,injuries,health_conditions,priority_muscle,safety_fingerprint');
    expect(db.eq).toHaveBeenCalledExactlyOnceWith('id', USER);
    expect(db.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('refuses a returned row belonging to another account', async () => {
    const db = client({ data: { ...profile(), id: 'another-account' }, error: null });
    expect(await readEngineProfile({ supabase: db, userId: USER })).toEqual(rejected('id', 'ownership_mismatch'));
  });

  it('fails closed on returned errors, exceptions and malformed DB envelopes', async () => {
    for (const response of [{ data: profile(), error: { message: 'private database details' } }, null, {}]) {
      expect(await readEngineProfile({ supabase: client(response), userId: USER })).toEqual(rejected('profile', 'db_read_failed'));
    }
    const db = client(null);
    db.maybeSingle.mockRejectedValue(new Error('private database details'));
    expect(await readEngineProfile({ supabase: db, userId: USER })).toEqual(rejected('profile', 'db_read_failed'));
  });

  it('distinguishes a successful read with no row', async () => {
    expect(await readEngineProfile({ supabase: client({ data: null, error: null }), userId: USER }))
      .toEqual(rejected('profile', 'missing_row'));
  });

  it('distinguishes missing selected fields from missing rows and failed reads', async () => {
    for (const field of ['id', 'equipment_extras', 'safety_fingerprint']) {
      const row = profile();
      delete row[field];
      expect(await readEngineProfile({ supabase: client({ data: row, error: null }), userId: USER }))
        .toEqual(rejected(field, 'missing_field'));
    }
  });

  it('requires session identity before attempting a read', async () => {
    const db = client({ data: profile(), error: null });
    for (const userId of [undefined, null, '', ' ', 0, {}]) {
      expect(await readEngineProfile({ supabase: db, userId })).toEqual(rejected('userId', 'missing_authenticated_user'));
    }
    expect(db.from).not.toHaveBeenCalled();
  });

  it('is deterministic and does not mutate input or share returned mutable lists', () => {
    const row = Object.freeze({ ...profile(), equipment_extras: Object.freeze(['bands']) });
    const want = expected();
    want.context.equipmentContext.availableEquipment = ['bodyweight', 'bands'];
    const output = normalizeEngineProfile(row);
    expect(output).toEqual(want);
    output.context.equipmentContext.availableEquipment.push('barbell');
    expect(normalizeEngineProfile(row)).toEqual(want);
    expect(row.equipment_extras).toEqual(['bands']);
  });

  it('rejects non-record profiles and aggregates errors without exposing partial context', () => {
    for (const row of [null, undefined, [], 'profile', 0, new Date(0)]) {
      expect(normalizeEngineProfile(row)).toEqual(rejected('profile', 'invalid_row'));
    }
    expect(normalizeEngineProfile({ ...profile(), goal: null, days_per_week: 0 })).toEqual({
      ok: false, errors: [{ field: 'goal', reason: 'missing_field' }, { field: 'days_per_week', reason: 'invalid_frequency' }],
    });
  });

  it('requires the stored concurrency token format and never synthesizes a token', () => {
    for (const safety_fingerprint of ['v1:abc', 'v2:' + 'a'.repeat(64), 0, 'v1:' + 'A'.repeat(64)]) {
      expect(normalizeEngineProfile({ ...profile(), safety_fingerprint })).toEqual(rejected('safety_fingerprint', 'invalid_safety_token'));
    }
  });
});
