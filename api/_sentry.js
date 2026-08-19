import * as Sentry from '@sentry/node';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || 'development',
    tracesSampleRate: 0,
  });
  initialized = true;
}

// Report an error to Sentry from a serverless function.
// Always awaits flush, because Vercel may freeze the function right after the response.
export async function reportError(error, context = {}) {
  try {
    ensureInit();
    if (!process.env.SENTRY_DSN) {
      console.warn('Sentry DSN missing, error not reported:', error?.message);
      return;
    }
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => scope.setTag(key, String(value)));
      Sentry.captureException(error);
    });
    await Sentry.flush(2000);
  } catch (err) {
    console.warn('Sentry reporting failed:', err?.message);
  }
}

// Tell Sentry a cron job has started. Returns a check-in id, or null if Sentry is not configured.
export function startCheckIn(monitorSlug) {
  try {
    ensureInit();
    if (!process.env.SENTRY_DSN) return null;
    return Sentry.captureCheckIn({ monitorSlug, status: 'in_progress' });
  } catch (err) {
    console.warn('Sentry check-in start failed:', err?.message);
    return null;
  }
}

// Close a cron check-in with 'ok' or 'error'. Always awaits flush.
export async function finishCheckIn(monitorSlug, checkInId, status) {
  try {
    if (!checkInId || !process.env.SENTRY_DSN) return;
    Sentry.captureCheckIn({ checkInId, monitorSlug, status });
    await Sentry.flush(2000);
  } catch (err) {
    console.warn('Sentry check-in finish failed:', err?.message);
  }
}
