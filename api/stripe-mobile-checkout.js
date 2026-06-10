import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const MONTHLY_PRICE_ID = process.env.VITE_STRIPE_PRICE_MONTHLY
  || process.env.VITE_STRIPE_MONTHLY_PRICE_ID;
const YEARLY_PRICE_ID = process.env.VITE_STRIPE_PRICE_YEARLY
  || process.env.VITE_STRIPE_YEARLY_PRICE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { priceId, userId, email } = req.body || {};
  if (!priceId || !userId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const plan = priceId === YEARLY_PRICE_ID ? 'yearly' : 'monthly';

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://endopamin.vercel.app/pro-success?userId=${encodeURIComponent(userId)}`,
      cancel_url: 'https://endopamin.vercel.app/pro-cancel',
      customer_email: email || undefined,
      metadata: { userId, plan, source: 'mobile' },
      subscription_data: {
        metadata: { userId, plan, source: 'mobile' },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe mobile checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
