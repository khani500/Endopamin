import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_REASONS,
  EQUIPMENT_TOKENS,
  MIN_AGE,
  PROFILE_ENUMS,
  TARGET_GOAL_INCONSISTENT,
  validateAge,
  validateCoachPersona,
  validateDaysPerWeek,
  validateEquipment,
  validateEnum,
  validateExperience,
  validateGoal,
  validateHeight,
  validateHeightUnit,
  validateJobType,
  validateSessionDuration,
  validateTargetGoalConsistency,
  validateTargetWeight,
  validateWeight,
  validateWeightUnit,
} from './profileValidation';

function expectInvalid(result, neighbour) {
  expect(result.valid).toBe(false);
  expect(result.reason).toEqual(expect.any(String));
  expect(result.reason.length).toBeGreaterThan(0);
  expect(neighbour.valid).toBe(true);
  expect(neighbour).not.toHaveProperty('reason');
}

function expectValid(result, value) {
  expect(result).toEqual({ valid: true, value });
}

function expectAbsent(result) {
  expect(result).toEqual({ valid: true, absent: true });
}

describe('PROFILE_ENUMS', () => {
  it('is the single CHECK-mirroring list for experience, goal, job_type, and coach_persona', () => {
    expect(PROFILE_ENUMS.experience).toEqual(['beginner', 'intermediate', 'advanced']);
    expect(PROFILE_ENUMS.goal).toEqual([
      'weight_loss',
      'strength_gain',
      'muscle_gain',
      'fat_loss',
      'general_fitness',
      'endurance',
      'flexibility',
    ]);
    expect(PROFILE_ENUMS.job_type).toEqual(['active', 'desk_worker', 'mixed']);
    expect(PROFILE_ENUMS.coach_persona).toEqual(['aria', 'kane', 'blaze', 'nova', 'zara']);
  });

  it('does not include the shipped-and-rejected fourth experience option', () => {
    expect(PROFILE_ENUMS.experience).not.toContain('athlete');
    expectInvalid(validateExperience('athlete'), validateExperience('advanced'));
  });
});

describe('validateAge', () => {
  it('exports MIN_AGE as 16', () => {
    expect(MIN_AGE).toBe(16);
  });

  it.each([6, 14])('rejects production age %s', age => {
    expectInvalid(validateAge(age), validateAge(MIN_AGE));
  });

  it('covers production age 98 as in-range under max 100', () => {
    expectValid(validateAge(98), 98);
    expectInvalid(validateAge(101), validateAge(100));
  });

  it('rejects 15 next to MIN_AGE', () => {
    expectInvalid(validateAge(15), validateAge(MIN_AGE));
  });

  it('rejects non-integers next to a valid integer', () => {
    expectInvalid(validateAge(16.5), validateAge(16));
    expectInvalid(validateAge('28.0'), validateAge('28'));
  });

  it('treats null and undefined as absent, not invalid', () => {
    expectAbsent(validateAge(null));
    expectAbsent(validateAge(undefined));
  });
});

describe('validateHeight', () => {
  it.each([
    [5, 'cm'],
    [5, 'in'],
    [5.6, 'cm'],
    [5.6, 'in'],
  ])('rejects production height %s %s', (height, unit) => {
    const neighbour = unit === 'cm' ? validateHeight(90, 'cm') : validateHeight(36, 'in');
    expectInvalid(validateHeight(height, unit), neighbour);
  });

  it('accepts production height 68 in and 187 cm', () => {
    expectValid(validateHeight(68, 'in'), 68);
    expectValid(validateHeight(187, 'cm'), 187);
  });

  it('rejects the cm and in boundaries just outside the range', () => {
    expectInvalid(validateHeight(89, 'cm'), validateHeight(90, 'cm'));
    expectInvalid(validateHeight(251, 'cm'), validateHeight(250, 'cm'));
    expectInvalid(validateHeight(35, 'in'), validateHeight(36, 'in'));
    expectInvalid(validateHeight(97, 'in'), validateHeight(96, 'in'));
  });

  it('treats a missing height as absent', () => {
    expectAbsent(validateHeight(null, 'cm'));
    expectAbsent(validateHeight(undefined, 'in'));
  });
});

describe('validateWeight', () => {
  it('accepts production weight 190 lb and 199 kg', () => {
    expectValid(validateWeight(190, 'lb'), 190);
    expectValid(validateWeight(199, 'kg'), 199);
  });

  it('rejects just outside kg and lb bounds', () => {
    expectInvalid(validateWeight(29, 'kg'), validateWeight(30, 'kg'));
    expectInvalid(validateWeight(301, 'kg'), validateWeight(300, 'kg'));
    expectInvalid(validateWeight(65, 'lb'), validateWeight(66, 'lb'));
    expectInvalid(validateWeight(661, 'lb'), validateWeight(660, 'lb'));
  });

  it('treats a missing weight as absent', () => {
    expectAbsent(validateWeight(null, 'kg'));
    expectAbsent(validateWeight(undefined, 'lb'));
  });
});

describe('validateTargetWeight', () => {
  const fatLossProduction = [
    { name: 'row 1', current: 180, target: 190, unit: 'lb' },
    { name: 'row 2', current: 82, target: 88, unit: 'kg' },
    { name: 'row 3', current: 210, target: 225, unit: 'lb' },
  ];

  it.each(fatLossProduction)(
    'rejects production fat_loss $name whose target exceeds current weight',
    ({ current, target, unit }) => {
      expectInvalid(
        validateTargetWeight(target, unit, { weight: current, goal: 'fat_loss' }),
        validateTargetWeight(current - 5, unit, { weight: current, goal: 'fat_loss' }),
      );
    },
  );

  it('uses a distinct reason for goal inconsistency versus out-of-bounds', () => {
    const inconsistent = validateTargetWeight(190, 'lb', { weight: 180, goal: 'fat_loss' });
    const outOfBounds = validateTargetWeight(661, 'lb', { weight: 180, goal: 'fat_loss' });
    expect(inconsistent.valid).toBe(false);
    expect(outOfBounds.valid).toBe(false);
    expect(inconsistent.reason).toBe(TARGET_GOAL_INCONSISTENT);
    expect(outOfBounds.reason).not.toBe(TARGET_GOAL_INCONSISTENT);
    expectValid(validateTargetWeight(170, 'lb', { weight: 180, goal: 'fat_loss' }), 170);
  });

  it('rejects weight_loss with target above current, and gain goals with target below', () => {
    expectInvalid(
      validateTargetWeight(90, 'kg', { weight: 80, goal: 'weight_loss' }),
      validateTargetWeight(70, 'kg', { weight: 80, goal: 'weight_loss' }),
    );
    expectInvalid(
      validateTargetWeight(70, 'kg', { weight: 80, goal: 'muscle_gain' }),
      validateTargetWeight(90, 'kg', { weight: 80, goal: 'muscle_gain' }),
    );
    expectInvalid(
      validateTargetWeight(70, 'kg', { weight: 80, goal: 'strength_gain' }),
      validateTargetWeight(90, 'kg', { weight: 80, goal: 'strength_gain' }),
    );
  });

  it('does not apply consistency when current weight or goal is absent', () => {
    expectValid(validateTargetWeight(190, 'lb', { goal: 'fat_loss' }), 190);
    expectValid(validateTargetWeight(190, 'lb', { weight: 180 }), 190);
  });

  it('shares weight bounds and unit with validateWeight', () => {
    expectInvalid(validateTargetWeight(29, 'kg'), validateTargetWeight(30, 'kg'));
    expectValid(validateTargetWeight(190, 'lb'), 190);
  });
});

describe('validateTargetGoalConsistency', () => {
  it('returns the distinct inconsistency reason, not an out-of-bounds reason', () => {
    const result = validateTargetGoalConsistency(190, 180, 'fat_loss');
    expect(result).toEqual({ valid: false, reason: TARGET_GOAL_INCONSISTENT });
    expectValid(validateTargetGoalConsistency(170, 180, 'fat_loss'), 170);
  });
});

describe('units', () => {
  it('accepts cm/in and kg/lb, and rejects neighbouring invalid units', () => {
    expectValid(validateHeightUnit('cm'), 'cm');
    expectValid(validateHeightUnit('in'), 'in');
    expectInvalid(validateHeightUnit('ft'), validateHeightUnit('in'));
    expectValid(validateWeightUnit('kg'), 'kg');
    expectValid(validateWeightUnit('lb'), 'lb');
    expectInvalid(validateWeightUnit('st'), validateWeightUnit('lb'));
  });

  it('treats missing units as absent', () => {
    expectAbsent(validateHeightUnit(null));
    expectAbsent(validateHeightUnit(undefined));
    expectAbsent(validateWeightUnit(null));
    expectAbsent(validateWeightUnit(undefined));
  });
});

describe('enums', () => {
  it.each(Object.entries(PROFILE_ENUMS))('accepts every %s CHECK value', (field, values) => {
    for (const value of values) {
      expectValid(validateEnum(field, value), value);
    }
  });

  it('rejects a neighbouring invalid value for each enum', () => {
    expectInvalid(validateExperience('athlete'), validateExperience('beginner'));
    expectInvalid(validateGoal('muscle'), validateGoal('muscle_gain'));
    expectInvalid(validateGoal('maintenance'), validateGoal('general_fitness'));
    expectInvalid(validateJobType('sedentary'), validateJobType('desk_worker'));
    expectInvalid(validateCoachPersona('elias'), validateCoachPersona('aria'));
  });

  it('treats missing enum values as absent', () => {
    expectAbsent(validateExperience(null));
    expectAbsent(validateGoal(undefined));
    expectAbsent(validateJobType(null));
    expectAbsent(validateCoachPersona(undefined));
  });
});

describe('validateDaysPerWeek and validateSessionDuration', () => {
  it('accepts the integer bounds and rejects neighbouring values', () => {
    expectValid(validateDaysPerWeek(1), 1);
    expectValid(validateDaysPerWeek(7), 7);
    expectInvalid(validateDaysPerWeek(0), validateDaysPerWeek(1));
    expectInvalid(validateDaysPerWeek(8), validateDaysPerWeek(7));
    expectValid(validateSessionDuration(15), 15);
    expectValid(validateSessionDuration(120), 120);
    expectInvalid(validateSessionDuration(14), validateSessionDuration(15));
    expectInvalid(validateSessionDuration(121), validateSessionDuration(120));
  });

  it('rejects non-integers next to a valid integer', () => {
    expectInvalid(validateDaysPerWeek(3.5), validateDaysPerWeek(4));
    expectInvalid(validateSessionDuration(45.2), validateSessionDuration(45));
  });

  it('treats missing values as absent', () => {
    expectAbsent(validateDaysPerWeek(null));
    expectAbsent(validateSessionDuration(undefined));
  });
});

describe('validateEquipment', () => {
  it('accepts a known bare token and an array of known tokens', () => {
    expectValid(validateEquipment('full_gym'), 'full_gym');
    expectValid(validateEquipment('home_full'), 'home_full');
    expectValid(validateEquipment(['full_gym', 'home_basic']), ['full_gym', 'home_basic']);
    expect(EQUIPMENT_TOKENS).toEqual(['full_gym', 'home_basic', 'bodyweight', 'home_full']);
  });

  it('rejects an empty array with a distinct reason', () => {
    const result = validateEquipment([]);
    expectInvalid(result, validateEquipment(['full_gym']));
    expect(result.reason).toBe(EQUIPMENT_REASONS.emptyArray);
  });

  it("rejects the corrupt literal '{}' with a distinct reason, not as an empty selection", () => {
    const result = validateEquipment('{}');
    expectInvalid(result, validateEquipment('full_gym'));
    expect(result.reason).toBe(EQUIPMENT_REASONS.corruptObjectString);
    expect(result.reason).not.toBe(EQUIPMENT_REASONS.emptyArray);
  });

  it('treats null and undefined as absent, not invalid', () => {
    expectAbsent(validateEquipment(null));
    expectAbsent(validateEquipment(undefined));
    expectValid(validateEquipment('full_gym'), 'full_gym');
  });

  it('rejects an unknown bare string token with a distinct reason', () => {
    const result = validateEquipment('home');
    expectInvalid(result, validateEquipment('home_full'));
    expect(result.reason).toBe(EQUIPMENT_REASONS.unknownToken);
  });

  it('rejects a plain object with a distinct reason', () => {
    const result = validateEquipment({});
    expectInvalid(result, validateEquipment(['bodyweight']));
    expect(result.reason).toBe(EQUIPMENT_REASONS.object);
  });

  it('uses a different reason string for each equipment shape', () => {
    const reasons = [
      validateEquipment(['full_gym']).valid,
      validateEquipment([]).reason,
      validateEquipment('{}').reason,
      validateEquipment(null).absent,
      validateEquipment('full_gym').value,
      validateEquipment({ gym: true }).reason,
    ];
    expect(reasons[0]).toBe(true);
    expect(reasons[3]).toBe(true);
    expect(reasons[4]).toBe('full_gym');
    const shapeReasons = [
      validateEquipment([]).reason,
      validateEquipment('{}').reason,
      validateEquipment('not_a_token').reason,
      validateEquipment({}).reason,
      validateEquipment(['nope']).reason,
    ];
    expect(new Set(shapeReasons).size).toBe(shapeReasons.length);
  });
});
