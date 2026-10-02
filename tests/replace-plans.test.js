import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  handleRequest,
  mapRpcError,
  PLAN_SAVE_OK_EVENT,
  PLAN_SCHEMA_VERSION,
  PLAN_SCHEMA_VERSION_ABSENT,
  UNKNOWN_EXERCISE_KEY_EVENT,
  UNKNOWN_EXERCISE_KEY_NAME_CAP,
  UNKNOWN_EXERCISE_KEY_NAME_MAX,
  validatePlanRequest,
} from '../api/replace-plans.js';
import * as sentry from '../api/_sentry.js';
import {
  callsWithPrefix,
  resetUpstash,
  seedWindow,
  upstash,
} from './_upstashFake.js';

vi.mock('@upstash/redis', async () => (await import('./_upstashFake.js')).redisModule);
vi.mock('@upstash/ratelimit', async () => (await import('./_upstashFake.js')).ratelimitModule);

// Every handler test runs against the in-memory limiter with fresh counts.
beforeEach(() => {
  resetUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

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

function fakeAdmin({ gender = 'female', age = 28, userId = 'user-1', rpcError = null } = {}) {
  const calls = { rpc: [], from: [] };
  return {
    calls,
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    from(table) {
      const record = { table, ops: [] };
      calls.from.push(record);
      return {
        select(cols) {
          record.ops.push({ op: 'select', cols });
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: { gender, age }, error: null }),
              };
            },
          };
        },
        insert() {
          record.ops.push({ op: 'insert' });
          throw new Error('unexpected insert');
        },
        update() {
          record.ops.push({ op: 'update' });
          throw new Error('unexpected update');
        },
        delete() {
          record.ops.push({ op: 'delete' });
          throw new Error('unexpected delete');
        },
      };
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      return {
        data: { workout_plan_id: 'wp-1', nutrition_plan_id: null, replayed: false },
        error: null,
      };
    },
  };
}

async function postReplace(payload, {
  gender = 'female', age = 28, useRealReportMessage = false, rpcError = null,
} = {}) {
  const admin = fakeAdmin({ gender, age, rpcError });
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

function sentryCallsByMessage(reportMessage, message) {
  return reportMessage.mock.calls.filter(([event]) => event === message);
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
      'p_expected_safety_fingerprint',
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
    const unknown = sentryCallsByMessage(reportMessage, UNKNOWN_EXERCISE_KEY_EVENT);
    expect(unknown).toHaveLength(1);
    expect(unknown[0][0]).toBe(UNKNOWN_EXERCISE_KEY_EVENT);
    expect(unknown[0][1]).toBe('warning');
    expect(unknown[0][2]).toEqual({
      unknownKeyCount: 4,
      planSchemaVersion: 1,
    });
    expect(unknown[0][3]).toEqual({
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

    const unknown = sentryCallsByMessage(reportMessage, UNKNOWN_EXERCISE_KEY_EVENT);
    expect(unknown).toHaveLength(1);
    expect(unknown[0][2].unknownKeyCount).toBe(1);
    expect(unknown[0][3].unknownKeys).toEqual(['vendorId']);
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
    const unknown = sentryCallsByMessage(reportMessage, UNKNOWN_EXERCISE_KEY_EVENT);
    expect(unknown).toHaveLength(1);
    expect(unknown[0][2].unknownKeyCount).toBe(UNKNOWN_EXERCISE_KEY_NAME_CAP + 2);
    expect(unknown[0][3].unknownKeys).toHaveLength(UNKNOWN_EXERCISE_KEY_NAME_CAP);
    expect(unknown[0][3].unknownKeys).toEqual(
      Array.from({ length: UNKNOWN_EXERCISE_KEY_NAME_CAP }, (_, i) => `customKey${i}`),
    );
    expect(unknown[0][3].unknownKeys).not.toContain(`customKey${UNKNOWN_EXERCISE_KEY_NAME_CAP}`);
  });

  it('truncates an oversized key name before sending it to Sentry', async () => {
    const longKey = `k${'x'.repeat(UNKNOWN_EXERCISE_KEY_NAME_MAX + 10)}`;
    const { reportMessage } = await postReplace(body({
      exercise: { [longKey]: 'hidden-value' },
    }));

    const unknown = sentryCallsByMessage(reportMessage, UNKNOWN_EXERCISE_KEY_EVENT);
    const sent = unknown[0][3].unknownKeys[0];
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

    const unknown = sentryCallsByMessage(reportMessage, UNKNOWN_EXERCISE_KEY_EVENT);
    expect(unknown).toHaveLength(1);
    expect(unknown[0][0]).toBe('replace-plans unknown-exercise-key');
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
      expect(sentryCallsByMessage(reportMessage, UNKNOWN_EXERCISE_KEY_EVENT)).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });

  it('emits no unknown-exercise-key Sentry message on a clean request', async () => {
    const { res, reportMessage } = await postReplace(body({ planSchemaVersion: 1 }));

    expect(res.statusCode).toBe(200);
    expect(sentryCallsByMessage(reportMessage, UNKNOWN_EXERCISE_KEY_EVENT)).toHaveLength(0);
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

describe('handleRequest S1c contract-version telemetry', () => {
  function versionEvents(reportMessage) {
    return sentryCallsByMessage(reportMessage, PLAN_SAVE_OK_EVENT);
  }

  it('sends exactly one info event tagged 1 on a successful versioned request', async () => {
    const { res, reportMessage, info } = await postReplace(body({ planSchemaVersion: 1 }));

    expect(res.statusCode).toBe(200);
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage.mock.calls[0][0]).toBe(PLAN_SAVE_OK_EVENT);
    expect(reportMessage.mock.calls[0][0]).toBe('replace-plans ok');
    expect(reportMessage.mock.calls[0][1]).toBe('info');
    expect(reportMessage.mock.calls[0][2]).toEqual({ planSchemaVersion: 1 });
    expect(reportMessage.mock.calls[0][2]).not.toHaveProperty('userId');
    expect(reportMessage.mock.calls[0][2]).not.toHaveProperty('attemptId');
    expect(reportMessage.mock.calls[0][2]).not.toHaveProperty('requestId');
    expect(reportMessage.mock.calls[0][3]).toEqual({ requestId: 'abcd1234' });
    const ok = info.mock.calls.filter(([event]) => event === 'replace-plans ok');
    expect(ok).toHaveLength(1);
  });

  it('sends exactly one info event tagged legacy on a successful unversioned request', async () => {
    const { res, reportMessage } = await postReplace(body());

    expect(res.statusCode).toBe(200);
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage.mock.calls[0][0]).toBe('replace-plans ok');
    expect(reportMessage.mock.calls[0][1]).toBe('info');
    expect(reportMessage.mock.calls[0][2]).toEqual({
      planSchemaVersion: PLAN_SCHEMA_VERSION_ABSENT,
    });
    expect(reportMessage.mock.calls[0][2].planSchemaVersion).toBe('legacy');
  });

  it('sends no version event on a failed request', async () => {
    const { res, reportMessage } = await postReplace(body({ coachId: 'not-a-coach' }));

    expect(res.statusCode).toBe(400);
    expect(versionEvents(reportMessage)).toHaveLength(0);
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('sends no version event when profile gender is missing', async () => {
    const { res, reportMessage } = await postReplace(body({ planSchemaVersion: 1 }), {
      gender: '',
    });

    expect(res.statusCode).toBe(422);
    expect(versionEvents(reportMessage)).toHaveLength(0);
  });

  it('does not pass plan content, coachId, gender, or userId to Sentry', async () => {
    const { reportMessage } = await postReplace(body({ planSchemaVersion: 1 }));

    const sent = sentryPayload(reportMessage);
    expect(sent).not.toContain('Squat');
    expect(sent).not.toContain('Day 1');
    expect(sent).not.toContain('Strength');
    expect(sent).not.toContain('aria');
    expect(sent).not.toContain('female');
    expect(sent).not.toContain('user-1');
    expect(sent).not.toContain(ATTEMPT_ID);
    expect(sent).not.toContain('workoutPlan');
    expect(sent).not.toContain('nutritionPlan');
  });

  it('uses the fixed replace-plans ok message literal', async () => {
    const { reportMessage } = await postReplace(body({ planSchemaVersion: 1 }));

    expect(reportMessage.mock.calls[0][0]).toBe('replace-plans ok');
    expect(reportMessage.mock.calls[0][0]).not.toContain('1');
    expect(reportMessage.mock.calls[0][0]).not.toContain('legacy');
  });

  it('succeeds without throwing when SENTRY_DSN is absent', async () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      const { res, reportMessage } = await postReplace(
        body({ planSchemaVersion: 1 }),
        { useRealReportMessage: true },
      );

      expect(res.statusCode).toBe(200);
      expect(reportMessage).toHaveBeenCalledTimes(1);
      expect(reportMessage.mock.calls[0][0]).toBe(PLAN_SAVE_OK_EVENT);
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });

  it('still stores only { coachId, days, gender } on the RPC payload', async () => {
    const { admin } = await postReplace(body({ planSchemaVersion: 1 }));
    const stored = admin.calls.rpc[0].args.p_workout_plan_data;

    expect(stored).toEqual({
      coachId: 'aria',
      days: expect.any(Array),
      gender: 'female',
    });
    expect(Object.keys(stored)).toEqual(['coachId', 'days', 'gender']);
    expect(JSON.stringify(admin.calls.rpc[0].args)).not.toContain('planSchemaVersion');
  });

  it('sends two separate Sentry events for unknown keys plus a version marker', async () => {
    const { res, reportMessage } = await postReplace(body({
      planSchemaVersion: 1,
      exercise: { vendorId: 'wger-1' },
    }));

    expect(res.statusCode).toBe(200);
    expect(reportMessage).toHaveBeenCalledTimes(2);
    expect(reportMessage.mock.calls[0][0]).toBe(UNKNOWN_EXERCISE_KEY_EVENT);
    expect(reportMessage.mock.calls[0][1]).toBe('warning');
    expect(reportMessage.mock.calls[1][0]).toBe(PLAN_SAVE_OK_EVENT);
    expect(reportMessage.mock.calls[1][1]).toBe('info');
    expect(reportMessage.mock.calls[1][2]).toEqual({ planSchemaVersion: 1 });
    expect(reportMessage.mock.calls[0][0]).not.toBe(reportMessage.mock.calls[1][0]);
  });
});

function expectAgeIneligible(res, admin, fieldAge) {
  expect(res.statusCode).toBe(422);
  expect(res.body).toEqual({
    error: 'Profile validation failed',
    code: 'age_ineligible',
    requestId: 'abcd1234',
    fields: { age: fieldAge },
  });
  expect(res.body.fields.age).toBe(fieldAge);
  expect(admin.calls.rpc).toHaveLength(0);
  // The entitlement gate reads user_entitlements before the profile lookup.
  expect(admin.calls.from.every(({ table }) => (
    table === 'profiles' || table === 'user_entitlements'
  ))).toBe(true);
  expect(admin.calls.from.some(({ table }) => (
    table === 'workout_plans' || table === 'nutrition_plans'
  ))).toBe(false);
  expect(admin.calls.from.flatMap(({ ops }) => ops).every(({ op }) => op === 'select')).toBe(true);
}

describe('handleRequest stored age gate', () => {
  it('returns 422 age_ineligible underage when stored age is 17 and does not call the RPC', async () => {
    const { res, admin } = await postReplace(body(), { age: 17 });
    expectAgeIneligible(res, admin, 'underage');
  });

  it('returns fields.age missing when stored age is null', async () => {
    const { res, admin } = await postReplace(body(), { age: null });
    expectAgeIneligible(res, admin, 'missing');
  });

  it.each([
    ['abc', 'abc'],
    [17.5, 17.5],
    [101, 101],
  ])('returns fields.age invalid when stored age is %s', async (age) => {
    const { res, admin } = await postReplace(body(), { age });
    expectAgeIneligible(res, admin, 'invalid');
  });

  it.each([18, 35])('proceeds to the RPC when stored age is %s', async (age) => {
    const { res, admin } = await postReplace(body(), { age });
    expect(res.statusCode).toBe(200);
    expect(admin.calls.rpc).toHaveLength(1);
    expect(admin.calls.rpc[0].name).toBe('replace_user_plans_atomic');
  });

  it('ignores request-body age 30 when stored age is 17', async () => {
    const { res, admin } = await postReplace(
      body({ workoutPlan: { age: 30, days: days() } }),
      { age: 17 },
    );
    expectAgeIneligible(res, admin, 'underage');
  });

  it('keeps the existing gender-missing 422 when gender is absent', async () => {
    const { res, admin } = await postReplace(body({ planSchemaVersion: 1 }), {
      gender: '',
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: 'Profile gender is not set; complete your profile before generating a plan',
      requestId: 'abcd1234',
    });
    expect(res.body).not.toHaveProperty('code');
    expect(admin.calls.rpc).toHaveLength(0);
  });
});

const VALID_TOKEN = `v1:${'0123456789abcdef'.repeat(4)}`;

function reconcileReads(admin) {
  return admin.calls.from.filter(({ table }) => table === 'workout_plans' || table === 'nutrition_plans');
}

describe('mapRpcError', () => {
  it.each([
    ['45409', { status: 409, error: 'Idempotency key reused with a different request shape' }],
    ['45410', { status: 409, error: 'Idempotency key already used by another write path' }],
    ['45404', { status: 401, error: 'Invalid or expired token' }],
    ['22004', { status: 400, error: 'Owner id and attempt id are required' }],
    ['45413', {
      status: 409,
      code: 'safety_profile_changed',
      error: 'Your profile changed while this plan was being built',
    }],
    ['45412', {
      status: 422,
      code: 'safety_fingerprint_unavailable',
      error: 'Profile safety data is unavailable',
    }],
    ['P0001', null],
    ['23505', null],
    [undefined, null],
    [null, null],
    [45413, null],
    ['', null],
  ])('maps %j', (code, expected) => {
    expect(mapRpcError(code)).toEqual(expected);
  });
});

describe('validatePlanRequest expectedSafetyFingerprint', () => {
  it('is optional and defaults to null', () => {
    const result = validate();
    expect(result.error).toBeUndefined();
    expect(result.value.expectedSafetyFingerprint).toBeNull();
  });

  it('accepts a v1 fingerprint unchanged', () => {
    const result = validate({ expectedSafetyFingerprint: VALID_TOKEN });
    expect(result.error).toBeUndefined();
    expect(result.value.expectedSafetyFingerprint).toBe(VALID_TOKEN);
  });

  it.each([
    ['uppercase hex', `v1:${'0123456789ABCDEF'.repeat(4)}`],
    ['wrong version', `v2:${'0123456789abcdef'.repeat(4)}`],
    ['too short', `v1:${'a'.repeat(63)}`],
    ['too long', `v1:${'a'.repeat(65)}`],
    ['non-hex', `v1:${'g'.repeat(64)}`],
    ['surrounding space', ` ${VALID_TOKEN}`],
    ['empty string', ''],
    ['null', null],
    ['number', 42],
    ['object', { value: VALID_TOKEN }],
  ])('rejects %s with 400 on expectedSafetyFingerprint', (_label, value) => {
    expectFieldError(validate({ expectedSafetyFingerprint: value }), 'expectedSafetyFingerprint');
  });
});

describe('handleRequest safety fingerprint token', () => {
  it('passes p_expected_safety_fingerprint null when the token is absent', async () => {
    const { res, admin } = await postReplace(body());

    expect(res.statusCode).toBe(200);
    const args = admin.calls.rpc[0].args;
    expect(args).toHaveProperty('p_expected_safety_fingerprint');
    expect(args.p_expected_safety_fingerprint).toBeNull();
  });

  it('forwards a valid token unchanged', async () => {
    const { res, admin } = await postReplace(body({ expectedSafetyFingerprint: VALID_TOKEN }));

    expect(res.statusCode).toBe(200);
    expect(admin.calls.rpc[0].args.p_expected_safety_fingerprint).toBe(VALID_TOKEN);
    expect(JSON.stringify(admin.calls.rpc[0].args.p_workout_plan_data)).not.toContain(VALID_TOKEN);
  });

  it('returns 400 for a malformed token and does not call the RPC', async () => {
    const { res, admin } = await postReplace(body({ expectedSafetyFingerprint: 'v1:nothex' }));

    expect(res.statusCode).toBe(400);
    expect(res.body.field).toBe('expectedSafetyFingerprint');
    expect(admin.calls.rpc).toHaveLength(0);
  });

  it('maps RPC 45413 to 409 safety_profile_changed without a reconcile read', async () => {
    const { res, admin } = await postReplace(body({ expectedSafetyFingerprint: VALID_TOKEN }), {
      rpcError: { code: '45413', message: 'plan_safety_profile_changed' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: 'Your profile changed while this plan was being built',
      code: 'safety_profile_changed',
      requestId: 'abcd1234',
    });
    expect(JSON.stringify(res.body)).not.toContain('plan_safety_profile_changed');
    expect(admin.calls.rpc).toHaveLength(1);
    expect(reconcileReads(admin)).toHaveLength(0);
  });

  it('maps RPC 45412 to 422 safety_fingerprint_unavailable without a reconcile read', async () => {
    const { res, admin } = await postReplace(body({ expectedSafetyFingerprint: VALID_TOKEN }), {
      rpcError: { code: '45412', message: 'plan_owner_safety_fingerprint_missing' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: 'Profile safety data is unavailable',
      code: 'safety_fingerprint_unavailable',
      requestId: 'abcd1234',
    });
    expect(JSON.stringify(res.body)).not.toContain('plan_owner_safety_fingerprint_missing');
    expect(reconcileReads(admin)).toHaveLength(0);
  });

  it('keeps returning the SQLSTATE as code for existing mapped errors', async () => {
    const { res, admin } = await postReplace(body(), {
      rpcError: { code: '45409', message: 'plan_attempt_shape_conflict' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: 'Idempotency key reused with a different request shape',
      code: '45409',
      requestId: 'abcd1234',
    });
    expect(reconcileReads(admin)).toHaveLength(0);
  });
});

describe('handleRequest rate limits', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-29T12:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function postWithAdmin(admin, { headers = { authorization: 'Bearer test-token' } } = {}) {
    const res = fakeRes();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(sentry, 'reportMessage').mockResolvedValue(undefined);
    await handleRequest(
      {
        method: 'POST',
        headers: { 'content-length': '128', ...headers },
        body: { ...body(), weekStart: todayUtc() },
      },
      res,
      'abcd1234',
      { admin },
    );
    return res;
  }

  function adminWithBadToken() {
    const admin = fakeAdmin();
    admin.auth.getUser = vi.fn(async () => ({ data: { user: null }, error: { message: 'invalid' } }));
    return admin;
  }

  it('checks the IP layer, then the per-user layer keyed by the Supabase user id', async () => {
    const { res } = await postReplace(body());
    expect(res.statusCode).toBe(200);
    expect(upstash.calls.map((call) => call.prefix)).toEqual(['rl:v2:ip:replace-plans', 'rl:v2:user:replace-plans']);
    expect(callsWithPrefix('rl:v2:user:')[0].identifier).toBe('user-1');
    expect(callsWithPrefix('q:v1:')).toHaveLength(0);
  });

  it('returns 429 with Retry-After after 5 saves in a minute, and never calls the RPC', async () => {
    seedWindow('rl:v2:user:replace-plans', 'user-1', 60000, 5);
    const { res, admin } = await postReplace(body());
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(Number(res.headers['Retry-After'])).toBeLessThanOrEqual(60);
    expect(res.body).toMatchObject({ code: 'rate_limited', requestId: 'abcd1234' });
    expect(res.body.error).toBe(res.body.message);
    expect(admin.calls.rpc).toHaveLength(0);
  });

  it('the IP layer runs before auth and returns 429 with Retry-After', async () => {
    seedWindow('rl:v2:ip:replace-plans', 'unknown', 60000, 30);
    const admin = fakeAdmin();
    admin.auth.getUser = vi.fn(admin.auth.getUser);
    const res = await postWithAdmin(admin);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(admin.auth.getUser).not.toHaveBeenCalled();
    expect(admin.calls.rpc).toHaveLength(0);
  });

  it('an invalid token uses no per-user minute slot', async () => {
    const res = await postWithAdmin(adminWithBadToken());
    expect(res.statusCode).toBe(401);
    expect(callsWithPrefix('rl:v2:user:')).toHaveLength(0);
  });

  it('a missing token uses no per-user minute slot', async () => {
    const res = await postWithAdmin(fakeAdmin(), { headers: {} });
    expect(res.statusCode).toBe(401);
    expect(callsWithPrefix('rl:v2:user:')).toHaveLength(0);
  });

  describe('limiter outage fails open and every other check still runs', () => {
    for (const mode of ['throw', 'timeout']) {
      it(`${mode}: a valid plan still saves through the RPC`, async () => {
        upstash.mode = mode;
        const { res, admin } = await postReplace(body());
        expect(res.statusCode).toBe(200);
        expect(res.headers).not.toHaveProperty('Retry-After');
        expect(admin.calls.rpc).toHaveLength(1);
      });

      it(`${mode}: the stored age gate still returns 422`, async () => {
        upstash.mode = mode;
        const { res, admin } = await postReplace(body(), { age: 17 });
        expect(res.statusCode).toBe(422);
        expect(admin.calls.rpc).toHaveLength(0);
      });

      it(`${mode}: a malformed safety fingerprint is still rejected with 400`, async () => {
        upstash.mode = mode;
        const { res, admin } = await postReplace(body({ expectedSafetyFingerprint: 'v1:nothex' }));
        expect(res.statusCode).toBe(400);
        expect(res.body.field).toBe('expectedSafetyFingerprint');
        expect(admin.calls.rpc).toHaveLength(0);
      });

      it(`${mode}: an invalid token is still rejected with 401`, async () => {
        upstash.mode = mode;
        const admin = adminWithBadToken();
        const res = await postWithAdmin(admin);
        expect(res.statusCode).toBe(401);
        expect(admin.calls.rpc).toHaveLength(0);
      });
    }

    it('missing limiter configuration: a valid plan still saves', async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      vi.resetModules();
      const { handleRequest: freshHandleRequest } = await import('../api/replace-plans.js');
      const admin = fakeAdmin();
      const res = fakeRes();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});
      await freshHandleRequest(
        {
          method: 'POST',
          headers: { authorization: 'Bearer test-token', 'content-length': '128' },
          body: { ...body(), weekStart: todayUtc() },
        },
        res,
        'abcd1234',
        { admin },
      );
      expect(res.statusCode).toBe(200);
      expect(admin.calls.rpc).toHaveLength(1);
    });
  });
});
