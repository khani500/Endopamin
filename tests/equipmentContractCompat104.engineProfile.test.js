import { describe, expect, it } from 'vitest';
import { normalizeEngineProfile } from '../api/_engineProfile.js';
import { EQUIPMENT_BUCKETS, EQUIPMENT_EXTRA_TOKENS } from '../core/lib/plan/equipmentContract.js';

// The resolver core gains an opt-in equipment-contract revision (S1). The dormant engine profile
// passes no revision, so it must keep exactly the 1.0.4 capability. Expected values are literal on
// purpose: they must not follow the mirrored module.
const FULL_GYM_104 = [
  'bodyweight', 'barbell', 'dumbbell', 'cable', 'machine',
  'kettlebell', 'bands', 'plate', 'pullup_bar', 'exercise_ball',
  'foam_roller', 'medicine_ball', 'suspension',
  'conditioning_tool', 'sled', 'strongman', 'bench',
];
const HOME_FULL_104 = ['bodyweight', 'dumbbell', 'bands', 'kettlebell', 'exercise_ball', 'foam_roller'];
const HOME_BASIC_104 = ['bodyweight', 'bands', 'foam_roller', 'exercise_ball'];
const BUCKETS_104 = {
  full_gym: FULL_GYM_104,
  home_full: HOME_FULL_104,
  home_basic: HOME_BASIC_104,
  bodyweight: ['bodyweight'],
};

// [bucket, equipment_extras, availableEquipment] for every bucket x valid extras selection.
const RESOLVED_104 = [
  ['full_gym', null, FULL_GYM_104],
  ['full_gym', ['bands'], FULL_GYM_104],
  ['full_gym', ['pullup_bar'], FULL_GYM_104],
  ['full_gym', ['bands', 'pullup_bar'], FULL_GYM_104],
  ['full_gym', ['bands', 'door_anchor'], [...FULL_GYM_104, 'door_anchor']],
  ['full_gym', ['bands', 'pullup_bar', 'door_anchor'], [...FULL_GYM_104, 'door_anchor']],
  ['home_full', null, HOME_FULL_104],
  ['home_full', ['bands'], HOME_FULL_104],
  ['home_full', ['pullup_bar'], [...HOME_FULL_104, 'pullup_bar']],
  ['home_full', ['bands', 'pullup_bar'], [...HOME_FULL_104, 'pullup_bar']],
  ['home_full', ['bands', 'door_anchor'], [...HOME_FULL_104, 'door_anchor']],
  ['home_full', ['bands', 'pullup_bar', 'door_anchor'], [...HOME_FULL_104, 'pullup_bar', 'door_anchor']],
  ['home_basic', null, HOME_BASIC_104],
  ['home_basic', ['bands'], HOME_BASIC_104],
  ['home_basic', ['pullup_bar'], [...HOME_BASIC_104, 'pullup_bar']],
  ['home_basic', ['bands', 'pullup_bar'], [...HOME_BASIC_104, 'pullup_bar']],
  ['home_basic', ['bands', 'door_anchor'], [...HOME_BASIC_104, 'door_anchor']],
  ['home_basic', ['bands', 'pullup_bar', 'door_anchor'], [...HOME_BASIC_104, 'pullup_bar', 'door_anchor']],
  ['bodyweight', null, ['bodyweight']],
  ['bodyweight', ['bands'], ['bodyweight', 'bands']],
  ['bodyweight', ['pullup_bar'], ['bodyweight', 'pullup_bar']],
  ['bodyweight', ['bands', 'pullup_bar'], ['bodyweight', 'bands', 'pullup_bar']],
  ['bodyweight', ['bands', 'door_anchor'], ['bodyweight', 'bands', 'door_anchor']],
  ['bodyweight', ['bands', 'pullup_bar', 'door_anchor'], ['bodyweight', 'bands', 'pullup_bar', 'door_anchor']],
];

const profile = (equipment, extras) => ({
  id: '11111111-1111-4111-8111-111111111111', age: 35, gender: 'female', goal: 'muscle_gain',
  experience: 'intermediate', location: 'home', days_per_week: 4, session_duration: 60,
  equipment, equipment_extras: extras, injuries: null, health_conditions: null,
  priority_muscle: null, safety_fingerprint: 'v1:' + 'a'.repeat(64),
});

describe('Engine profile equipment stays at the 1.0.4 contract', () => {
  it('mirrored bucket arrays and extras tokens equal 1.0.4 (keys and order included)', () => {
    expect(JSON.stringify(EQUIPMENT_BUCKETS)).toBe(JSON.stringify(BUCKETS_104));
    expect(JSON.stringify(EQUIPMENT_EXTRA_TOKENS)).toBe(JSON.stringify(['bands', 'pullup_bar', 'door_anchor']));
  });

  it('the table covers every bucket x valid extras selection', () => {
    expect(RESOLVED_104).toHaveLength(24);
    expect(new Set(RESOLVED_104.map(([bucket, extras]) => bucket + '|' + JSON.stringify(extras))).size).toBe(24);
  });

  it.each(RESOLVED_104)('%s + %j resolves to the 1.0.4 capability with no revision field', (bucket, extras, availableEquipment) => {
    const result = normalizeEngineProfile(profile(bucket, extras));
    expect(result.ok).toBe(true);
    expect(result.context.equipmentBucket).toBe(bucket);
    expect(JSON.stringify(result.context.equipmentContext))
      .toBe(JSON.stringify({ availableEquipment, goal: 'muscle_gain' }));
    expect(Object.hasOwn(result.context, 'equipmentContractRevision')).toBe(false);
  });
});
