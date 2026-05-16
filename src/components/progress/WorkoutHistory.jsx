import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

const workoutHistory = [
  { id: 1, type: 'Strength', date: 'Today', duration: 45, exercises: 6, pr: 'Bench 85kg' },
  { id: 2, type: 'Cardio', date: 'Yesterday', duration: 30, exercises: null, pr: null },
  { id: 3, type: 'Mobility', date: '2 days ago', duration: 20, exercises: 4, pr: null },
];

const ICONS = {
  Strength: '💪',
  Cardio: '🏃',
  Mobility: '🧘',
};

export function WorkoutHistory() {
  const [toast, setToast] = useState(false);

  const showToast = () => {
    setToast(true);
    window.setTimeout(() => setToast(false), 1800);
  };

  return (
    <section className="relative rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Workout History</p>
      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
        {workoutHistory.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={showToast}
            className="flex w-full items-center gap-3 border-b border-white/[0.08] bg-[#101012] px-4 py-3 text-left last:border-b-0"
          >
            <span className="text-xl" aria-hidden>{ICONS[item.type]}</span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-black text-white">{item.date} · {item.type}</p>
              <p className="mt-1 text-xs text-white/45">
                {item.duration} min · {item.exercises ? `${item.exercises} exercises` : 'Zone 2'}
              </p>
              {item.pr ? <p className="mt-1 text-xs font-black text-[#CCFF00]">🏆 PR: {item.pr}</p> : null}
            </div>
            <ChevronRight size={18} className="text-white/35" />
          </button>
        ))}
      </div>

      {toast ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[#CCFF00]/30 bg-black px-4 py-2 text-xs font-bold text-[#CCFF00] shadow-xl">
          Workout detail coming soon
        </div>
      ) : null}
    </section>
  );
}

