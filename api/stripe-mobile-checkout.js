const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { priceId, userId, email } = req.body || {};
  if (!priceId || !userId) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customer = customers.data.length > 0 ? customers.data[0] : null;

    if (!customer) {
      customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { userId },
      });
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2023-10-16' }
    );

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId, plan: priceId, source: 'mobile' },
    });

    const invoice = subscription.latest_invoice;
    let clientSecret = null;

    if (typeof invoice === 'object' && invoice !== null) {
      if (invoice.confirmation_secret) {
        clientSecret = typeof invoice.confirmation_secret === 'object'
          ? invoice.confirmation_secret.client_secret
          : invoice.confirmation_secret;
      } else if (typeof invoice.payment_intent === 'object' && invoice.payment_intent?.client_secret) {
        clientSecret = invoice.payment_intent.client_secret;
      } else if (typeof invoice.payment_intent === 'string') {
        const pi = await stripe.paymentIntents.retrieve(invoice.payment_intent);
        clientSecret = pi.client_secret;
      }
    }

    if (!clientSecret) {
      return res.status(500).json({
        error: 'Could not create payment intent',
        subscriptionStatus: subscription.status,
        invoiceStatus: invoice?.status,
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
};
