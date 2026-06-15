import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const FEATURES = [
  'Unlimited AI Coach messages',
  'AI Voice Coach',
  'Full Nutrition Tracking',
  'Unlimited Progress History',
];

export function ProPaywall({ featureName = 'This feature', isVisible, onClose }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('monthly');

  if (!isVisible) return null;

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const priceId = selectedPlan === 'yearly'
        ? import.meta.env.VITE_STRIPE_PRICE_YEARLY
        : import.meta.env.VITE_STRIPE_PRICE_MONTHLY;

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId,
          userId: user?.id,
          email: user?.email,
        }),
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

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/70">
      <div className="mx-auto w-full max-w-[390px] rounded-t-[28px] border border-white/10 bg-[#1a1a1a] p-4 pb-[max(24px,env(safe-area-inset-bottom))] text-white shadow-[0_-24px_80px_rgba(0,0,0,0.75)]">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/15" />
        <h2 className="m-0 text-xl font-black">🔒 {featureName} is Pro</h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
          {FEATURES.map(feature => (
            <div key={feature} className="mb-2 flex items-center gap-2 text-sm font-bold last:mb-0">
              <span className="text-[#CCFF00]">✓</span>
              <span>{feature}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setSelectedPlan('monthly')}
            className="flex-1 rounded-2xl border p-3 text-left transition-all"
            style={{
              background: selectedPlan === 'monthly' ? 'rgba(204,255,0,0.08)' : '#0f0f10',
              borderColor: selectedPlan === 'monthly' ? 'rgba(204,255,0,0.4)' : 'rgba(255,255,255,0.1)',
            }}
          >
            <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: selectedPlan === 'monthly' ? '#CCFF00' : 'rgba(255,255,255,0.4)' }}>Monthly</p>
            <p className="mt-1 text-lg font-black text-white">$17.99</p>
            <p className="text-[10px] text-white/40">per month</p>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPlan('yearly')}
            className="flex-1 rounded-2xl border p-3 text-left transition-all relative overflow-hidden"
            style={{
              background: selectedPlan === 'yearly' ? 'rgba(255,193,7,0.08)' : '#0f0f10',
              borderColor: selectedPlan === 'yearly' ? 'rgba(255,193,7,0.4)' : 'rgba(255,255,255,0.1)',
            }}
          >
            <span className="absolute right-2 top-2 rounded-full bg-yellow-400 px-1.5 py-0.5 text-[9px] font-black text-black">SAVE 33%</span>
            <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: selectedPlan === 'yearly' ? '#FFC107' : 'rgba(255,255,255,0.4)' }}>Yearly</p>
            <p className="mt-1 text-lg font-black text-white">$143.99</p>
            <p className="text-[10px] text-white/40">per year</p>
          </button>
        </div>

        <button
          type="button"
          onClick={handleSubscribe}
          disabled={loading}
          className="mt-4 w-full rounded-2xl bg-[#CCFF00] py-4 text-[15px] font-black text-black disabled:opacity-60"
        >
          {loading ? 'Redirecting...' : `Unlock Pro — ${selectedPlan === 'yearly' ? '$143.99/year' : '$17.99/month'}`}
        </button>
        <button type="button" onClick={onClose} className="mt-3 w-full border-0 bg-transparent py-2 text-sm font-bold text-white/45">
          Maybe later
        </button>
      </div>
    </div>
  );
}
