import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DESK_BREAKS } from '../../data/deskBreaks';

const EXERCISE_ICONS = {
  default: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v6l4 2"/></svg>,
  neck: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="12" cy="6" r="3"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>,
  shoulder: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M6 12h12M12 6l6 6-6 6"/></svg>,
  chest: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M4 8c0-2.2 1.8-4 4-4h8c2.2 0 4 1.8 4 4v8c0 2.2-1.8 4-4 4H8c-2.2 0-4-1.8-4-4V8z"/><path d="M12 8v8M8 12h8"/></svg>,
  wrist: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 2a5 5 0 015 5v5a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M12 17v5"/></svg>,
  spine: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 2v20M8 6h8M8 10h8M8 14h8M8 18h8"/></svg>,
  eye: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>,
  breath: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 2v20M2 12c4 0 6-4 10-4s6 4 10 4"/></svg>,
  hip: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M5 20l4-8 6 6 4-10"/></svg>,
  calf: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M8 20V12a4 4 0 018 0v8"/><line x1="5" y1="20" x2="19" y2="20"/></svg>,
};

function getIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('neck')) return EXERCISE_ICONS.neck;
  if (n.includes('shoulder')) return EXERCISE_ICONS.shoulder;
  if (n.includes('chest') || n.includes('opener')) return EXERCISE_ICONS.chest;
  if (n.includes('wrist')) return EXERCISE_ICONS.wrist;
  if (n.includes('spine') || n.includes('spinal') || n.includes('twist')) return EXERCISE_ICONS.spine;
  if (n.includes('eye')) return EXERCISE_ICONS.eye;
  if (n.includes('breath')) return EXERCISE_ICONS.breath;
  if (n.includes('hip')) return EXERCISE_ICONS.hip;
  if (n.includes('calf')) return EXERCISE_ICONS.calf;
  return EXERCISE_ICONS.default;
}

export function DeskBreakSession({ breakId, onComplete }) {
  const navigate = useNavigate();
  const breakData = DESK_BREAKS.find(b => b.id === breakId || b.id === Number(breakId));
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [timeLeft, setTimeLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const timerRef = useRef(null);

  const exercises = breakData?.exercises || [];
  const currentEx = exercises[currentIdx];
  const progress = currentIdx >= 0 ? ((currentIdx) / exercises.length) * 100 : 0;

  useEffect(() => {
    if (!running || timeLeft <= 0) return;
    timerRef.current = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [running, timeLeft]);

  useEffect(() => {
    if (running && timeLeft === 0 && currentIdx >= 0) {
      if (currentIdx < exercises.length - 1) {
        setTimeout(() => {
          setCurrentIdx(i => i + 1);
          setTimeLeft(exercises[currentIdx + 1]?.duration || 30);
        }, 500);
      } else {
        setRunning(false);
        setTimeout(() => onComplete?.(), 800);
      }
    }
  }, [timeLeft, running, currentIdx, exercises, onComplete]);

  const startSession = () => {
    if (exercises.length > 0) {
      setCurrentIdx(0);
      setTimeLeft(exercises[0]?.duration || 30);
      setRunning(true);
    }
  };

  if (!breakData) {
    return (
      <main className="min-h-screen bg-[#080808] text-white flex items-center justify-center">
        <p className="text-white/50">Break not found</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-28">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-[#A064FF] opacity-[0.04] blur-3xl" />

      {/* Header */}
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button type="button" onClick={() => onComplete ? onComplete() : navigate(-1)}
          className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center transition-all active:scale-90">
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div>
          <div className="font-['Orbitron',monospace] font-black text-[13px] tracking-[2px]">
            <span className="text-[#A064FF]">∃</span>NDO <span className="text-white/30 text-[10px]">/ Desk Break</span>
          </div>
        </div>
      </div>

      {/* Break info */}
      <div className="px-5 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-[16px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(160,100,255,0.15)', border: '1px solid rgba(160,100,255,0.25)', color: '#A064FF' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
              <rect x="2" y="14" width="20" height="3" rx="1"/><path d="M6 17v3M18 17v3M12 14V9"/><circle cx="12" cy="7" r="2"/>
            </svg>
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-white">{breakData.title}</h1>
            <p className="text-[12px] text-white/40">{breakData.duration} min · {exercises.length} exercises</p>
          </div>
        </div>

        {/* Progress bar */}
        {currentIdx >= 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-white/35 mb-1.5">
              <span>Exercise {currentIdx + 1} of {exercises.length}</span>
              <span>{Math.round(progress)}% done</span>
            </div>
            <div className="h-[4px] bg-white/[0.06] rounded-full overflow-hidden">
              <div className="h-full bg-[#A064FF] rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, boxShadow: '0 0 8px rgba(160,100,255,0.5)' }} />
            </div>
          </div>
        )}
      </div>

      {/* Active exercise */}
      {running && currentEx && (
        <div className="mx-5 mb-5 rounded-[24px] border p-5 text-center"
          style={{ background: 'rgba(160,100,255,0.08)', borderColor: 'rgba(160,100,255,0.25)', boxShadow: '0 0 30px rgba(160,100,255,0.08)' }}>
          <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(160,100,255,0.15)', border: '1px solid rgba(160,100,255,0.3)', color: '#A064FF' }}>
            {getIcon(currentEx.name)}
          </div>
          <h2 className="text-[18px] font-bold text-white mb-2">{currentEx.name}</h2>
          {currentEx.instruction && (
            <p className="text-[12px] text-white/45 mb-4 leading-relaxed">{currentEx.instruction}</p>
          )}
          {/* Countdown */}
          <div className="relative w-[100px] h-[100px] mx-auto mb-3">
            <svg className="-rotate-90 w-full h-full" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(160,100,255,0.1)" strokeWidth="7"/>
              <circle cx="50" cy="50" r="42" fill="none" stroke="#A064FF" strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray="264"
                strokeDashoffset={264 - (264 * timeLeft) / (currentEx.duration || 30)}
                style={{ transition: 'stroke-dashoffset 1s linear', filter: 'drop-shadow(0 0 6px rgba(160,100,255,0.6))' }}/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[28px] font-black text-white leading-none">{timeLeft}</span>
              <span className="text-[9px] text-white/40 mt-0.5">sec</span>
            </div>
          </div>
          <button type="button" onClick={() => setRunning(false)}
            className="text-[11px] text-white/30 border border-white/[0.08] px-4 py-1.5 rounded-full transition-all active:scale-95">
            Pause
          </button>
        </div>
      )}

      {/* Paused state */}
      {!running && currentIdx >= 0 && (
        <div className="mx-5 mb-5">
          <button type="button" onClick={() => setRunning(true)}
            className="w-full py-4 rounded-[18px] font-black text-[14px] text-black transition-all active:scale-95"
            style={{ background: '#A064FF', boxShadow: '0 8px 24px rgba(160,100,255,0.4)' }}>
            Resume
          </button>
        </div>
      )}

      {/* Exercise list */}
      <div className="px-5">
        <p className="text-[10px] tracking-[2.5px] uppercase text-white/35 font-bold mb-3">Exercises</p>
        <div className="space-y-2">
          {exercises.map((ex, i) => {
            const isDone = i < currentIdx;
            const isActive = i === currentIdx;
            return (
              <div key={i} className="rounded-[18px] border p-4 flex items-center gap-3 transition-all"
                style={{
                  background: isActive ? 'rgba(160,100,255,0.1)' : isDone ? 'rgba(204,255,0,0.04)' : 'rgba(255,255,255,0.025)',
                  borderColor: isActive ? 'rgba(160,100,255,0.35)' : isDone ? 'rgba(204,255,0,0.15)' : 'rgba(255,255,255,0.07)',
                  boxShadow: isActive ? '0 0 20px rgba(160,100,255,0.1)' : 'none',
                }}>
                <div className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isActive ? 'rgba(160,100,255,0.2)' : isDone ? 'rgba(204,255,0,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isActive ? 'rgba(160,100,255,0.3)' : isDone ? 'rgba(204,255,0,0.2)' : 'rgba(255,255,255,0.07)'}`,
                    color: isActive ? '#A064FF' : isDone ? '#CCFF00' : 'rgba(255,255,255,0.3)',
                  }}>
                  {isDone
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>
                    : getIcon(ex.name)
                  }
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-bold" style={{ color: isActive ? 'white' : isDone ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.8)' }}>
                    {ex.name}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: isActive ? '#A064FF' : 'rgba(255,255,255,0.3)' }}>
                    {ex.duration}s {isActive ? '← now' : isDone ? '✓ done' : ''}
                  </p>
                </div>
                {isActive && (
                  <div className="text-[18px] font-black text-[#A064FF]">{timeLeft}s</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Start button */}
        {currentIdx === -1 && (
          <button type="button" onClick={startSession}
            className="w-full py-4 rounded-[18px] font-black text-[14px] text-black mt-4 transition-all active:scale-95"
            style={{ background: '#A064FF', boxShadow: '0 8px 24px rgba(160,100,255,0.4)' }}>
            Start Break Session
          </button>
        )}

        {/* Done */}
        {!running && currentIdx === exercises.length - 1 && timeLeft === 0 && (
          <div className="mt-4 rounded-[20px] border border-[#CCFF00]/20 p-5 text-center"
            style={{ background: 'rgba(204,255,0,0.06)' }}>
            <p className="text-[18px] font-black text-[#CCFF00] mb-1">Session Complete!</p>
            <p className="text-[12px] text-white/40">Great work. Your streak is safe. 🔥</p>
            <button type="button" onClick={() => onComplete ? onComplete() : navigate(-1)}
              className="mt-3 px-6 py-2.5 rounded-[14px] font-black text-[13px] text-black transition-all active:scale-95"
              style={{ background: '#CCFF00' }}>
              Done
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default DeskBreakSession;
