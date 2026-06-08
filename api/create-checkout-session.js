const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { priceId, userId, email } = req.body;

  if (!priceId || !userId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.VITE_APP_URL || 'https://endopamin.vercel.app'}/coach?upgraded=true`,
      cancel_url: `${process.env.VITE_APP_URL || 'https://endopamin.vercel.app'}/coach`,
      customer_email: email || undefined,
      metadata: { userId },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
};
