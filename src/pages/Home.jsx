import { Link, useNavigate } from 'react-router-dom';
import { getCoach } from '../config/coaches';
import { useAuth } from '../context/AuthContext';
import { useCoach } from '../hooks/useCoach';

const QUICK_START = [
  { name: 'Cardio', icon: '🏃', path: '/workout/cardio' },
  { name: 'Strength', icon: '🏋️', path: '/workout/strength' },
  { name: 'Mob', icon: '🧘', path: '/workout/mobility' },
  { name: 'HIIT', icon: '⚡', path: '/workout/hiit' },
];

const PLAN_ACTIONS = [
  { title: 'Workout Plan', icon: '🏋️', path: '/plan/workout' },
  { title: 'Nutrition Plan', icon: '🥗', path: '/plan/nutrition' },
];

const WORKOUT_ACTIONS = [
  { title: 'Home workout', icon: '🏠', path: '/workout/mobility' },
  { title: 'Gym workout', icon: '🏋️', path: '/gym' },
];

export default function Home() {
  const navigate = useNavigate();
  const { profile } = useAuth() || {};
  const { message, loadingMessage, speak } = useCoach();
  const displayName = profile?.display_name || 'Taher';
  const coachId = profile?.coach_persona || 'elias';
  const coach = getCoach(coachId);
  const streak = profile?.streak_count || 12;
  const level = profile?.dopa_level || 4;
  const xp = profile?.dopa_xp || 340;
  const xpToNext = 500;
  const xpPercent = Math.min(100, Math.round((xp / xpToNext) * 100));
  const dailyMessage = loadingMessage
    ? 'Loading your coach message...'
    : message || `${displayName}, welcome to ENDOPAMIN. Let's create one win today.`;
  const initials = displayName
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'TA';

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            ENDO<span className="text-[#CCFF00]">PAMIN</span>
          </h1>
          <p className="mt-1 text-[9px] uppercase tracking-widest text-gray-500">Endorphin · Dopamine</p>
          <p className="mt-3 text-sm text-gray-400">Hi, {displayName}</p>
        </div>
        <Link
          to="/profile"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[#CCFF00] bg-[#111] text-sm font-black text-[#CCFF00] no-underline"
        >
          {initials}
        </Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3">
        <MetricCard icon="🔥" value={streak} label="Day streak" />
        <MetricCard icon="⚡" value={`Lv.${level}`} label={`${xp} XP`} />
      </section>

      <section className="mb-4 rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
          <span>Progress to Lv.{level + 1}</span>
          <span>{xpPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#2a2a2a]">
          <div className="h-full rounded-full bg-[#CCFF00]" style={{ width: `${xpPercent}%` }} />
        </div>
      </section>

      <section className="mb-5 rounded-2xl bg-[#1a1a1a] p-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{coach.avatar}</span>
          <p className="line-clamp-2 flex-1 text-sm leading-5 text-white">{dailyMessage}</p>
          <button
            type="button"
            onClick={() => speak(dailyMessage)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#CCFF00] text-xs text-black"
            aria-label="Play coach message"
          >
            ▶
          </button>
        </div>
      </section>

      <section className="mb-5">
        <p className="mb-3 text-xs font-black uppercase tracking-wider text-gray-400">Quick Start</p>
        <div className="grid grid-cols-4 gap-2">
          {QUICK_START.map(item => (
            <button
              key={item.name}
              type="button"
              onClick={() => navigate(item.path)}
              className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-3 text-center"
            >
              <div className="text-xl">{item.icon}</div>
              <p className="mt-1 text-[10px] font-bold text-gray-400">{item.name}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3">
        {PLAN_ACTIONS.map(item => (
          <ActionCard key={item.title} {...item} />
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3">
        {WORKOUT_ACTIONS.map(item => (
          <ActionCard key={item.title} {...item} large />
        ))}
      </section>
    </main>
  );
}

function MetricCard({ icon, value, label }) {
  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <span className="text-3xl font-black text-white">{value}</span>
      </div>
      <p className="mt-1 text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p>
    </div>
  );
}

function ActionCard({ title, icon, path, large = false }) {
  return (
    <Link
      to={path}
      className={`rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 text-white no-underline ${
        large ? 'min-h-28' : 'min-h-24'
      }`}
    >
      <div className="text-3xl">{icon}</div>
      <p className="mt-3 text-sm font-black">{title}</p>
      <p className="mt-1 text-xs text-gray-500">Open now</p>
    </Link>
  );
}
