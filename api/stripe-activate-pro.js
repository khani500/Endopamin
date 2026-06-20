import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, subscriptionId } = req.body || {};
  if (!userId || !subscriptionId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice'],
    });

    if (!subscription.metadata?.userId || subscription.metadata.userId !== userId) {
      return res.status(403).json({ error: 'Subscription does not belong to this user' });
    }

    const invoice = subscription.latest_invoice;
    const invoicePaid = typeof invoice === 'object'
      && (invoice.status === 'paid' || invoice.paid === true);

    const paidStatuses = ['active', 'trialing'];
    const isPaid = paidStatuses.includes(subscription.status)
      || (subscription.status === 'incomplete' && invoicePaid);

    if (!isPaid) {
      return res.status(402).json({
        error: 'Subscription not active yet',
        status: subscription.status,
      });
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
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ is_pro: true, status: subscription.status });
  } catch (err) {
    console.error('Stripe activate pro error:', err);
    return res.status(500).json({ error: err.message });
  }
}
