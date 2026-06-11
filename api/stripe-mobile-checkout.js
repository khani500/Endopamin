import Stripe from 'stripe';

let stripeClient = null;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Stripe is not configured');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function extractClientSecret(invoice, subscription) {
  if (typeof invoice === 'object' && invoice !== null) {
    if (invoice.confirmation_secret) {
      const secret = typeof invoice.confirmation_secret === 'object'
        ? invoice.confirmation_secret.client_secret
        : invoice.confirmation_secret;
      if (secret) return secret;
    }

    if (typeof invoice.payment_intent === 'object' && invoice.payment_intent?.client_secret) {
      return invoice.payment_intent.client_secret;
    }
  }

  if (typeof subscription?.pending_setup_intent === 'object' && subscription.pending_setup_intent?.client_secret) {
    return subscription.pending_setup_intent.client_secret;
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { priceId, userId, email } = req.body || {};
  if (!priceId || !userId) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const stripe = getStripe();

    let customer = null;
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      customer = customers.data.length > 0 ? customers.data[0] : null;
    }

    if (!customer) {
      customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { userId },
      });
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2023-10-16' },
    );

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      expand: [
        'latest_invoice.confirmation_secret',
        'latest_invoice.payment_intent',
        'pending_setup_intent',
      ],
      metadata: { userId, plan: priceId, source: 'mobile' },
    });

    let invoice = subscription.latest_invoice;
    let clientSecret = extractClientSecret(invoice, subscription);

    const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id;
    if (!clientSecret && invoiceId) {
      invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ['confirmation_secret', 'payment_intent'],
      });
      clientSecret = extractClientSecret(invoice, subscription);
    }

    if (!clientSecret && typeof invoice?.payment_intent === 'string') {
      const pi = await stripe.paymentIntents.retrieve(invoice.payment_intent);
      clientSecret = pi.client_secret;
    }

    if (!clientSecret && typeof subscription.pending_setup_intent === 'string') {
      const setupIntent = await stripe.setupIntents.retrieve(subscription.pending_setup_intent);
      clientSecret = setupIntent.client_secret;
    }

    if (!clientSecret) {
      return res.status(500).json({
        error: 'Could not create payment intent',
        subscriptionStatus: subscription.status,
        invoiceStatus: typeof invoice === 'object' ? invoice?.status : null,
      });
    }

    return res.status(200).json({
      paymentIntent: clientSecret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      subscriptionId: subscription.id,
    });
  } catch (err) {
    console.error('Stripe mobile checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
