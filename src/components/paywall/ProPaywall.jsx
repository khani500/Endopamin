import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const FEATURES = [
  'All 5 AI Coaches',
  'Unlimited coaching chat',
  'Personalized workout plans (gym or home)',
  'Weekly auto-updated plans',
  'Custom nutrition & macros',
  'Food scanner & calorie logging',
  'Voice coach — step by step with you during your workout',
  'Full progress tracking',
  'Apple Health sync',
];

const FONT_LINK_ID = 'pro-paywall-fonts';
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700;800&display=swap';

export function ProPaywall({ featureName: _featureName = 'This feature', isVisible, onClose }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('monthly');

  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);

  if (!isVisible) return null;

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const priceId = selectedPlan === 'yearly'
        ? import.meta.env.VITE_STRIPE_PRICE_YEARLY
        : import.meta.env.VITE_STRIPE_PRICE_MONTHLY;

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        console.error('No access token available for checkout');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ priceId }),
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('No checkout URL returned:', data);
      }
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setLoading(false);
    }
  };

  const planCardBase = {
    flex: '1 1 0',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    borderRadius: 16,
    border: '2px solid',
    padding: '12px',
    textAlign: 'left',
    background: '#0A0A0A',
    transition: 'border-color 0.15s ease',
    fontFamily: "'DM Sans', sans-serif",
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/70">
      <div
        className="mx-auto w-full max-w-[390px] rounded-t-[28px] border border-white/10 p-5 pb-[max(24px,env(safe-area-inset-bottom))] text-white shadow-[0_-24px_80px_rgba(0,0,0,0.75)]"
        style={{ background: '#0A0A0A', fontFamily: "'DM Sans', sans-serif" }}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/15" />

        <h2
          className="m-0 text-center text-[32px] leading-none tracking-wide text-white"
          style={{ fontFamily: "'Bebas Neue', sans-serif" }}
        >
          Endopamin Pro
        </h2>

        <div className="mt-5 space-y-2.5">
          {FEATURES.map(feature => (
            <div key={feature} className="flex items-start gap-2.5 text-[13px] font-medium leading-snug text-white/90">
              <span className="mt-0.5 shrink-0 text-[14px] font-bold leading-none" style={{ color: '#CCFF00' }}>✓</span>
              <span>{feature}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[13px] font-medium text-white/50">
          Cancel anytime
        </p>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => setSelectedPlan('monthly')}
            style={{
              ...planCardBase,
              borderColor: selectedPlan === 'monthly' ? '#CCFF00' : 'rgba(255,255,255,0.15)',
            }}
          >
            {/* Reserve space matching Yearly's Best Value badge row */}
            <div className="mb-2 flex h-5 items-center justify-end">
              <span className="invisible rounded-full px-2 py-0.5 text-[10px] font-bold leading-none">Best Value</span>
            </div>
            <p
              className="text-[12px] font-bold uppercase tracking-wider"
              style={{ color: selectedPlan === 'monthly' ? '#CCFF00' : 'rgba(255,255,255,0.45)' }}
            >
              Monthly
            </p>
            <p className="mt-1 text-xl font-extrabold leading-none text-white">$17.99</p>
            <p className="mt-1 text-[11px] text-white/40">per month</p>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPlan('yearly')}
            style={{
              ...planCardBase,
              borderColor: selectedPlan === 'yearly' ? '#CCFF00' : 'rgba(255,255,255,0.15)',
            }}
          >
            <div className="mb-2 flex h-5 items-center justify-end">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold leading-none text-black"
                style={{ background: '#CCFF00' }}
              >
                Best Value
              </span>
            </div>
            <p
              className="text-[12px] font-bold uppercase tracking-wider"
              style={{ color: selectedPlan === 'yearly' ? '#CCFF00' : 'rgba(255,255,255,0.45)' }}
            >
              Yearly
            </p>
            <p className="mt-1 text-xl font-extrabold leading-none text-white">$143.99</p>
            <p className="mt-1 text-[11px] text-white/40">per year</p>
          </button>
        </div>

        <button
          type="button"
          onClick={handleSubscribe}
          disabled={loading}
          className="mt-5 w-full rounded-2xl py-4 text-[15px] font-extrabold text-black disabled:opacity-60"
          style={{ background: '#CCFF00', fontFamily: "'DM Sans', sans-serif" }}
        >
          {loading ? 'Redirecting...' : `Unlock Pro — ${selectedPlan === 'yearly' ? '$143.99/year' : '$17.99/month'}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full border-0 bg-transparent py-2 text-sm font-bold text-white/45"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
