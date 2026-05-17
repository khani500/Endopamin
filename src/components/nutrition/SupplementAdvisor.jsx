import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getCoach } from '../../config/coaches';
import { askGemini } from '../../lib/gemini';
import { getSupplementsForProfile } from '../../data/supplements';

export function SupplementAdvisor() {
  const { profile } = useAuth();
  const [selected, setSelected] = useState(null);
  const [advice, setAdvice] = useState('');
  const [loading, setLoading] = useState(false);
  const supplements = getSupplementsForProfile(profile);
  const coach = getCoach(profile?.coach_persona || 'elias');
  const experience = String(profile?.experience || 'intermediate').toLowerCase();
  const goal = String(profile?.goal || 'strength_gain').toLowerCase().replace(/\s+/g, '_');

  const openSupplement = async supplement => {
    setSelected(supplement);
    setAdvice('');
    setLoading(true);
    try {
      const text = await askGemini(
        `User goal: ${goal}. Experience: ${experience}. Explain in one sentence why ${supplement.name} may help.`,
        coach.personality,
      );
      setAdvice(text || `Coach ${coach.name.replace('Coach ', '')} recommends this because it supports your ${goal} plan.`);
    } catch {
      setAdvice(`Coach ${coach.name.replace('Coach ', '')} recommends this because it supports your ${goal} plan.`);
    }
    setLoading(false);
  };

  return (
    <section className="np-card">
      <p className="np-brand" style={{ marginBottom: 8 }}>Supplement Advisor</p>
      <p className="np-muted" style={{ marginBottom: 14 }}>
        Based on your level ({experience}) and goal ({goal.replace('_', ' ')}):
      </p>
      <div className="grid grid-cols-2 gap-2">
        {supplements.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => void openSupplement(item)}
            className="rounded-2xl border border-white/10 bg-[#101012] p-3 text-left"
          >
            <p className="text-sm font-black text-white">{item.emoji} {item.name}</p>
            <p className="mt-1 text-[10px] font-bold text-[#CCFF00]">Tier {item.tier}</p>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/70">
          <div className="mx-auto w-full max-w-[390px] rounded-t-3xl border border-white/10 bg-[#111] p-5 text-white">
            <p className="text-2xl">{selected.emoji}</p>
            <div className="mt-2 flex items-center justify-between">
              <h2 className="text-xl font-black">{selected.name}</h2>
              <span className="rounded-full bg-[#CCFF00] px-3 py-1 text-[10px] font-black text-black">Tier {selected.tier}</span>
            </div>
            <p className="mt-4 text-sm text-white/55">Dose: {selected.dose[experience] || selected.dose.intermediate}</p>
            <p className="mt-2 text-sm text-white/55">Timing: {selected.timing}</p>
            <p className="mt-4 rounded-2xl bg-[#1a1a1a] p-4 text-sm leading-6 text-white/75">
              {loading ? 'Coach is thinking...' : advice}
            </p>
            <button type="button" onClick={() => setSelected(null)} className="mt-4 w-full rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black">
              Got it
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
