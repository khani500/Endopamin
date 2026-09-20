import { afterEach, describe, expect, it, vi } from 'vitest';

const setTag = vi.fn();
const setExtra = vi.fn();
const captureMessage = vi.fn();
const captureException = vi.fn();
const flush = vi.fn().mockResolvedValue(true);
const init = vi.fn();
const captureCheckIn = vi.fn();
const withScope = vi.fn((cb) => cb({ setTag, setExtra }));

vi.mock('@sentry/node', () => ({
  init,
  withScope,
  captureMessage,
  captureException,
  flush,
  captureCheckIn,
}));

const { reportError, reportMessage } = await import('../api/_sentry.js');

afterEach(() => {
  delete process.env.SENTRY_DSN;
  setTag.mockClear();
  setExtra.mockClear();
  captureMessage.mockClear();
  captureException.mockClear();
  flush.mockClear();
  init.mockClear();
  captureCheckIn.mockClear();
  withScope.mockClear();
  vi.restoreAllMocks();
});

describe('reportMessage', () => {
  it('no-ops without throwing when SENTRY_DSN is absent', async () => {
    delete process.env.SENTRY_DSN;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(reportMessage('replace-plans unknown-exercise-key', 'warning', {
      unknownKeyCount: 1,
    }, {
      unknownKeys: ['vendorId'],
    })).resolves.toBeUndefined();

    expect(captureMessage).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('captures a message with tags, extra, level, and flush when DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.test/1';

    await reportMessage('replace-plans unknown-exercise-key', 'warning', {
      unknownKeyCount: 2,
      planSchemaVersion: 'legacy',
    }, {
      unknownKeys: ['vendorId', 'animationPath'],
    });

    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('replace-plans unknown-exercise-key', 'warning');
    expect(setTag).toHaveBeenCalledWith('unknownKeyCount', '2');
    expect(setTag).toHaveBeenCalledWith('planSchemaVersion', 'legacy');
    expect(setExtra).toHaveBeenCalledWith('unknownKeys', ['vendorId', 'animationPath']);
    expect(flush).toHaveBeenCalledWith(2000);
  });

  it('does not send an Error through captureMessage', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.test/1';

    await reportMessage('replace-plans unknown-exercise-key', 'warning', {}, {});

    const [message, level] = captureMessage.mock.calls[0];
    expect(typeof message).toBe('string');
    expect(message).not.toBeInstanceOf(Error);
    expect(level).toBe('warning');
  });
});

describe('reportError (unchanged)', () => {
  it('still uses captureException, not captureMessage', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.test/1';
    const err = new Error('boom');

    await reportError(err, { endpoint: 'replace-plans' });

    expect(captureException).toHaveBeenCalledWith(err);
    expect(captureMessage).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledWith(2000);
  });
});
