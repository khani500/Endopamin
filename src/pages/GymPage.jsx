import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DeskBreakSession } from '../components/desk/DeskBreakSession';
import { DESK_BREAKS } from '../data/deskBreaks';

export default function GymPage() {
  const { profile } = useAuth();
  const [activeDeskBreak, setActiveDeskBreak] = useState(null);
  const showDeskBreaks = !profile || profile.job_type === 'desk_worker';

  if (activeDeskBreak) {
    return <DeskBreakSession breakId={activeDeskBreak} onComplete={() => setActiveDeskBreak(null)} />;
  }

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-6">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-[#CCFF00]">Gym Mode</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Train smarter today</h1>
        <p className="mt-2 text-sm leading-6 text-white/45">
          Strength, mobility, and recovery tools built around your lifestyle.
        </p>
      </header>

      {showDeskBreaks && (
        <section className="mb-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">Desk Breaks</p>
          <div className="grid grid-cols-3 gap-2">
            {DESK_BREAKS.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveDeskBreak(item.id)}
                className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-3 text-center"
              >
                <p className="text-lg font-bold text-[#CCFF00]">{item.duration}m</p>
                <p className="mt-1 text-xs font-medium text-white">{item.title}</p>
                <p className="mt-0.5 text-[10px] text-gray-500">{item.exercises.length} moves</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {profile && !showDeskBreaks && (
        <section className="mb-6 rounded-3xl border border-white/10 bg-[#141416] p-5">
          <p className="text-sm font-bold text-white">Desk Worker Mode</p>
          <p className="mt-2 text-sm leading-6 text-white/45">
            Choose Desk Job in onboarding/profile to unlock quick mobility breaks between work blocks.
          </p>
        </section>
      )}

      <section className="rounded-3xl border border-white/10 bg-[#141416] p-5">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Today</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Strength', '45 min'],
            ['Mobility', '15 min'],
            ['HIIT', '22 min'],
            ['Recovery', '10 min'],
          ].map(([title, duration]) => (
            <button key={title} className="rounded-2xl bg-white/[0.04] p-4 text-left">
              <p className="text-sm font-bold text-white">{title}</p>
              <p className="mt-1 text-xs text-white/40">{duration}</p>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

