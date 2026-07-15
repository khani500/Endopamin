import { createClient } from '@supabase/supabase-js';

function isValidUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const GRANT_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
]);

const REVOKE_EVENT_TYPES = new Set([
  'EXPIRATION',
]);

const NO_OP_EVENT_TYPES = new Set([
  'CANCELLATION',
  'BILLING_ISSUE',
  'SUBSCRIPTION_PAUSED',
  'TEST',
]);

function resolveUserId(event) {
  const candidates = [];

  if (event.app_user_id) candidates.push(event.app_user_id);
  if (event.original_app_user_id) candidates.push(event.original_app_user_id);
  if (Array.isArray(event.aliases)) {
    candidates.push(...event.aliases);
  }

  return candidates.find(isValidUuid) || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!webhookAuth) {
    console.error('REVENUECAT_WEBHOOK_AUTH is not configured');
    return res.status(500).json({ error: 'Webhook auth not configured' });
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== webhookAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    console.error('SUPABASE_URL is not configured');
    return res.status(500).json({ error: 'Supabase URL not configured' });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return res.status(500).json({ error: 'Supabase service role key not configured' });
  }

  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      console.error('Failed to parse RevenueCat webhook body:', err.message);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  const event = body?.event;
  if (!event) {
    return res.status(200).json({ received: true, ignored: true });
  }

  const userId = resolveUserId(event);
  if (!userId) {
    console.log('No valid Supabase user id in RC event');
    return res.status(200).json({ received: true, noUser: true });
  }

  console.log(`Resolved RevenueCat user ${userId} for event type ${event.type}`);

  let activationError = null;
  const eventType = event.type;

  if (GRANT_EVENT_TYPES.has(eventType)) {
    let proExpiresAt;
    if (typeof event.expiration_at_ms === 'number' && event.expiration_at_ms > 0) {
      proExpiresAt = new Date(event.expiration_at_ms).toISOString();
    }

    const updatePayload = { is_pro: true };
    if (proExpiresAt) {
      updatePayload.pro_expires_at = proExpiresAt;
    }

    let { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (error?.message?.includes('pro_expires_at')) {
      console.log('pro_expires_at column missing, retrying without it');
      ({ error } = await supabase
        .from('profiles')
        .update({ is_pro: true })
        .eq('id', userId));
    }

    if (error) {
      console.error(`Failed to grant Pro for user ${userId}:`, error.message);
      activationError = error;
    } else {
      console.log(`Granted Pro for user ${userId} (event: ${eventType})`);
    }
  } else if (REVOKE_EVENT_TYPES.has(eventType)) {
    const { error } = await supabase
      .from('profiles')
      .update({ is_pro: false })
      .eq('id', userId);

    if (error) {
      console.error(`Failed to revoke Pro for user ${userId}:`, error.message);
      activationError = error;
    } else {
      console.log(`Revoked Pro for user ${userId} (event: ${eventType})`);
    }
  } else if (NO_OP_EVENT_TYPES.has(eventType)) {
    console.log(`No-op for user ${userId} (event: ${eventType})`);
  } else {
    console.log(`Unknown event type for user ${userId}: ${eventType} — no-op`);
  }

  return res.status(activationError ? 500 : 200).json({
    received: true,
    type: eventType,
    userId,
    error: activationError?.message,
  });
}
