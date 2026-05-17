import { Link } from 'react-router-dom';
import { ShareCard } from '../components/progress/ShareCard';
import { PRTracker } from '../components/progress/PRTracker';
import { WorkoutHistory } from '../components/progress/WorkoutHistory';
import { ProPaywall } from '../components/paywall/ProPaywall';
import { FREE_LIMITS, userTier } from '../config/tiers';
import { useState } from 'react';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function WeightChart() {
  const points = [82.8, 82.6, 82.2, 82.1, 81.9, 81.6, 81.5];
  const labels = ['May 9', 'May 10', 'May 11', 'May 12', 'May 13', 'May 14', 'May 15'];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const width = 330;
  const height = 160;
  const padX = 18;
  const padY = 18;
  const coords = points.map((kg, index) => {
    const x = padX + (index / (points.length - 1)) * (width - padX * 2);
    const y = height - padY - ((kg - min) / (max - min || 1)) * (height - padY * 2);
    return { x, y, kg };
  });
  const linePath = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Weekly Weight Trend</p>
          <p className="mt-1 text-xs font-bold text-white/45">kg · last 7 logs</p>
        </div>
        <p className="m-0 text-2xl font-black text-[#007AFF]">{points.at(-1)}kg</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/35 p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" role="img" aria-label="Weekly weight trend graph">
          {[0, 1, 2, 3].map(row => {
            const y = padY + row * ((height - padY * 2) / 3);
            return <line key={row} x1="0" x2={width} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
          })}
          {coords.map(point => (
            <line key={`v-${point.x}`} x1={point.x} x2={point.x} y1={padY} y2={height - padY} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}
          <path d={linePath} fill="none" stroke="#007AFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {coords.map((point, index) => (
            <g key={`${point.kg}-${index}`}>
              <circle cx={point.x} cy={point.y} r="5.5" fill="#007AFF" />
              <circle cx={point.x} cy={point.y} r="9" fill="rgba(0,122,255,0.14)" />
            </g>
          ))}
        </svg>
        <div className="grid grid-cols-7 gap-1 px-1 pb-1">
          {labels.map(label => (
            <span key={label} className="text-center text-[9px] font-bold text-white/30">{label.replace('May ', '')}</span>
          ))}
        </div>
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
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border ${done ? 'border-[#CCFF00]/45 bg-[#CCFF00] text-black' : 'border-white/10 bg-black/30 text-white/25'}`}>
                {done ? '✓' : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GroupIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="#CCFF00" strokeWidth="1.8" />
      <circle cx="17" cy="9" r="2.4" stroke="#CCFF00" strokeWidth="1.6" opacity="0.75" />
      <path d="M4 19c.8-3.4 2.7-5 5-5s4.2 1.6 5 5" stroke="#CCFF00" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 16c.8-1.2 1.9-1.8 3.1-1.8 1.8 0 3.2 1.2 3.9 3.8" stroke="#CCFF00" strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

function GroupSessions() {
  const [showPaywall, setShowPaywall] = useState(false);
  const sessions = [
    'Session 1: Powerlifting with Sarah & Mike - ActiveNow',
    'Session 2: Morning Cardio with Team Delta - 7 AM Tomorrow',
  ];

  const openGroupSessions = () => {
    if (userTier === 'free' && !FREE_LIMITS.groupSessions) {
      setShowPaywall(true);
      return;
    }
    console.log('Group sessions coming soon');
  };

  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[#CCFF00]/35 bg-[#CCFF00]/10">
          <GroupIcon />
        </div>
        <div>
          <p className="m-0 text-sm font-black text-white">Group Sessions</p>
          <p className="mt-1 text-xs text-white/40">Train with your crew.</p>
        </div>
      </div>

      <button
        type="button"
        onClick={openGroupSessions}
        className="mb-3 w-full rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black"
      >
        Join/Create a Group Workout
      </button>

      <div className="space-y-2">
        {sessions.map(session => (
          <div key={session} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#101012] p-3">
            <GroupIcon />
            <p className="m-0 text-xs font-bold leading-5 text-white/70">{session}</p>
          </div>
        ))}
      </div>

      <ProPaywall
        featureName="Group Sessions"
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={() => console.log('Payment integration coming soon')}
      />
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
        <GroupSessions />
      </div>

      <Link to="/" className="mt-6 block rounded-2xl bg-[#CCFF00] py-3 text-center text-sm font-black text-black no-underline">
        Back to Home
      </Link>
    </main>
  );
}

