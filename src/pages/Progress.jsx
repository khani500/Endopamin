import { Link } from 'react-router-dom';
import { ShareCard } from '../components/progress/ShareCard';
import { PRTracker } from '../components/progress/PRTracker';
import { WorkoutHistory } from '../components/progress/WorkoutHistory';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function WeightChart() {
  const points = [82.8, 82.6, 82.2, 82.1, 81.9, 81.6, 81.5];
  const min = Math.min(...points);
  const max = Math.max(...points);

  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Weight Trend</p>
      <div className="flex h-40 items-end gap-2 rounded-2xl bg-black/30 p-3">
        {points.map((kg, index) => {
          const height = 24 + ((kg - min) / (max - min || 1)) * 90;
          return (
            <div key={`${kg}-${index}`} className="flex flex-1 flex-col items-center justify-end gap-2">
              <div className="w-full rounded-t-lg bg-[#CCFF00]" style={{ height }} />
              <span className="text-[9px] text-white/35">{kg.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorkoutStreakCalendar() {
  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Workout Streak</p>
      <div className="flex justify-between gap-2">
        {DAYS.map((day, index) => {
          const done = index < 5;
          return (
            <div key={`${day}-${index}`} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-[10px] font-bold text-white/35">{day}</span>
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${done ? 'border-[#CCFF00]/45 bg-[#CCFF00]/15 text-[#CCFF00]' : 'border-white/10 bg-black/30 text-white/25'}`}>
                {done ? '🔥' : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Progress() {
  return (
    <main className="mx-auto min-h-screen max-w-[390px] bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-[26px] font-black tracking-tight">Progress</h1>
          <p className="mt-1 text-sm text-white/45">Streaks, PRs, and workout history.</p>
        </div>
        <ShareCard />
      </header>

      <div className="space-y-4">
        <WeightChart />
        <PRTracker />
        <WorkoutStreakCalendar />
        <WorkoutHistory />
      </div>

      <Link to="/" className="mt-6 block rounded-2xl bg-[#CCFF00] py-3 text-center text-sm font-black text-black no-underline">
        Back to Home
      </Link>
    </main>
  );
}

