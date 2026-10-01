import Stripe from 'stripe';
import { reportError } from './_sentry.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    await reportError(err, { route: 'stripe-webhook', step: 'signature-verification' });
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Entitlement writes are disabled: Pro access is managed outside Stripe.
  console.log(`Stripe webhook received: ${event.type} (entitlement writes disabled)`);

  return res.status(200).json({ received: true, entitlementWrites: 'disabled' });
}
