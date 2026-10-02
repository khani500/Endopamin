import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/_sentry.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  reportMessage: vi.fn().mockResolvedValue(undefined),
}));

const {
  ENFORCEMENT_ENV,
  NEGATIVE_RECHECK_TTL_MS,
  POSITIVE_RECHECK_TTL_MS,
  REPORT_THROTTLE_WINDOW_MS,
  REVALIDATE_COOLDOWN_MS,
  REVALIDATE_TIMEOUT_MS,
  decideFromRow,
  enforceEntitlement,
  isEnforcementOn,
  resetReportThrottleForTests,
  resetRevalidateCooldownForTests,
} = await import('../api/_entitlementGate.js');

beforeEach(() => {
  resetReportThrottleForTests();
  resetRevalidateCooldownForTests();
});

const NOW = new Date('2026-10-02T12:00:00Z');
const DAY_MS = 86400000;
const USER = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = 'req12345';

const iso = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

const STALE_SYNC = iso(-NEGATIVE_RECHECK_TTL_MS - 60000);
const RECENT_SYNC = iso(-60000);

const EFFECTIVE_ROW = { active: true, access_expires_at: iso(30 * DAY_MS), last_synced_at: STALE_SYNC };
const LIFETIME_ROW = { active: true, access_expires_at: null, last_synced_at: STALE_SYNC };
const inactiveRow = (lastSyncedAt) => ({ active: false, access_expires_at: null, last_synced_at: lastSyncedAt });
const expiredRow = (lastSyncedAt) => ({ active: true, access_expires_at: iso(-DAY_MS), last_synced_at: lastSyncedAt });

const VERSION_HEADERS = {
  'x-endopamin-platform': 'ios',
  'x-endopamin-app-version': '1.0.3',
  'x-endopamin-build': '13',
};

function fakeRes() {
  return {
    statusCode: null,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

// Read-only admin: one row lookup. Any write method would throw (undefined).
function fakeAdmin({ row = null, error = null, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      if (throws) throw new Error('db down');
      return {
        select: (columns) => ({
          eq: (column, value) => ({
            maybeSingle: async () => {
              calls.push({ table, columns, column, value });
              return { data: row, error };
            },
          }),
        }),
      };
    },
  };
}

async function run({
  mode, admin = fakeAdmin(), headers = VERSION_HEADERS, reconcileResult, reconcileThrows = false,
  endpoint = 'gemini', now = NOW, log = vi.fn(), report = vi.fn().mockResolvedValue(undefined),
  reconcileImpl, setTimer, clearTimer,
} = {}) {
  const res = fakeRes();
  const reconcile = vi.fn(reconcileImpl ?? (async () => {
    if (reconcileThrows) throw new Error('boom');
    return reconcileResult;
  }));
  const sent = await enforceEntitlement({ headers }, res, {
    admin,
    userId: USER,
    endpoint,
    requestId: REQUEST_ID,
    deps: {
      env: mode === undefined ? {} : { [ENFORCEMENT_ENV]: mode },
      now: () => now,
      reconcile,
      report,
      log,
      ...(setTimer ? { setTimer } : {}),
      ...(clearTimer ? { clearTimer } : {}),
    },
  });
  return {
    sent, res, log, report, reconcile, admin,
  };
}

function expectAllowed(outcome) {
  expect(outcome.sent).toBe(false);
  expect(outcome.res.statusCode).toBeNull();
  expect(outcome.res.body).toBeUndefined();
}

function expectBlocked(outcome) {
  expect(outcome.sent).toBe(true);
  expect(outcome.res.statusCode).toBe(402);
  expect(outcome.res.body).toEqual({
    error: 'Subscription required',
    code: 'subscription_required',
    requestId: REQUEST_ID,
  });
}

describe('isEnforcementOn', () => {
  it('only the exact string "on" is ON', () => {
    expect(isEnforcementOn({ [ENFORCEMENT_ENV]: 'on' })).toBe(true);
  });

  it.each([undefined, '', 'ON', 'On', 'true', '1', ' on', 'on ', 'off'])('%j is OFF', (value) => {
    expect(isEnforcementOn({ [ENFORCEMENT_ENV]: value })).toBe(false);
  });

  it('an absent variable is OFF', () => {
    expect(isEnforcementOn({})).toBe(false);
  });
});

describe('NEGATIVE_RECHECK_TTL_MS', () => {
  it('is 3 minutes', () => {
    expect(NEGATIVE_RECHECK_TTL_MS).toBe(180000);
  });
});

describe('decideFromRow', () => {
  it.each([true, false])('an effective row is allowed (enforcementOn=%s)', (enforcementOn) => {
    expect(decideFromRow({ row: EFFECTIVE_ROW, now: NOW, enforcementOn }))
      .toEqual({ action: 'allow', rowState: 'effective' });
    expect(decideFromRow({ row: LIFETIME_ROW, now: NOW, enforcementOn }))
      .toEqual({ action: 'allow', rowState: 'effective' });
  });

  it.each([true, false])('positive TTL boundary and stale lifetime row (enforcementOn=%s)', (enforcementOn) => {
    const effective = (lastSyncedAt) => ({ ...EFFECTIVE_ROW, last_synced_at: lastSyncedAt });
    const decide = (row) => decideFromRow({ row, now: NOW, enforcementOn });
    expect(POSITIVE_RECHECK_TTL_MS).toBe(DAY_MS);
    expect(decide(effective(iso(-(POSITIVE_RECHECK_TTL_MS - 1)))))
      .toEqual({ action: 'allow', rowState: 'effective' });
    expect(decide(effective(iso(-POSITIVE_RECHECK_TTL_MS))))
      .toEqual({ action: 'revalidate', rowState: 'effective' });
    expect(decide({ ...LIFETIME_ROW, last_synced_at: iso(-POSITIVE_RECHECK_TTL_MS) }))
      .toEqual({ action: 'revalidate', rowState: 'effective' });
    for (const lastSyncedAt of [null, 'not a date', iso(60000)]) {
      expect(decide(effective(lastSyncedAt)).action).toBe('revalidate');
    }
  });

  it.each([
    ['missing', null],
    ['inactive', inactiveRow(RECENT_SYNC)],
    ['expired', expiredRow(RECENT_SYNC)],
  ])('OFF + %s row -> would_block', (rowState, row) => {
    expect(decideFromRow({ row, now: NOW, enforcementOn: false }))
      .toEqual({ action: 'would_block', rowState });
  });

  it('ON + missing row -> reconcile', () => {
    expect(decideFromRow({ row: null, now: NOW, enforcementOn: true }))
      .toEqual({ action: 'reconcile', rowState: 'missing' });
  });

  it('TTL boundary: just inside blocks, at or past the TTL reconciles', () => {
    const inside = inactiveRow(iso(-(NEGATIVE_RECHECK_TTL_MS - 1)));
    const exact = inactiveRow(iso(-NEGATIVE_RECHECK_TTL_MS));
    const outside = inactiveRow(iso(-(NEGATIVE_RECHECK_TTL_MS + 1)));
    expect(decideFromRow({ row: inside, now: NOW, enforcementOn: true }).action).toBe('block');
    expect(decideFromRow({ row: exact, now: NOW, enforcementOn: true }).action).toBe('reconcile');
    expect(decideFromRow({ row: outside, now: NOW, enforcementOn: true }).action).toBe('reconcile');
  });

  it('an unreadable or future last_synced_at is never a negative cache hit', () => {
    for (const lastSyncedAt of [null, undefined, 'not a date', iso(60000)]) {
      expect(decideFromRow({ row: inactiveRow(lastSyncedAt), now: NOW, enforcementOn: true }))
        .toEqual({ action: 'reconcile', rowState: 'inactive' });
    }
  });
});

describe('enforceEntitlement: effective row', () => {
  it.each([undefined, 'on'])('mode %j -> allow, no reconcile, no log', async (mode) => {
    const outcome = await run({ mode, admin: fakeAdmin({ row: EFFECTIVE_ROW }) });
    expectAllowed(outcome);
    expect(outcome.reconcile).not.toHaveBeenCalled();
    expect(outcome.log).not.toHaveBeenCalled();
    expect(outcome.report).not.toHaveBeenCalled();
    expect(outcome.admin.calls).toEqual([{
      table: 'user_entitlements',
      columns: 'active, access_expires_at, last_synced_at',
      column: 'user_id',
      value: USER,
    }]);
  });
});

describe('enforceEntitlement: OFF (shadow mode)', () => {
  it.each([
    ['missing', null],
    ['inactive', inactiveRow(STALE_SYNC)],
    ['expired', expiredRow(STALE_SYNC)],
  ])('%s row -> allow, one would_block log, no reconcile', async (rowState, row) => {
    const outcome = await run({ mode: undefined, admin: fakeAdmin({ row }) });
    expectAllowed(outcome);
    expect(outcome.reconcile).not.toHaveBeenCalled();
    expect(outcome.report).not.toHaveBeenCalled();
    expect(outcome.log).toHaveBeenCalledTimes(1);
    expect(outcome.log).toHaveBeenCalledWith('entitlement.would_block', {
      endpoint: 'gemini',
      userId: USER,
      rowState,
      clientHeaders: 'present',
      platform: 'ios',
      version: '1.0.3',
      build: '13',
      requestId: REQUEST_ID,
    });
  });

  it('a header-less client is flagged', async () => {
    const outcome = await run({ mode: 'ON', headers: {} });
    expectAllowed(outcome);
    expect(outcome.log).toHaveBeenCalledTimes(1);
    expect(outcome.log).toHaveBeenCalledWith('entitlement.would_block', expect.objectContaining({
      rowState: 'missing', clientHeaders: 'missing', platform: null, version: null, build: null,
    }));
  });
});

describe('enforceEntitlement: ON', () => {
  it.each([
    ['inactive', inactiveRow(RECENT_SYNC)],
    ['expired', expiredRow(RECENT_SYNC)],
  ])('%s row synced within the TTL -> 402, no reconcile', async (_rowState, row) => {
    const outcome = await run({ mode: 'on', admin: fakeAdmin({ row }) });
    expectBlocked(outcome);
    expect(outcome.reconcile).not.toHaveBeenCalled();
    expect(outcome.report).not.toHaveBeenCalled();
  });

  it.each([
    ['negative row older than the TTL', inactiveRow(STALE_SYNC)],
    ['missing row', null],
  ])('%s -> reconcile once; active -> allow', async (_label, row) => {
    const admin = fakeAdmin({ row });
    const outcome = await run({
      mode: 'on', admin, reconcileResult: { ok: true, active: true, accessExpiresAt: iso(DAY_MS) },
    });
    expectAllowed(outcome);
    expect(outcome.reconcile).toHaveBeenCalledTimes(1);
    expect(outcome.reconcile).toHaveBeenCalledWith(admin, USER, { source: 'app_sync' });
    expect(outcome.log).not.toHaveBeenCalled();
    expect(outcome.report).not.toHaveBeenCalled();
  });

  it.each([
    ['negative row older than the TTL', inactiveRow(STALE_SYNC)],
    ['missing row', null],
  ])('%s -> reconcile once; inactive -> 402', async (_label, row) => {
    const outcome = await run({
      mode: 'on', admin: fakeAdmin({ row }), reconcileResult: { ok: true, active: false, accessExpiresAt: null },
    });
    expectBlocked(outcome);
    expect(outcome.reconcile).toHaveBeenCalledTimes(1);
    expect(outcome.report).not.toHaveBeenCalled();
  });

  it('TTL boundary: just inside blocks without reconcile, just outside reconciles', async () => {
    const inside = await run({
      mode: 'on',
      admin: fakeAdmin({ row: inactiveRow(iso(-(NEGATIVE_RECHECK_TTL_MS - 1))) }),
      reconcileResult: { ok: true, active: true, accessExpiresAt: null },
    });
    expectBlocked(inside);
    expect(inside.reconcile).not.toHaveBeenCalled();

    const outside = await run({
      mode: 'on',
      admin: fakeAdmin({ row: inactiveRow(iso(-(NEGATIVE_RECHECK_TTL_MS + 1))) }),
      reconcileResult: { ok: true, active: true, accessExpiresAt: null },
    });
    expectAllowed(outside);
    expect(outside.reconcile).toHaveBeenCalledTimes(1);
  });
});

describe('enforceEntitlement: verification failure fails open', () => {
  it.each([
    ['row read error', { admin: fakeAdmin({ error: { message: 'boom' } }) }, 'entitlement_gate_row_read_failed'],
    ['row read throws', { admin: fakeAdmin({ throws: true }) }, 'entitlement_gate_row_read_failed'],
    ['reconcile { ok: false }', { reconcileResult: { ok: false } }, 'entitlement_gate_reconcile_failed'],
    ['reconcile skipped', { reconcileResult: { skipped: 'no_profile' } }, 'entitlement_gate_reconcile_skipped'],
    ['reconcile throws', { reconcileThrows: true }, 'entitlement_gate_reconcile_threw'],
  ])('ON + %s -> allow and report', async (_label, setup, code) => {
    const outcome = await run({ mode: 'on', ...setup });
    expectAllowed(outcome);
    expect(outcome.report).toHaveBeenCalledTimes(1);
    expect(outcome.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: code }),
      expect.objectContaining({
        area: 'entitlement-gate', code, endpoint: 'gemini', userId: USER,
      }),
    );
    expect(outcome.log).toHaveBeenCalledTimes(1);
    expect(outcome.log).toHaveBeenCalledWith('entitlement.check_failed', expect.objectContaining({ code }));
  });

  it('OFF + row read error -> allow and report, no would_block', async () => {
    const outcome = await run({ mode: undefined, admin: fakeAdmin({ error: { message: 'boom' } }) });
    expectAllowed(outcome);
    expect(outcome.report).toHaveBeenCalledTimes(1);
    expect(outcome.reconcile).not.toHaveBeenCalled();
    expect(outcome.log).not.toHaveBeenCalledWith('entitlement.would_block', expect.anything());
  });

  it('a failing reporter still allows the request', async () => {
    const res = fakeRes();
    const sent = await enforceEntitlement({ headers: {} }, res, {
      admin: fakeAdmin({ error: { message: 'boom' } }),
      userId: USER,
      endpoint: 'tts',
      requestId: REQUEST_ID,
      deps: {
        env: { [ENFORCEMENT_ENV]: 'on' },
        now: () => NOW,
        report: vi.fn().mockRejectedValue(new Error('sentry down')),
        log: vi.fn(),
      },
    });
    expect(sent).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});

describe('enforceEntitlement: Sentry throttle on fail open', () => {
  const readError = () => fakeAdmin({ error: { message: 'boom' } });
  const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);

  it('is a 1 minute window', () => {
    expect(REPORT_THROTTLE_WINDOW_MS).toBe(60000);
  });

  it('same endpoint and code inside the window -> one report, two logs; reported again after it', async () => {
    const log = vi.fn();
    const report = vi.fn().mockResolvedValue(undefined);
    const shared = { mode: 'on', log, report };

    expectAllowed(await run({ ...shared, admin: readError() }));
    expectAllowed(await run({ ...shared, admin: readError(), now: at(REPORT_THROTTLE_WINDOW_MS - 1) }));
    expect(report).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(2);

    expectAllowed(await run({ ...shared, admin: readError(), now: at(REPORT_THROTTLE_WINDOW_MS) }));
    expect(report).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('a different endpoint or a different code is reported independently', async () => {
    const log = vi.fn();
    const report = vi.fn().mockResolvedValue(undefined);
    const shared = { mode: 'on', log, report };

    await run({ ...shared, admin: readError() });
    await run({ ...shared, admin: readError(), endpoint: 'tts' });
    await run({ ...shared, reconcileResult: { ok: false } });
    await run({ ...shared, admin: readError() });

    expect(report).toHaveBeenCalledTimes(3);
    expect(report.mock.calls.map(([err, context]) => `${context.endpoint}:${err.message}`)).toEqual([
      'gemini:entitlement_gate_row_read_failed',
      'tts:entitlement_gate_row_read_failed',
      'gemini:entitlement_gate_reconcile_failed',
    ]);
    expect(log).toHaveBeenCalledTimes(4);
  });
});

describe('enforceEntitlement: stale effective row is re-verified', () => {
  const STALE_EFFECTIVE_ROW = { ...EFFECTIVE_ROW, last_synced_at: iso(-POSITIVE_RECHECK_TTL_MS - 60000) };
  const staleAdmin = () => fakeAdmin({ row: STALE_EFFECTIVE_ROW });
  const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);
  const ACTIVE = { ok: true, active: true, accessExpiresAt: iso(30 * DAY_MS) };
  const INACTIVE = { ok: true, active: false, accessExpiresAt: null };
  const REVALIDATE_FIELDS = {
    endpoint: 'gemini',
    userId: USER,
    rowState: 'effective',
    verified: 'revalidate',
    result: 'inactive',
    clientHeaders: 'present',
    platform: 'ios',
    version: '1.0.3',
    build: '13',
    requestId: REQUEST_ID,
  };

  // Hands the gate a timer that fires only when the test says so.
  function manualTimer() {
    const timer = { fire: null, setTimer: vi.fn(), clearTimer: vi.fn() };
    timer.setTimer.mockImplementation((fn, ms) => {
      timer.fire = fn;
      timer.ms = ms;
      return 'timer-1';
    });
    return timer;
  }

  it.each([undefined, 'on'])('mode %j: still active -> allow, timer cleared, no log', async (mode) => {
    const timer = manualTimer();
    const admin = staleAdmin();
    const outcome = await run({
      mode, admin, reconcileResult: ACTIVE, setTimer: timer.setTimer, clearTimer: timer.clearTimer,
    });
    expectAllowed(outcome);
    expect(outcome.reconcile).toHaveBeenCalledTimes(1);
    expect(outcome.reconcile).toHaveBeenCalledWith(admin, USER, { source: 'app_sync' });
    expect(timer.ms).toBe(REVALIDATE_TIMEOUT_MS);
    expect(timer.clearTimer).toHaveBeenCalledWith('timer-1');
    expect(outcome.log).not.toHaveBeenCalled();
    expect(outcome.report).not.toHaveBeenCalled();
  });

  it('ON + now inactive -> 402 and a blocked log verified by revalidate', async () => {
    const outcome = await run({ mode: 'on', admin: staleAdmin(), reconcileResult: INACTIVE });
    expectBlocked(outcome);
    expect(outcome.log).toHaveBeenCalledTimes(1);
    expect(outcome.log).toHaveBeenCalledWith('entitlement.blocked', REVALIDATE_FIELDS);
  });

  it('OFF + now inactive -> allow and a would_block log verified by revalidate', async () => {
    const outcome = await run({ mode: undefined, admin: staleAdmin(), reconcileResult: INACTIVE });
    expectAllowed(outcome);
    expect(outcome.reconcile).toHaveBeenCalledTimes(1);
    expect(outcome.log).toHaveBeenCalledTimes(1);
    expect(outcome.log).toHaveBeenCalledWith('entitlement.would_block', REVALIDATE_FIELDS);
  });

  it.each([
    ['{ ok: false } (includes 404 while active)', { reconcileResult: { ok: false } }, 'entitlement_gate_revalidate_failed'],
    ['skipped', { reconcileResult: { skipped: 'no_profile' } }, 'entitlement_gate_revalidate_skipped'],
    ['throws', { reconcileThrows: true }, 'entitlement_gate_revalidate_threw'],
  ])('ON + reconcile %s -> allow and report its own code', async (_label, setup, code) => {
    const outcome = await run({ mode: 'on', admin: staleAdmin(), ...setup });
    expectAllowed(outcome);
    expect(outcome.report).toHaveBeenCalledTimes(1);
    expect(outcome.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: code }),
      expect.objectContaining({ area: 'entitlement-gate', code, endpoint: 'gemini' }),
    );
    expect(outcome.log).toHaveBeenCalledWith('entitlement.check_failed', expect.objectContaining({
      code, rowState: 'effective',
    }));
  });

  it('timeout -> allow with the timeout code; a later rejection is handled', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const timer = manualTimer();
      let rejectLate;
      const reconcileImpl = () => new Promise((_resolve, reject) => {
        rejectLate = reject;
        Promise.resolve().then(() => timer.fire());
      });
      const outcome = await run({
        mode: 'on', admin: staleAdmin(), reconcileImpl, setTimer: timer.setTimer, clearTimer: timer.clearTimer,
      });
      expectAllowed(outcome);
      expect(outcome.report).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'entitlement_gate_revalidate_timeout' }),
        expect.anything(),
      );

      rejectLate(new Error('late'));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('cooldown: a second request inside 10 minutes skips reconcile; after it, reconciles again', async () => {
    expect(REVALIDATE_COOLDOWN_MS).toBe(10 * 60 * 1000);
    const reconcileImpl = vi.fn(async () => ({ ok: false }));
    const shared = { mode: 'on', reconcileImpl };

    expectAllowed(await run({ ...shared, admin: staleAdmin() }));
    expectAllowed(await run({ ...shared, admin: staleAdmin(), now: at(REVALIDATE_COOLDOWN_MS - 1) }));
    expect(reconcileImpl).toHaveBeenCalledTimes(1);

    expectAllowed(await run({ ...shared, admin: staleAdmin(), now: at(REVALIDATE_COOLDOWN_MS) }));
    expect(reconcileImpl).toHaveBeenCalledTimes(2);
  });
});
