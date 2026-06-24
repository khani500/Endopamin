import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCoach } from '../hooks/useCoach';

const iconClass = 'h-full w-full';

const TRAINING_ENV_ICONS = [
  { label: 'Gym', path: 'M6 4v16M18 4v16M4 8h4M16 8h4M4 16h4M16 16h4M8 12h8', nav: '/gym' },
  { label: 'Home', path: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', nav: '/gym?tab=home' },
  { label: 'Desk', path: 'M2 6a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM8 20h8M12 18v2', nav: '/gym?tab=desk' },
];

const PLANS = [
  { id: 'workout', title: 'Workout Plan', sub: 'Your weekly program', path: '/workout-plan',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>,
    bgColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.35)', iconColor: '#CCFF00' },
  { id: 'nutrition', title: 'Nutrition Plan', sub: 'Meals & macros', path: '/plan/nutrition',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
    bgColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.35)', iconColor: '#FFA53C' },
];

export default function Home() {
  const navigate = useNavigate();
  const { profile } = useAuth() || {};
  const { message, loadingMessage } = useCoach();

  const displayName = profile?.display_name || 'Athlete';
  const streak = profile?.streak_count || 0;
  const endoScore = profile?.dopa_xp ? Math.min(100, Math.round((profile.dopa_xp / 500) * 100)) : 0;
  const xp = profile?.dopa_xp || 0;
  const level = profile?.dopa_level || 1;
  const xpToNext = 500;
  const xpPercent = Math.min(100, Math.round((xp / xpToNext) * 100));

  const streakDash = 257;
  const scoreDash = 257;
  const scoreDashOffset = scoreDash - (scoreDash * endoScore) / 100;

  const initials = displayName.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'AT';

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-28 overflow-x-hidden">

      {/* Top ambient glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-[#CCFF00] opacity-[0.04] blur-3xl" />

      {/* Status bar */}
      <div className="flex justify-between items-center px-7 pt-14 pb-0 text-xs font-medium opacity-80">
        <span>9:41</span>
        <span className="opacity-50 text-[11px]">▪▪▪ ≋ ▮</span>
      </div>

      {/* Header */}
      <div className="flex justify-between items-center px-6 pt-4 pb-3">
        <div className="font-['Orbitron',monospace] font-black text-[19px] tracking-[3px]">
          <span className="text-[#CCFF00]">∃</span>NDOPAMIN
        </div>
        <Link to="/profile" className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-[13px] font-black text-[#CCFF00] no-underline">
          {initials}
        </Link>
      </div>

      {/* Greeting */}
      <div className="px-6 pb-5">
        <h1 className="text-[34px] font-bold tracking-tight leading-tight">Hi, {displayName}</h1>
        <p className="text-sm text-white/40 mt-1 italic font-light">Your dopamine. Your discipline.</p>
      </div>

      {/* Daily Dopamine Shot */}
      <div className="mx-[18px] mb-4 rounded-[20px] border p-3.5 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-all"
        style={{ background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.07)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}
        onClick={() => navigate('/desk-break/1')}>
        <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(204,255,0,0.12)', border: '1px solid rgba(204,255,0,0.25)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#CCFF00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-bold text-white">Daily Dopamine Shot ⚡</p>
          <p className="text-[10px] text-white/35 mt-0.5">5-min micro workout · Keep your streak alive</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>

      {/* Rings */}
      <div className="px-[18px] grid grid-cols-2 gap-3 mb-5">
        {/* Streak Ring */}
        <div className="rounded-[28px] px-3 py-5 flex flex-col items-center gap-2 relative overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.28)', border: '1px solid rgba(255,255,255,0.35)', boxShadow: '6px 6px 16px rgba(0,0,0,0.6)' }}>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#CCFF00]/20 to-transparent" />
          <p className="text-[9px] tracking-[2.5px] text-white/40 uppercase font-bold">Day Streak</p>
          <div className="relative w-[100px] h-[100px]">
            <svg className="-rotate-90 w-full h-full" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="41" fill="none" stroke="rgba(204,255,0,0.07)" strokeWidth="8" />
              <circle cx="50" cy="50" r="41" fill="none" stroke="#CCFF00" strokeWidth="8"
                strokeLinecap="round" strokeDasharray={streakDash} strokeDashoffset="0"
                style={{ filter: 'drop-shadow(0 0 8px #CCFF00) drop-shadow(0 0 18px rgba(204,255,0,0.4))', transition: 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[30px] font-extrabold leading-none">{streak}</span>
              <span className="text-[10px] text-white/40 mt-0.5">days</span>
            </div>
          </div>
        </div>

        {/* Endo Score Ring */}
        <div className="rounded-[28px] px-3 py-5 flex flex-col items-center gap-2 relative overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.28)', border: '1px solid rgba(255,255,255,0.35)', boxShadow: '6px 6px 16px rgba(0,0,0,0.6)' }}>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#CCFF00]/20 to-transparent" />
          <p className="text-[9px] tracking-[2.5px] text-white/40 uppercase font-bold">Endo Score</p>
          <div className="relative w-[100px] h-[100px]">
            <svg className="-rotate-90 w-full h-full" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="41" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
              <circle cx="50" cy="50" r="41" fill="none" stroke="#CCFF00" strokeWidth="8"
                strokeLinecap="round" strokeDasharray={scoreDash} strokeDashoffset={scoreDashOffset}
                style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[30px] font-extrabold leading-none">{endoScore}</span>
              <span className="text-[10px] text-white/40 mt-0.5">/100</span>
            </div>
          </div>
        </div>
      </div>

      {/* Dopameter */}
      <div className="mx-[18px] mb-4 rounded-[22px] border p-4 relative overflow-hidden"
        style={{ borderColor: 'rgba(204,255,0,0.22)', background: 'linear-gradient(135deg,rgba(204,255,0,0.08),rgba(204,255,0,0.02))', boxShadow: '0 0 24px rgba(204,255,0,0.06),0 8px 24px rgba(0,0,0,0.5)' }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#CCFF00]/40 to-transparent" />
        <div className="flex justify-between items-center mb-2.5">
          <div className="flex items-center gap-1.5 text-[9px] tracking-[2px] uppercase text-white/40 font-bold">
            <svg viewBox="0 0 24 24" fill="none" stroke="#CCFF00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Endopamin Charge
          </div>
          <span className="text-[9px] text-[#CCFF00] font-bold bg-[#CCFF00]/10 border border-[#CCFF00]/25 px-2 py-0.5 rounded-full">
            Lv.{level} · {xpPercent}%
          </span>
        </div>
        {/* Segmented bar */}
        <div className="flex gap-[3px] mb-2">
          {Array.from({ length: 20 }).map((_, i) => {
            const filled = Math.round((xpPercent / 100) * 20);
            return (
              <div key={i} className="flex-1 h-[8px] rounded-[3px] transition-all duration-500"
                style={{
                  background: i < filled ? '#CCFF00' : 'rgba(255,255,255,0.06)',
                  boxShadow: i < filled ? '0 0 6px rgba(204,255,0,0.35)' : 'none',
                }} />
            );
          })}
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-white/30">{xp} XP · {xpToNext - xp} to Level {level + 1}</span>
          <span className="text-[#CCFF00] font-bold">Lv.{level + 1} →</span>
        </div>
      </div>

      {/* My Plans */}
      <p className="px-[18px] text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold mb-3">My Plans</p>
      <div className="px-[18px] flex flex-col gap-[10px] mb-5">
        {PLANS.map(plan => (
          <Link key={plan.id} to={plan.path} className="no-underline rounded-[20px] p-4 flex items-center gap-3 border transition-transform duration-200 active:scale-95 w-full"
            style={{ background: `linear-gradient(135deg,${plan.bgColor},rgba(0,0,0,0))`, borderColor: plan.borderColor, boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <div className="w-7 h-7 flex-shrink-0" style={{ color: plan.iconColor }}>{plan.svg}</div>
            <div>
              <p className="text-[11px] font-bold text-white">{plan.title}</p>
              <p className="text-[9px] text-white/40 mt-0.5">{plan.sub}</p>
            </div>
            <svg className="ml-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>
        ))}
      </div>

      <div className="mx-[18px] mb-4 h-px bg-white/[0.05]" />

      {/* Choose Training — Start Training glass card */}
      <div className="px-[18px]" style={{ marginBottom: '16px' }}>
        <p style={{ fontSize: '11px', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginBottom: '12px' }}>
          CHOOSE TRAINING
        </p>
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate('/gym')}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate('/gym'); }}
          style={{
            background: 'rgba(255,255,255,0.12)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            borderRadius: '20px',
            padding: '20px',
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            {TRAINING_ENV_ICONS.map(item => (
              <div
                key={item.label}
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); navigate(item.nav); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    navigate(item.nav);
                  }
                }}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'rgba(204,255,0,0.08)',
                  border: '0.5px solid rgba(204,255,0,0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  cursor: 'pointer',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#CCFF00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.path} />
                </svg>
                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>{item.label}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '20px', fontWeight: '600', color: 'white', margin: '0 0 16px' }}>Start Training</p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(204,255,0,0.1)',
              border: '0.5px solid rgba(204,255,0,0.25)',
              borderRadius: '12px',
              padding: '12px 16px',
            }}
          >
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#CCFF00' }}>Open Gym</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#CCFF00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </div>
      </div>

    </main>
  );
}
