import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleRequest,
  PLAN_SCHEMA_VERSION,
  PLAN_SCHEMA_VERSION_ABSENT,
  UNKNOWN_EXERCISE_KEY_EVENT,
  UNKNOWN_EXERCISE_KEY_NAME_CAP,
  UNKNOWN_EXERCISE_KEY_NAME_MAX,
  validatePlanRequest,
} from '../api/replace-plans.js';
import * as sentry from '../api/_sentry.js';

const NOW = new Date('2026-09-19T21:00:00.000Z');
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const EXERCISE_FIELD = 'workoutPlan.days[0].exercises[0]';

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function days(exerciseOverrides = {}) {
  return Array.from({ length: 7 }, (_, index) => ({
    day: `Day ${index + 1}`,
    type: index === 6 ? 'rest' : 'training',
    focus: index === 6 ? 'Recovery' : 'Strength',
    exercises: index === 6
      ? []
      : [{
        name: 'Squat',
        sets: '3',
        reps: 10,
        rest: '60s',
        ...(index === 0 ? exerciseOverrides : {}),
      }],
  }));
}

function body(overrides = {}) {
  const { exercise, workoutPlan, ...rest } = overrides;
  return {
    clientAttemptId: ATTEMPT_ID,
    coachId: 'aria',
    planType: 'weekly',
    weekStart: '2026-09-14',
    weekNumber: 1,
    activateOn: null,
    workoutPlan: workoutPlan || { days: days(exercise) },
    ...rest,
  };
}

function validate(overrides = {}) {
  return validatePlanRequest(body(overrides), NOW);
}

function expectFieldError(result, field) {
  expect(result.error?.status).toBe(400);
  expect(result.error.field).toBe(field);
}

function fakeRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    headersSent: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function fakeAdmin({ gender = 'female', userId = 'user-1' } = {}) {
  const calls = { rpc: [] };
  return {
    calls,
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: { gender }, error: null }),
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return {
        data: { workout_plan_id: 'wp-1', nutrition_plan_id: null, replayed: false },
        error: null,
      };
    },
  };
}

async function postReplace(payload, { gender = 'female', useRealReportMessage = false } = {}) {
  const admin = fakeAdmin({ gender });
  const res = fakeRes();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const originalReportMessage = sentry.reportMessage;
  const reportMessage = vi.spyOn(sentry, 'reportMessage');
  if (useRealReportMessage) {
    reportMessage.mockImplementation((...args) => originalReportMessage(...args));
  } else {
    reportMessage.mockResolvedValue(undefined);
  }
  await handleRequest(
    {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-length': '128' },
      body: { ...payload, weekStart: todayUtc() },
    },
    res,
    'abcd1234',
    { admin },
  );
  return { res, admin, warn, info, reportMessage };
}

function sentryPayload(reportMessage) {
  return JSON.stringify(reportMessage.mock.calls);
}

function sevenDays(perDayExercises) {
  return Array.from({ length: 7 }, (_, index) => ({
    day: `Day ${index + 1}`,
    type: index === 6 ? 'rest' : 'training',
    focus: index === 6 ? 'Recovery' : 'Strength',
    exercises: perDayExercises[index] || [],
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validatePlanRequest legacy payload', () => {
  it('still accepts a payload without exerciseId or planSchemaVersion', () => {
    const result = validate();

    expect(result.error).toBeUndefined();
    expect(result.planSchemaVersion).toBeUndefined();
    expect(result.value).not.toHaveProperty('planSchemaVersion');
    expect(result.value.workoutPlan.days[0].exercises[0]).toEqual({
      name: 'Squat',
      sets: '3',
      reps: 10,
      rest: '60s',
    });
    expect(result.value.workoutPlan.days[0].exercises[0]).not.toHaveProperty('exerciseId');
  });
});

describe('validatePlanRequest exerciseId', () => {
  it('preserves a valid fx_ id unchanged through the cleaned days', () => {
    const exerciseId = 'fx_barbell_back_squat';
    const result = validate({ exercise: { exerciseId } });

    expect(result.error).toBeUndefined();
    expect(result.value.workoutPlan.days[0].exercises[0].exerciseId).toBe(exerciseId);
  });

  it('preserves a valid gx_ id unchanged through the cleaned days', () => {
    const exerciseId = 'gx_bodyweight_push_up';
    const result = validate({ exercise: { exerciseId } });

    expect(result.error).toBeUndefined();
    expect(result.value.workoutPlan.days[0].exercises[0].exerciseId).toBe(exerciseId);
  });

  it('accepts digits 0-9 in the suffix', () => {
    const exerciseId = 'fx_bench_press_90';
    const result = validate({ exercise: { exerciseId } });

    expect(result.error).toBeUndefined();
    expect(result.value.workoutPlan.days[0].exercises[0].exerciseId).toBe(exerciseId);
  });

  it.each([
    ['uppercase id', 'FX_barbell_back_squat'],
    ['whitespace-padded id', ' fx_barbell_back_squat'],
    ['trailing whitespace', 'fx_barbell_back_squat '],
    ['wrong prefix', 'ex_barbell_back_squat'],
    ['invalid character', 'fx_barbell-back-squat'],
  ])('returns 400 for %s', (_, exerciseId) => {
    expectFieldError(validate({ exercise: { exerciseId } }), `${EXERCISE_FIELD}.exerciseId`);
  });

  it('returns 400 when the id is longer than 80 characters', () => {
    const exerciseId = `fx_${'a'.repeat(78)}`;
    expect(exerciseId).toHaveLength(81);
    expectFieldError(validate({ exercise: { exerciseId } }), `${EXERCISE_FIELD}.exerciseId`);
  });

  it.each([
    ['number', 12],
    ['object', { id: 'fx_squat' }],
    ['array', ['fx_squat']],
    ['null', null],
    ['boolean', true],
  ])('returns 400 when the id is a %s', (_, exerciseId) => {
    expectFieldError(validate({ exercise: { exerciseId } }), `${EXERCISE_FIELD}.exerciseId`);
  });

  it('omits an unknown exercise key in S1 rather than rejecting the request', () => {
    const result = validate({
      exercise: {
        vendorId: 'wger-123',
        animationPath: '/media/squat.mp4',
        thumbnailPath: '/media/squat.jpg',
        mediaVersion: 3,
        registry: { id: 'fx_squat' },
        substitutions: ['gx_squat'],
        progressions: ['fx_front_squat'],
        capability: { video: true },
        resolutionConfidence: 0.9,
        metadata: { source: 'client' },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.value.workoutPlan.days[0].exercises[0]).toEqual({
      name: 'Squat',
      sets: '3',
      reps: 10,
      rest: '60s',
    });
    expect(result.unknownExerciseKeys.map(entry => entry.key)).toEqual([
      'vendorId',
      'animationPath',
      'thumbnailPath',
      'mediaVersion',
      'registry',
      'substitutions',
      'progressions',
      'capability',
      'resolutionConfidence',
      'metadata',
    ]);
  });
});

describe('validatePlanRequest planSchemaVersion', () => {
  it('accepts the optional integer 1 at the top level', () => {
    const result = validate({ planSchemaVersion: PLAN_SCHEMA_VERSION });

    expect(result.error).toBeUndefined();
    expect(result.planSchemaVersion).toBe(1);
    expect(result.value).not.toHaveProperty('planSchemaVersion');
    expect(result.value.workoutPlan).not.toHaveProperty('planSchemaVersion');
  });

  it.each([
    ['string', '1'],
    ['float', 1.5],
    ['zero', 0],
    ['two', 2],
    ['null', null],
    ['boolean', true],
  ])('rejects a %s rather than coercing it', (_, planSchemaVersion) => {
    expectFieldError(validate({ planSchemaVersion }), 'planSchemaVersion');
  });

  it('still returns 400 for an unknown top-level key', () => {
    expectFieldError(validate({ extra: true }), 'extra');
  });

  it('still returns 400 for client-supplied resolution', () => {
    expectFieldError(
      validate({ workoutPlan: { resolution: 'client-owned', days: days() } }),
      'workoutPlan.resolution',
    );
    expectFieldError(
      validate({ exercise: { resolution: 'client-owned' } }),
      `${EXERCISE_FIELD}.resolution`,
    );
  });
});

describe('handleRequest stored and RPC shape', () => {
  it('forwards a valid fx_ id unchanged in the RPC plan payload', async () => {
    const exerciseId = 'fx_barbell_back_squat';
    const { res, admin } = await postReplace(body({
      exercise: { exerciseId },
      planSchemaVersion: 1,
    }));

    expect(res.statusCode).toBe(200);
    expect(admin.calls.rpc).toHaveLength(1);
    expect(admin.calls.rpc[0].name).toBe('replace_user_plans_atomic');

    const rpcArgs = admin.calls.rpc[0].args;
    expect(Object.keys(rpcArgs)).toEqual([
      'p_user_id',
      'p_client_attempt_id',
      'p_workout_coach_id',
      'p_workout_plan_type',
      'p_workout_week_start',
      'p_workout_week_number',
      'p_workout_activate_on',
      'p_workout_plan_data',
      'p_nutrition_plan_data',
    ]);
    expect(rpcArgs).not.toHaveProperty('planSchemaVersion');
    expect(JSON.stringify(rpcArgs)).not.toContain('planSchemaVersion');

    expect(Object.keys(rpcArgs.p_workout_plan_data)).toEqual(['coachId', 'days', 'gender']);
    expect(rpcArgs.p_workout_plan_data.coachId).toBe('aria');
    expect(rpcArgs.p_workout_plan_data.gender).toBe('female');
    expect(rpcArgs.p_workout_plan_data.days[0].exercises[0].exerciseId).toBe(exerciseId);
  });

  it('does not persist or forward planSchemaVersion', async () => {
    const { admin } = await postReplace(body({ planSchemaVersion: 1 }));
    const stored = admin.calls.rpc[0].args.p_workout_plan_data;

    expect(stored).toEqual({
      coachId: 'aria',
      days: expect.any(Array),
      gender: 'female',
    });
    expect(JSON.stringify(admin.calls.rpc[0].args)).not.toContain('planSchemaVersion');
  });

  it('keeps stored gender from the profile, not the request', async () => {
    const { admin } = await postReplace(
      body({ workoutPlan: { gender: 'male', days: days() } }),
      { gender: 'female' },
    );

    expect(admin.calls.rpc[0].args.p_workout_plan_data.gender).toBe('female');
    expect(admin.calls.rpc[0].args.p_workout_plan_data.days[0]).not.toHaveProperty('gender');
  });

  it('emits one structured diagnostic per unknown exercise field path', async () => {
    const { res, admin, warn } = await postReplace(body({
      exercise: { vendorId: 'secret-value', animationPath: '/x.mp4' },
      planSchemaVersion: 1,
    }));

    expect(res.statusCode).toBe(200);
    expect(admin.calls.rpc[0].args.p_workout_plan_data.days[0].exercises[0])
      .not.toHaveProperty('vendorId');
    expect(admin.calls.rpc[0].args.p_workout_plan_data.days[0].exercises[0])
      .not.toHaveProperty('animationPath');

    const events = warn.mock.calls.filter(([event]) => event === UNKNOWN_EXERCISE_KEY_EVENT);
    expect(events).toHaveLength(2);
    expect(events[0][1]).toEqual({
      requestId: 'abcd1234',
      field: `${EXERCISE_FIELD}.vendorId`,
      key: 'vendorId',
      planSchemaVersion: 1,
    });
    expect(events[1][1]).toEqual({
      requestId: 'abcd1234',
      field: `${EXERCISE_FIELD}.animationPath`,
      key: 'animationPath',
      planSchemaVersion: 1,
    });
    expect(JSON.stringify(events[0][1])).not.toContain('secret-value');
  });

  it('omits planSchemaVersion from the diagnostic when the client did not send it', async () => {
    const { warn } = await postReplace(body({
      exercise: { vendorId: 'wger-1' },
    }));

    const events = warn.mock.calls.filter(([event]) => event === UNKNOWN_EXERCISE_KEY_EVENT);
    expect(events).toHaveLength(1);
    expect(events[0][1]).toEqual({
      requestId: 'abcd1234',
      field: `${EXERCISE_FIELD}.vendorId`,
      key: 'vendorId',
    });
    expect(events[0][1]).not.toHaveProperty('planSchemaVersion');
  });
});

describe('handleRequest S1b telemetry', () => {
  it('still returns 200 when unknown exercise keys are present', async () => {
    const { res } = await postReplace(body({
      exercise: { vendorId: 'secret-value' },
    }));

    expect(res.statusCode).toBe(200);
  });

  it('sends exactly one Sentry message for unknown keys on multiple days and exercises', async () => {
    const { res, reportMessage } = await postReplace(body({
      planSchemaVersion: 1,
      workoutPlan: {
        days: sevenDays({
          0: [{ name: 'Squat', vendorId: 'secret-a', animationPath: '/a.mp4' }],
          1: [
            { name: 'Bench', vendorId: 'secret-b', extraField: 'x' },
            { name: 'Row', vendorId: 'secret-c', foo: 'y' },
          ],
        }),
      },
    }));

    expect(res.statusCode).toBe(200);
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage.mock.calls[0][0]).toBe(UNKNOWN_EXERCISE_KEY_EVENT);
    expect(reportMessage.mock.calls[0][1]).toBe('warning');
    expect(reportMessage.mock.calls[0][2]).toEqual({
      unknownKeyCount: 4,
      planSchemaVersion: 1,
    });
    expect(reportMessage.mock.calls[0][3]).toEqual({
      unknownKeys: ['vendorId', 'animationPath', 'extraField', 'foo'],
    });
  });

  it('dedupes the same unknown key name across days into one extra entry', async () => {
    const { reportMessage } = await postReplace(body({
      workoutPlan: {
        days: sevenDays({
          0: [{ name: 'Squat', vendorId: 'secret-a' }],
          1: [{ name: 'Bench', vendorId: 'secret-b' }],
          2: [{ name: 'Row', vendorId: 'secret-c' }],
        }),
      },
    }));

    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage.mock.calls[0][2].unknownKeyCount).toBe(1);
    expect(reportMessage.mock.calls[0][3].unknownKeys).toEqual(['vendorId']);
  });

  it('truncates the extra key list at the cap and still reports the distinct count', async () => {
    const extras = {};
    for (let i = 0; i < UNKNOWN_EXERCISE_KEY_NAME_CAP + 2; i += 1) {
      extras[`customKey${i}`] = `value-${i}`;
    }

    const { res, reportMessage } = await postReplace(body({
      exercise: extras,
    }));

    expect(res.statusCode).toBe(200);
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage.mock.calls[0][2].unknownKeyCount).toBe(UNKNOWN_EXERCISE_KEY_NAME_CAP + 2);
    expect(reportMessage.mock.calls[0][3].unknownKeys).toHaveLength(UNKNOWN_EXERCISE_KEY_NAME_CAP);
    expect(reportMessage.mock.calls[0][3].unknownKeys).toEqual(
      Array.from({ length: UNKNOWN_EXERCISE_KEY_NAME_CAP }, (_, i) => `customKey${i}`),
    );
    expect(reportMessage.mock.calls[0][3].unknownKeys).not.toContain(`customKey${UNKNOWN_EXERCISE_KEY_NAME_CAP}`);
  });

  it('truncates an oversized key name before sending it to Sentry', async () => {
    const longKey = `k${'x'.repeat(UNKNOWN_EXERCISE_KEY_NAME_MAX + 10)}`;
    const { reportMessage } = await postReplace(body({
      exercise: { [longKey]: 'hidden-value' },
    }));

    const sent = reportMessage.mock.calls[0][3].unknownKeys[0];
    expect(sent).toHaveLength(UNKNOWN_EXERCISE_KEY_NAME_MAX);
    expect(sent).toBe(longKey.slice(0, UNKNOWN_EXERCISE_KEY_NAME_MAX));
  });

  it('does not send exercise names, key values, userId, or plan content to Sentry', async () => {
    const { reportMessage } = await postReplace(body({
      exercise: { vendorId: 'secret-value', animationPath: '/media/squat.mp4' },
      planSchemaVersion: 1,
    }));

    const sent = sentryPayload(reportMessage);
    expect(sent).not.toContain('Squat');
    expect(sent).not.toContain('secret-value');
    expect(sent).not.toContain('/media/squat.mp4');
    expect(sent).not.toContain('user-1');
    expect(sent).not.toContain('Day 1');
    expect(sent).not.toContain('aria');
    expect(sent).not.toContain('female');
    expect(sent).not.toContain(ATTEMPT_ID);
    expect(sent).not.toContain('test-token');
    expect(sent).not.toContain('workoutPlan');
  });

  it('uses the fixed unknown-exercise-key message literal', async () => {
    const { reportMessage } = await postReplace(body({
      exercise: { vendorId: 'wger-1' },
    }));

    expect(reportMessage.mock.calls[0][0]).toBe('replace-plans unknown-exercise-key');
  });

  it('succeeds without throwing when SENTRY_DSN is absent', async () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      const { res, reportMessage } = await postReplace(
        body({ exercise: { vendorId: 'wger-1' } }),
        { useRealReportMessage: true },
      );

      expect(res.statusCode).toBe(200);
      expect(reportMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });

  it('emits no Sentry message on a clean request', async () => {
    const { res, reportMessage } = await postReplace(body({ planSchemaVersion: 1 }));

    expect(res.statusCode).toBe(200);
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('writes the version integer on a versioned success log and not to the RPC', async () => {
    const { info, admin } = await postReplace(body({ planSchemaVersion: 1 }));

    const ok = info.mock.calls.filter(([event]) => event === 'replace-plans ok');
    expect(ok).toHaveLength(1);
    expect(ok[0][1]).toEqual({
      requestId: 'abcd1234',
      userId: 'user-1',
      attemptId: ATTEMPT_ID,
      planSchemaVersion: PLAN_SCHEMA_VERSION,
    });
    expect(admin.calls.rpc[0].args.p_workout_plan_data).toEqual({
      coachId: 'aria',
      days: expect.any(Array),
      gender: 'female',
    });
    expect(JSON.stringify(admin.calls.rpc[0].args)).not.toContain('planSchemaVersion');
  });

  it('writes the legacy marker on an unversioned success log', async () => {
    const { info } = await postReplace(body());

    const ok = info.mock.calls.filter(([event]) => event === 'replace-plans ok');
    expect(ok).toHaveLength(1);
    expect(ok[0][1].planSchemaVersion).toBe(PLAN_SCHEMA_VERSION_ABSENT);
    expect(ok[0][1].planSchemaVersion).toBe('legacy');
  });
});
