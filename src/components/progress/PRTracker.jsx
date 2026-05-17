import { useEffect, useMemo, useState } from 'react';
import { FREE_LIMITS, userTier } from '../../config/tiers';
import { ProPaywall } from '../paywall/ProPaywall';

const STORAGE_KEY = 'dopapeak_prs';
const DEFAULT_PRS = [
  { exercise: 'Bench', weight: 85, previous: 80, date: '2026-05-12', unit: 'kg' },
  { exercise: 'Squat', weight: 100, previous: 100, date: '2026-05-08', unit: 'kg' },
  { exercise: 'Deadlift', weight: 120, previous: 110, date: '2026-05-15', unit: 'kg' },
];

function loadPrs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : DEFAULT_PRS;
    return Array.isArray(parsed) ? parsed : DEFAULT_PRS;
  } catch {
    return DEFAULT_PRS;
  }
}

function trend(pr) {
  const diff = Number(pr.weight) - Number(pr.previous || pr.weight);
  const unit = pr.unit || 'kg';
  if (diff > 0) return { label: `+${diff}${unit} ↑`, color: '#CCFF00' };
  if (diff < 0) return { label: `${diff}${unit} ↓`, color: '#FF4444' };
  return { label: '= same', color: 'rgba(255,255,255,0.45)' };
}

export function PRTracker() {
  const [prs, setPrs] = useState(loadPrs);
  const [open, setOpen] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [draft, setDraft] = useState({ exercise: 'Bench', weight: '', unit: 'kg', date: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prs));
    } catch {
      /* ignore private mode */
    }
  }, [prs]);

  const safePrs = Array.isArray(prs) ? prs : DEFAULT_PRS;
  const topPrs = useMemo(() => safePrs.slice(0, 3), [safePrs]);

  const save = () => {
    if (!draft.exercise.trim() || !Number(draft.weight)) return;
    const existing = safePrs.find(pr => pr.exercise.toLowerCase() === draft.exercise.trim().toLowerCase());
    const next = {
      exercise: draft.exercise.trim(),
      weight: Number(draft.weight),
      previous: existing?.weight ?? Number(draft.weight),
      unit: draft.unit,
      date: draft.date,
    };
    setPrs([next, ...safePrs.filter(pr => pr.exercise.toLowerCase() !== next.exercise.toLowerCase())]);
    setOpen(false);
    setDraft({ exercise: 'Bench', weight: '', unit: 'kg', date: new Date().toISOString().slice(0, 10) });
  };

  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Personal Records</p>
      <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-white/[0.08]">
        {topPrs.map(pr => {
          const t = trend(pr);
          return (
            <div key={pr.exercise} className="border-r border-white/[0.08] bg-[#101012] p-3 text-center last:border-r-0">
              <p className="m-0 text-xs font-black text-white">{pr.exercise}</p>
              <p className="mt-2 text-lg font-black text-white">{pr.weight} {pr.unit}</p>
              <p className="mt-1 text-xs font-black" style={{ color: t.color }}>{t.label}</p>
              <p className="mt-2 text-[10px] text-white/35">{new Date(pr.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          if (userTier === 'free' && !FREE_LIMITS.prTracker) {
            setShowPaywall(true);
            return;
          }
          setOpen(true);
        }}
        className="mt-3 w-full rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black"
      >
        + Add PR
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-5">
          <div className="w-full max-w-[340px] rounded-[22px] border border-white/10 bg-[#111113] p-4">
            <h3 className="m-0 mb-3 text-lg font-black">Add PR</h3>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-white/40">Exercise name</label>
            <input value={draft.exercise} onChange={e => setDraft(p => ({ ...p, exercise: e.target.value }))} className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-white outline-none" />
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-white/40">Weight</label>
            <div className="mb-3 flex gap-2">
              <input type="number" value={draft.weight} onChange={e => setDraft(p => ({ ...p, weight: e.target.value }))} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-white outline-none" />
              {['kg', 'lbs'].map(unit => (
                <button key={unit} type="button" onClick={() => setDraft(p => ({ ...p, unit }))} className={`rounded-xl px-3 text-sm font-black ${draft.unit === unit ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/60'}`}>
                  {unit}
                </button>
              ))}
            </div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-white/40">Date</label>
            <input type="date" value={draft.date} onChange={e => setDraft(p => ({ ...p, date: e.target.value }))} className="mb-4 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-white outline-none" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-white/10 bg-white/[0.06] py-3 font-black text-white">Maybe later</button>
              <button type="button" onClick={save} className="rounded-xl bg-[#CCFF00] py-3 font-black text-black">Save</button>
            </div>
          </div>
        </div>
      ) : null}

      <ProPaywall
        featureName="PR Tracker"
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={() => console.log('Payment integration coming soon')}
      />
    </section>
  );
}

