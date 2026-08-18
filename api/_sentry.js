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
