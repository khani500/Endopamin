import { reportError } from './_sentry.js';

// Temporary diagnostic route. Delete after verifying Sentry works.
export default async function handler(req, res) {
  const secret = process.env.SENTRY_TEST_KEY;
  if (!secret || req.query.key !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await reportError(new Error('Sentry test error from Vercel serverless'), {
    route: 'sentry-test',
    step: 'manual-check',
  });

  return res.status(200).json({ sent: true, dsnConfigured: Boolean(process.env.SENTRY_DSN) });
}
