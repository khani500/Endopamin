import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { Share2, X } from 'lucide-react';
import { FREE_LIMITS, userTier } from '../../config/tiers';
import { ProPaywall } from '../paywall/ProPaywall';

export function ShareCard({ streak = 12, level = 4, weeklyWorkouts = 5, highlight = '14% strength gain' }) {
  const [open, setOpen] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const cardRef = useRef(null);

  const cardStyle = {
    width: 1080,
    height: 1920,
    background: 'radial-gradient(circle at top, rgba(204,255,0,0.18), #0A0A0A 42%, #050505)',
    color: '#fff',
    padding: 92,
    fontFamily: 'Space Grotesk, system-ui, sans-serif',
    position: 'relative',
  };

  const renderPng = async () => {
    if (!cardRef.current) return null;
    return html2canvas(cardRef.current, {
      backgroundColor: '#0A0A0A',
      scale: 1,
      width: 1080,
      height: 1920,
    });
  };

  const savePng = async () => {
    const canvas = await renderPng();
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'dopapeak-story.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const sharePng = async () => {
    const canvas = await renderPng();
    if (!canvas) return;
    canvas.toBlob(async blob => {
      if (!blob) return;
      const file = new File([blob], 'dopapeak-story.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'DopaPeak', text: `${streak}-day streak` });
        return;
      }
      await savePng();
    }, 'image/png');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (userTier === 'free' && !FREE_LIMITS.shareCard) {
            setShowPaywall(true);
            return;
          }
          setOpen(true);
        }}
        aria-label="Share progress"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white"
      >
        <Share2 size={18} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/80 px-5 py-8">
          <div className="mx-auto max-w-[390px] rounded-[24px] border border-white/10 bg-[#111113] p-4 text-white">
            <div className="mb-4 flex items-center justify-between">
              <p className="m-0 text-sm font-black">پیش‌نمایش کارت:</p>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-white/10 bg-white/[0.06] p-2">
                <X size={16} />
              </button>
            </div>

            <div className="pointer-events-none fixed -left-[9999px] top-0">
              <div
                ref={cardRef}
                style={cardStyle}
              >
                <StoryCardContent streak={streak} level={level} weeklyWorkouts={weeklyWorkouts} highlight={highlight} />
              </div>
            </div>

            <div className="mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-[22px] bg-black">
              <div
                style={{
                  ...cardStyle,
                  transform: 'scale(0.2408)',
                  transformOrigin: 'top left',
                }}
              >
                <StoryCardContent streak={streak} level={level} weeklyWorkouts={weeklyWorkouts} highlight={highlight} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => void savePng()} className="rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black">
                💾 Save
              </button>
              <button type="button" onClick={() => void sharePng()} className="rounded-2xl border border-[#CCFF00]/40 bg-[#CCFF00]/10 py-3 text-sm font-black text-[#CCFF00]">
                📤 Share
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ProPaywall
        featureName="Share Card"
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={() => console.log('Payment integration coming soon')}
      />
    </>
  );
}

function StoryCardContent({ streak, level, weeklyWorkouts, highlight }) {
  return (
    <>
      <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: -2 }}>
        DOPA<span style={{ color: '#CCFF00' }}>PEAK</span>
      </div>
      <div style={{ marginTop: 330, textAlign: 'center' }}>
        <div style={{ fontSize: 260, fontWeight: 900, lineHeight: 1 }}>
          {streak} <span style={{ fontSize: 170 }}>🔥</span>
        </div>
        <div style={{ marginTop: 18, fontSize: 54, fontWeight: 900, letterSpacing: 10, color: '#CCFF00' }}>DAY STREAK</div>
      </div>
      <div style={{ marginTop: 220, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
        <div style={{ border: '2px solid rgba(204,255,0,0.35)', borderRadius: 36, padding: 42, textAlign: 'center' }}>
          <div style={{ fontSize: 72, fontWeight: 900 }}>LV.{level}</div>
        </div>
        <div style={{ border: '2px solid rgba(204,255,0,0.35)', borderRadius: 36, padding: 42, textAlign: 'center' }}>
          <div style={{ fontSize: 72, fontWeight: 900 }}>{weeklyWorkouts} WKT</div>
        </div>
      </div>
      <div style={{ marginTop: 220, borderLeft: '10px solid #CCFF00', paddingLeft: 28, fontSize: 52, fontWeight: 800 }}>
        &quot;{highlight}&quot;
      </div>
      <div style={{ position: 'absolute', right: 92, bottom: 92, fontSize: 44, color: 'rgba(255,255,255,0.5)' }}>@dopapeak</div>
    </>
  );
}

