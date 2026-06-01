import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCoach } from '../hooks/useCoach';
import { useState } from 'react';

const iconClass = 'h-full w-full';

const MOODS = [
  { id: 'fired', label: 'Fired', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2c0 0-5 4-5 9a5 5 0 0010 0c0-5-5-9-5-9z"/><path d="M12 12c0 0-2 1.5-2 3a2 2 0 004 0c0-1.5-2-3-2-3z" fill="currentColor"/></svg> },
  { id: 'strong', label: 'Strong', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h2l1 3h6l1-3h2"/><path d="M9 7v10M15 7v10"/><path d="M6 20h12"/><path d="M8 11h8"/></svg> },
  { id: 'tired', label: 'Tired', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 15s1.5-1 4-1 4 1 4 1"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M8 9.5c.5-.5 1-.5 1.5 0M14.5 9.5c.5-.5 1-.5 1.5 0"/></svg> },
  { id: 'calm', label: 'Calm', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> },
  { id: 'hyped', label: 'Hyped', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> },
];

const TRAINING = [
  { id: 'gym', title: 'Gym', sub: 'Equipment', path: '/gym', color: 'neon',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/></svg> },
  { id: 'home', title: 'Home', sub: 'No gear', path: '/gym?tab=home', color: 'blue',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg> },
  { id: 'desk', title: 'Desk Break', sub: '5 min', path: '/gym?tab=desk', color: 'purple',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="14" width="20" height="2" rx="1"/><path d="M6 16v4M18 16v4"/><path d="M12 14V8M9 8h6M12 5a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/></svg> },
];

const QUICK_START = [
  { id: 'cardio', label: 'Cardio', path: '/workout/cardio', color: '#CCFF00',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 4v7h7l-9 9v-7H4l9-9z"/><path d="M3 20l3-3M18 5l3-3M3 4l3 3"/></svg> },
  { id: 'strength', label: 'Strength', path: '/workout/strength', color: '#5088FF',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/></svg> },
  { id: 'mobility', label: 'Mobility', path: '/workout/mobility', color: '#CCFF00',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="4" r="1.5" fill="currentColor"/><path d="M12 6v6M9 9l3-3 3 3M9 18l3 3 3-3M12 12v6"/><path d="M7 13c0 0 2-2 5-2s5 2 5 2"/></svg> },
  { id: 'hiit', label: 'HIIT', path: '/workout/hiit', color: '#FF6B35',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> },
];

const PLANS = [
  { id: 'workout', title: 'Workout Plan', sub: 'Week 3 · Day 4', path: '/plan/workout',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>,
    bgColor: 'rgba(204,255,0,0.1)', borderColor: 'rgba(204,255,0,0.18)', iconColor: '#CCFF00' },
  { id: 'nutrition', title: 'Nutrition Plan', sub: '1,840 kcal today', path: '/plan/nutrition',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
    bgColor: 'rgba(255,165,60,0.1)', borderColor: 'rgba(255,165,60,0.18)', iconColor: '#FFA53C' },
];

const ACTIVE_STATUS_SVG = (
  <svg className="h-2 w-2 shrink-0" viewBox="0 0 8 8" fill="none">
    <circle cx="4" cy="4" r="4" fill="#CCFF00" />
  </svg>
);

export default function Home() {
  const navigate = useNavigate();
  const { profile } = useAuth() || {};
  const { message, loadingMessage } = useCoach();
  const [selectedMood, setSelectedMood] = useState('strong');

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
        style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'rgba(255,255,255,0.07)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}
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
        <div className="bg-[#131313] border border-white/[0.07] rounded-[28px] px-3 py-5 flex flex-col items-center gap-2 relative overflow-hidden"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)' }}>
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
        <div className="bg-[#131313] border border-white/[0.07] rounded-[28px] px-3 py-5 flex flex-col items-center gap-2 relative overflow-hidden"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)' }}>
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

      {/* Athlete Status / Mood */}
      <div className="mx-[18px] mb-5 rounded-[24px] border border-white/[0.07] p-4"
        style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))', boxShadow: '0 8px 28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
        <div className="flex justify-between items-center mb-3">
          <p className="text-[10px] tracking-[2px] uppercase text-white/40 font-bold">Athlete Status</p>
          <span className="flex items-center gap-1.5 text-[10px] text-[#CCFF00] font-bold bg-[#CCFF00]/10 border border-[#CCFF00]/20 px-2 py-0.5 rounded-full">
            {ACTIVE_STATUS_SVG}
            Active
          </span>
        </div>
        <div className="flex gap-2">
          {MOODS.map(mood => (
            <button key={mood.id} type="button"
              onClick={() => setSelectedMood(mood.id)}
              className={`flex-1 py-2 rounded-[14px] border text-center transition-all duration-200 ${
                selectedMood === mood.id
                  ? 'border-[#CCFF00]/35 bg-[#CCFF00]/08'
                  : 'border-white/[0.07] bg-white/[0.03]'
              }`}
              style={selectedMood === mood.id ? { boxShadow: '0 0 12px rgba(204,255,0,0.08)' } : {}}>
              <div className={`w-5 h-5 ${selectedMood === mood.id ? 'text-[#CCFF00]' : 'text-white/40'}`}>{mood.svg}</div>
              <div className={`text-[9px] mt-0.5 font-medium ${selectedMood === mood.id ? 'text-[#CCFF00]' : 'text-white/40'}`}>{mood.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Choose Training */}
      <p className="px-[18px] text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold mb-3">Choose Training</p>
      <div className="px-[18px] grid grid-cols-3 gap-[10px] mb-5">
        {TRAINING.map(item => {
          const colors = {
            neon: { bg: 'rgba(204,255,0,0.12)', border: 'rgba(204,255,0,0.2)', line: 'rgba(204,255,0,0.5)' },
            blue: { bg: 'rgba(100,180,255,0.09)', border: 'rgba(100,180,255,0.16)', line: 'rgba(100,180,255,0.5)' },
            purple: { bg: 'rgba(160,100,255,0.09)', border: 'rgba(160,100,255,0.16)', line: 'rgba(160,100,255,0.5)' },
          }[item.color];
          return (
            <button key={item.id} type="button" onClick={() => navigate(item.path)}
              className="rounded-[22px] p-4 flex flex-col justify-between min-h-[120px] relative overflow-hidden border transition-transform duration-200 active:scale-95"
              style={{ background: `linear-gradient(145deg, ${colors.bg}, rgba(0,0,0,0))`, borderColor: colors.border, boxShadow: '0 10px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)' }}>
              <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-[22px]"
                style={{ background: `linear-gradient(90deg,transparent,${colors.line},transparent)` }} />
              <div className="w-8 h-8" style={{ color: colors.line }}>{item.svg}</div>
              <div>
                <p className="text-[11px] font-bold text-white leading-tight">{item.title}</p>
                <p className="text-[9px] text-white/40 mt-0.5">{item.sub}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* My Plans */}
      <p className="px-[18px] text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold mb-3">My Plans</p>
      <div className="px-[18px] grid grid-cols-2 gap-[10px] mb-5">
        {PLANS.map(plan => (
          <Link key={plan.id} to={plan.path} className="no-underline rounded-[20px] p-4 flex items-center gap-3 border transition-transform duration-200 active:scale-95"
            style={{ background: `linear-gradient(135deg,${plan.bgColor},rgba(0,0,0,0))`, borderColor: plan.borderColor, boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <div className="w-7 h-7 flex-shrink-0" style={{ color: plan.iconColor }}>{plan.svg}</div>
            <div>
              <p className="text-[11px] font-bold text-white">{plan.title}</p>
              <p className="text-[9px] text-white/40 mt-0.5">{plan.sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Start */}
      <div className="px-[18px] flex justify-between items-center mb-3">
        <p className="text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold">Quick Start</p>
        <span className="text-[10px] text-[#CCFF00] font-bold">See all →</span>
      </div>
      <div className="px-[18px] grid grid-cols-4 gap-[9px]">
        {QUICK_START.map((item, i) => (
          <button key={item.id} type="button" onClick={() => navigate(item.path)}
            className={`rounded-[20px] aspect-square relative overflow-hidden border flex flex-col items-center justify-end pb-[10px] transition-transform duration-200 active:scale-95 ${
              i === 1 ? 'border-[#CCFF00]/40' : 'border-white/[0.07]'
            }`}
            style={{
              background: i === 1 ? 'linear-gradient(145deg,rgba(204,255,0,0.1),rgba(204,255,0,0.025))' : '#131313',
              boxShadow: i === 1 ? '0 6px 18px rgba(0,0,0,.4),0 0 16px rgba(204,255,0,0.12)' : '0 6px 18px rgba(0,0,0,0.45)',
            }}>
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: `radial-gradient(circle at 50% 40%, ${item.color}22, transparent 70%)` }}>
              <div className="w-7 h-7" style={{ color: item.color }}>{item.svg}</div>
            </div>
            {i === 1 && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2px] bg-[#CCFF00] rounded-full" style={{ boxShadow: '0 0 6px rgba(204,255,0,0.6)' }} />}
            <span className="text-[9px] text-white/70 font-bold uppercase tracking-[0.5px] relative z-10 mt-auto">{item.label}</span>
          </button>
        ))}
      </div>

    </main>
  );
}
