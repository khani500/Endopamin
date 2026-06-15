import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = req.body;

  let event;
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(rawBody.toString());
    }
  } catch (err) {
    console.error('Webhook parse error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  async function activateProFromSubscription(subscription, customerId) {
    const userId = subscription.metadata?.userId;
    if (!userId) return;

    const plan = subscription.metadata?.plan;
    const daysToAdd = plan === 'yearly' ? 365 : 30;
    const proExpiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

    const updatePayload = {
      is_pro: true,
      stripe_customer_id: customerId || subscription.customer,
      stripe_subscription_id: subscription.id,
      pro_expires_at: proExpiresAt,
    };

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (error?.message?.includes('pro_expires_at')) {
      await supabase
        .from('profiles')
        .update({
          is_pro: true,
          stripe_customer_id: customerId || subscription.customer,
          stripe_subscription_id: subscription.id,
        })
        .eq('id', userId);
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    if (userId && session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await activateProFromSubscription(subscription, session.customer);
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      await activateProFromSubscription(subscription, invoice.customer);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await supabase
      .from('profiles')
      .update({ is_pro: false })
      .eq('stripe_subscription_id', subscription.id);
  }

  return res.status(200).json({ received: true });
}
