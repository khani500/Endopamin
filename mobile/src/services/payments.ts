import { env } from '../config/env';

export type StripePlan = 'annual' | 'monthly';

export async function createSubscriptionPaymentSheet(params: {
  clerkUserId: string;
  email?: string;
  plan: StripePlan;
}) {
  if (!env.supabaseFunctionsUrl) {
    throw new Error('Set EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL to call payment functions.');
  }

  const response = await fetch(`${env.supabaseFunctionsUrl}/create-stripe-subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Stripe subscription function failed: ${response.status}`);
  }

  return response.json() as Promise<{
    customerId: string;
    subscriptionId: string;
    paymentIntentClientSecret: string;
    ephemeralKeySecret: string;
  }>;
}
