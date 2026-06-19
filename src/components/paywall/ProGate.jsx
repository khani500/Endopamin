import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isProUser } from '../../config/tiers';
import { ProPaywall } from './ProPaywall';

const FEATURE_NAMES = {
  coachChat: 'AI Coach Chat',
  coachVoice: 'AI Coach Voice',
  nutritionTracking: 'Full Nutrition Tracking',
  progressHistory: 'Progress History',
};

export function ProGate({
  feature,
  featureName,
  children,
  fallback = null,
  historyDays = 0,
  onSubscribe,
}) {
  const { profile } = useAuth();
  const [showPaywall, setShowPaywall] = useState(false);
  const isPro = isProUser(profile);
  const locked = !isPro && isLockedFeature(feature, historyDays);

  if (!locked) return children;

  const name = featureName || FEATURE_NAMES[feature] || 'This feature';

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setShowPaywall(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') setShowPaywall(true);
        }}
      >
        {fallback || (
          <button
            type="button"
            className="w-full rounded-2xl border border-[#CCFF00]/30 bg-[#1a1a1a] px-4 py-4 text-sm font-black text-[#CCFF00]"
          >
            Unlock {name}
          </button>
        )}
      </div>

      <ProPaywall
        featureName={name}
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={onSubscribe || (() => console.log('Payment integration coming soon'))}
      />
    </>
  );
}

function isLockedFeature(feature, historyDays) {
  if (feature === 'coachChat') return true;
  if (feature === 'coachVoice') return true;
  if (feature === 'nutritionTracking') return true;
  if (feature === 'foodScanner') return true;
  if (feature === 'barcodeScanner') return true;
  if (feature === 'progressHistory') return Number(historyDays) > 7;
  return false;
}
