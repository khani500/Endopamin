import { useEffect, useState } from 'react';

const BREATHING = [
  { label: 'IN', seconds: 4 },
  { label: 'HOLD', seconds: 4 },
  { label: 'OUT', seconds: 4 },
  { label: 'HOLD', seconds: 4 },
];

export function RestDayProtocol() {
  const [breathing, setBreathing] = useState(false);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!breathing) return undefined;
    const id = window.setInterval(() => setPhase(p => (p + 1) % BREATHING.length), 4000);
    return () => window.clearInterval(id);
  }, [breathing]);

  const current = BREATHING[phase];

  return (
    <section className="space-y-4 text-white">
      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.4); }
        }
      `}</style>
      <div>
        <p className="m-0 text-[10px] font-black uppercase tracking-[0.2em] text-[#CCFF00]">Rest & Recover</p>
      </div>

      <div className="rounded-[22px] border border-white/10 bg-[#141416] p-4">
        <p className="m-0 text-sm font-black">🌬️ BREATHING</p>
        <p className="mt-1 text-xs text-white/45">Box Breathing · 5 min</p>
        <div className="my-8 flex justify-center">
          <div
            className="flex h-28 w-28 flex-col items-center justify-center rounded-full border border-[#CCFF00]/45 bg-[#CCFF00]/10"
            style={{ animation: breathing ? 'breathe 4s ease-in-out infinite' : 'none' }}
          >
            <span className="text-lg font-black text-[#CCFF00]">{current.label}</span>
            <span className="text-sm font-bold text-white/60">{current.seconds}s</span>
          </div>
        </div>
        <button type="button" onClick={() => setBreathing(v => !v)} className="w-full rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black">
          {breathing ? 'Pause Breathing' : 'Start Breathing'}
        </button>
      </div>

      <div className="rounded-[22px] border border-white/10 bg-[#141416] p-4">
        <p className="m-0 text-sm font-black">🧘 MOBILITY</p>
        <p className="mt-1 text-xs text-white/45">Recovery Flow · 10 min</p>
        <ol className="my-5 space-y-2 pl-5 text-sm text-white/75">
          <li>Hip flexor stretch</li>
          <li>Thoracic rotation</li>
          <li>Cat-cow</li>
          <li>Child&apos;s pose</li>
          <li>Pigeon pose</li>
        </ol>
        <button type="button" className="w-full rounded-2xl border border-[#CCFF00]/45 bg-[#CCFF00]/10 py-3 text-sm font-black text-[#CCFF00]">
          Start Mobility
        </button>
      </div>
    </section>
  );
}

