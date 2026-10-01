import crypto from 'node:crypto';
import {
  createAdmin,
  isValidUuid,
  missingEnv,
  reconcileUser,
} from './_entitlement.js';
import { reportError } from './_sentry.js';

// Constant-time comparison. A length mismatch still runs one comparison so the
// time taken does not depend on where the values differ.
function safeEqual(received, expected) {
  const left = Buffer.from(String(received));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

// Every id the event names. TRANSFER carries transferred_from / transferred_to
// instead of app_user_id; both sides are reconciled.
function collectCandidateIds(event) {
  const candidates = [event.app_user_id, event.original_app_user_id];
  for (const key of ['aliases', 'transferred_from', 'transferred_to']) {
    if (Array.isArray(event[key])) candidates.push(...event[key]);
  }
  return [...new Set(candidates.filter((id) => typeof id === 'string' && id.length > 0))];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!webhookAuth) {
    await reportError(new Error('REVENUECAT_WEBHOOK_AUTH is not configured'), {
      route: 'revenuecat-webhook', step: 'config',
    });
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  if (!safeEqual(req.headers.authorization || '', webhookAuth)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const missing = missingEnv();
  if (missing.length > 0) {
    await reportError(new Error(`Missing environment variables: ${missing.join(', ')}`), {
      route: 'revenuecat-webhook', step: 'config',
    });
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  const event = body?.event;
  if (!event || typeof event !== 'object') {
    return res.status(200).json({ received: true, ignored: true });
  }

  const eventType = typeof event.type === 'string' ? event.type : null;
  const candidates = collectCandidateIds(event);
  const userIds = candidates.filter(isValidUuid);

  const admin = createAdmin();
  let reconciled = 0;
  let skipped = candidates.length - userIds.length;
  let failed = 0;

  for (const userId of userIds) {
    const result = await reconcileUser(admin, userId, { source: 'webhook', eventType });
    if (result.skipped) skipped += 1;
    else if (result.ok) reconciled += 1;
    else failed += 1;
  }

  // 500 makes RevenueCat retry; reconciliation is idempotent.
  if (failed > 0) {
    return res.status(500).json({ error: 'Reconciliation failed' });
  }
  return res.status(200).json({ received: true, reconciled, skipped });
}
