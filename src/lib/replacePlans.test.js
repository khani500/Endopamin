import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createClientAttemptId,
  resolveWeekNumber,
  sanitizeReplacePlansPayload,
} from './replacePlans';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function workoutPlan() {
  return {
    coachId: 'aria',
    gender: 'female',
    resolution: 'client-owned',
    days: Array.from({ length: 7 }, (_, index) => ({
      day: `Day ${index + 1}`,
      type: index === 6 ? 'rest' : 'training',
      focus: index === 6 ? 'Recovery' : 'Strength',
      resolution: 'remove me',
      exercises: index === 6
        ? []
        : [{
          name: '  Squat  ',
          sets: ' 3 ',
          reps: 10,
          rest: '60s',
          resolution: 'remove me',
          unsupported: 'remove me',
        }],
    })),
  };
}

function request(overrides = {}) {
  return {
    clientAttemptId: createClientAttemptId(),
    coachId: 'aria',
    planType: 'weekly',
    weekStart: '2026-09-12',
    weekNumber: 1,
    activateOn: null,
    workoutPlan: workoutPlan(),
    nutritionPlan: {
      daily_calories: 2200,
      resolution: 'remove me',
    },
    user_id: 'must-not-pass-through',
    plan_data: 'must-not-pass-through',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeReplacePlansPayload', () => {
  it('returns only the endpoint contract and strips client-owned fields', () => {
    const sanitized = sanitizeReplacePlansPayload(request());

    expect(Object.keys(sanitized)).toEqual([
      'clientAttemptId',
      'coachId',
      'planType',
      'weekStart',
      'weekNumber',
      'activateOn',
      'workoutPlan',
      'nutritionPlan',
    ]);
    expect(sanitized).not.toHaveProperty('user_id');
    expect(sanitized).not.toHaveProperty('plan_data');
    expect(sanitized.workoutPlan).not.toHaveProperty('coachId');
    expect(sanitized.workoutPlan).not.toHaveProperty('gender');
    expect(sanitized.workoutPlan).not.toHaveProperty('resolution');
    expect(sanitized.workoutPlan.days[0]).toEqual({
      day: 'Day 1',
      type: 'training',
      focus: 'Strength',
      exercises: [{
        name: 'Squat',
        sets: '3',
        reps: 10,
        rest: '60s',
      }],
    });
    expect(sanitized.nutritionPlan).toEqual({ daily_calories: 2200 });
  });

  it('rejects a workout plan that does not contain exactly seven days', () => {
    const malformed = workoutPlan();
    malformed.days.pop();

    expect(() => sanitizeReplacePlansPayload(request({ workoutPlan: malformed })))
      .toThrow('Must contain exactly 7 days');
  });

  it('rejects nutrition that becomes empty after sanitation', () => {
    expect(() => sanitizeReplacePlansPayload(request({
      nutritionPlan: { resolution: 'remove me' },
    }))).toThrow('Must not be empty');
  });

  it('rejects nutrition with more than 32 retained root fields', () => {
    const nutritionPlan = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`field_${index}`, index]),
    );

    expect(() => sanitizeReplacePlansPayload(request({ nutritionPlan })))
      .toThrow('Must contain at most 32 fields');
  });
});

describe('resolveWeekNumber', () => {
  it.each([1, 17, 520])('preserves valid week number %s', weekNumber => {
    expect(resolveWeekNumber({ week_number: weekNumber })).toBe(weekNumber);
  });

  it.each([
    undefined,
    null,
    {},
    { week_number: null },
    { week_number: 0 },
    { week_number: 521 },
    { week_number: 2.5 },
    { week_number: '4' },
  ])('falls back to week 1 for invalid row %#', row => {
    expect(resolveWeekNumber(row)).toBe(1);
  });
});

describe('client attempt IDs', () => {
  it('creates RFC 4122 version 4 IDs and new operations receive new IDs', () => {
    const first = createClientAttemptId();
    const second = createClientAttemptId();

    expect(first).toMatch(UUID_V4_RE);
    expect(second).toMatch(UUID_V4_RE);
    expect(second).not.toBe(first);
  });

  it('creates a valid ID when secure crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    expect(createClientAttemptId()).toMatch(UUID_V4_RE);
  });

  it('reuses the caller-owned ID whenever the same operation rebuilds its payload', () => {
    const clientAttemptId = createClientAttemptId();

    const firstAttempt = sanitizeReplacePlansPayload(request({ clientAttemptId }));
    const retry = sanitizeReplacePlansPayload(request({ clientAttemptId }));

    expect(firstAttempt.clientAttemptId).toBe(clientAttemptId);
    expect(retry.clientAttemptId).toBe(clientAttemptId);
  });
});
