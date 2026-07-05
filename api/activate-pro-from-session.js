import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function activateProFromSubscription(subscription, userId) {
  if (!subscription.metadata?.userId || subscription.metadata.userId !== userId) {
    return { error: 'Subscription does not belong to this user', status: 403 };
  }

  const invoice = subscription.latest_invoice;
  const invoicePaid = typeof invoice === 'object'
    && (invoice.status === 'paid' || invoice.paid === true);

  const paidStatuses = ['active', 'trialing'];
  const isPaid = paidStatuses.includes(subscription.status)
    || (subscription.status === 'incomplete' && invoicePaid);

  if (!isPaid) {
    return {
      error: 'Subscription not active yet',
      status: 402,
      subscriptionStatus: subscription.status,
    };
  }

  const updatePayload = {
    is_pro: true,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
  };

  const { error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', userId);

  if (error) {
    return { error: error.message, status: 500 };
  }

  return { is_pro: true, status: 200, subscriptionStatus: subscription.status };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const userId = userData.user.id;

  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session.subscription) {
      return res.status(400).json({ error: 'Checkout session has no subscription' });
    }

    const subscription = await stripe.subscriptions.retrieve(session.subscription, {
      expand: ['latest_invoice'],
    });

    const result = await activateProFromSubscription(subscription, userId);
    if (result.error) {
      return res.status(result.status).json({
        error: result.error,
        status: result.subscriptionStatus,
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Activate pro from session error:', err);
    return res.status(500).json({ error: err.message });
  }
}
