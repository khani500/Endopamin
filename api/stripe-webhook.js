import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function findUserIdByEmail(supabase, email) {
  if (!email) return null;

  const normalizedEmail = email.toLowerCase();
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('Failed to list users for email lookup:', error.message);
      return null;
    }

    const match = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);
    if (match) return match.id;

    if (!data.nextPage || data.users.length < perPage) break;
    page = data.nextPage;
  }

  return null;
}

async function resolveCustomerEmail(customerId, hints = {}) {
  if (hints.customerEmail) return hints.customerEmail;
  if (!customerId) return null;

  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.email || null;
  } catch (err) {
    console.error('Failed to retrieve Stripe customer:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

  const sig = req.headers['stripe-signature'];
  const rawBody = await buffer(req);

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  let activationError = null;

  async function activateProFromSubscription(subscription, customerId, hints = {}) {
    let userId = hints.userId || subscription.metadata?.userId;

    if (!userId && customerId) {
      const { data: profiles, error: profileLookupError } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .limit(1);

      if (profileLookupError) {
        console.error('Profile lookup by stripe_customer_id failed:', profileLookupError.message);
      } else {
        userId = profiles?.[0]?.id;
        if (userId) {
          console.log(`Resolved user ${userId} from stripe_customer_id ${customerId}`);
        }
      }
    }

    if (!userId) {
      const customerEmail = await resolveCustomerEmail(customerId, hints);
      if (customerEmail) {
        userId = await findUserIdByEmail(supabase, customerEmail);
        if (userId) {
          console.log(`Resolved user ${userId} from email ${customerEmail}`);
        }
      }
    }

    if (!userId) {
      console.log(`Could not find user for subscription ${subscription.id}`);
      return;
    }

    console.log(`Activating Pro for user ${userId}`);

    const plan = subscription.metadata?.plan;
    const daysToAdd = plan === 'yearly' ? 365 : 30;
    const proExpiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

    const updatePayload = {
      is_pro: true,
      stripe_customer_id: customerId || subscription.customer,
      stripe_subscription_id: subscription.id,
      pro_expires_at: proExpiresAt,
    };

    let { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (error?.message?.includes('pro_expires_at')) {
      console.log('pro_expires_at column missing, retrying without it');
      ({ error } = await supabase
        .from('profiles')
        .update({
          is_pro: true,
          stripe_customer_id: customerId || subscription.customer,
          stripe_subscription_id: subscription.id,
        })
        .eq('id', userId));
    }

    if (error) {
      console.error('Failed to activate Pro:', error.message);
      activationError = error;
      return;
    }

    console.log(`Pro activated successfully for user ${userId}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await activateProFromSubscription(subscription, session.customer, {
        userId: session.metadata?.userId,
        customerEmail: session.customer_details?.email || session.customer_email,
      });
    } else {
      console.log('checkout.session.completed without subscription, skipping activation');
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      await activateProFromSubscription(subscription, invoice.customer, {
        customerEmail: invoice.customer_email,
      });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const { error } = await supabase
      .from('profiles')
      .update({ is_pro: false })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Failed to deactivate Pro:', error.message);
      activationError = error;
    } else {
      console.log(`Pro deactivated for subscription ${subscription.id}`);
    }
  }

  return res.status(activationError ? 500 : 200).json({
    received: true,
    activated: !activationError,
    error: activationError?.message,
  });
}
