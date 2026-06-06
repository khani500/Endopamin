const FEATURES = ['AI Voice Coach', 'Full Nutrition Tracking', 'Unlimited Progress History', 'Group Sessions'];

export function ProPaywall({ featureName = 'This feature', isVisible, onClose, onSubscribe }) {
  if (!isVisible) return null;

  const subscribe = () => {
    if (onSubscribe) {
      onSubscribe();
      return;
    }
    console.log('Payment integration coming soon');
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

        <div className="mt-4 rounded-2xl border border-[#CCFF00]/25 bg-[#0f0f10] p-4">
          <p className="m-0 text-[11px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">Endopamin Pro</p>
          <p className="m-0 mt-2 text-2xl font-black">$14.99 <span className="text-sm text-white/45">/ month</span></p>

          <div className="mt-4 rounded-2xl border border-yellow-400/35 bg-yellow-400/10 p-3">
            <span className="rounded-full bg-yellow-400 px-2 py-1 text-[10px] font-black text-black">BEST VALUE</span>
            <p className="m-0 mt-3 text-lg font-black">$119.99 / year</p>
            <p className="m-0 mt-1 text-sm font-bold text-yellow-200">Save 33%</p>
          </div>
        </div>

        <button type="button" onClick={subscribe} className="mt-4 w-full rounded-2xl bg-[#CCFF00] py-4 text-[15px] font-black text-black">
          Unlock Pro — $14.99/month
        </button>
        <button type="button" onClick={onClose} className="mt-3 w-full border-0 bg-transparent py-2 text-sm font-bold text-white/45">
          Maybe later
        </button>
      </div>
    </div>
  );
}
