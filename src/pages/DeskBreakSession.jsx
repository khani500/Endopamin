import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DESK_BREAKS } from '../data/deskBreaks';
import { speak } from '../lib/voice';
import { supabase } from '../lib/supabase';

const DESK_BREAK_XP = 10;

const PERIOD_ICONS = {
  morning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  midday: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  evening: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  ),
};

function getTimeSlot(hour) {
  if (hour < 12) return 'morning';
  if (hour <= 17) return 'midday';
  return 'evening';
}

const TIME_SLOT_CONTENT = {
  morning: {
    label: 'Good Morning',
    exercises: [
      { name: 'Jumping Jacks', duration: 30 },
      { name: 'Arm Circles', duration: 30 },
      { name: 'High Knees', duration: 30 },
      { name: 'Push-ups', duration: 30 },
      { name: 'Squat Jumps', duration: 30 },
      { name: 'Deep Breath', duration: 30 },
    ],
  },
  midday: {
    label: 'Midday Reset',
    exercises: [
      { name: 'Neck Rolls', duration: 30 },
      { name: 'Shoulder Shrugs', duration: 30 },
      { name: 'Chest Opener', duration: 45 },
      { name: 'Wrist Stretches', duration: 30 },
      { name: 'Seated Spinal Twist', duration: 45 },
      { name: 'Eye Rest', duration: 30 },
    ],
  },
  evening: {
    label: 'Evening Wind Down',
    exercises: [
      { name: 'Cat-Cow', duration: 45 },
      { name: 'Child Pose', duration: 45 },
      { name: 'Hip Circles', duration: 30 },
      { name: 'Spinal Twist', duration: 45 },
      { name: 'Deep Breathing', duration: 60 },
      { name: 'Body Scan', duration: 30 },
    ],
  },
};

const EXERCISE_ICONS = {
  default: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  neck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="12" cy="6" r="3" />
      <path d="M12 9v6" />
      <path d="M9 12h6" />
    </svg>
  ),
  shoulder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M6 12h12M12 6l6 6-6 6" />
    </svg>
  ),
  chest: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M4 8c0-2.2 1.8-4 4-4h8c2.2 0 4 1.8 4 4v8c0 2.2-1.8 4-4 4H8c-2.2 0-4-1.8-4-4V8z" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  wrist: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 2a5 5 0 015 5v5a5 5 0 01-10 0V7a5 5 0 015-5z" />
      <path d="M12 17v5" />
    </svg>
  ),
  spine: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 2v20M8 6h8M8 10h8M8 14h8M8 18h8" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  breath: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 2v20M2 12c4 0 6-4 10-4s6 4 10 4" />
    </svg>
  ),
  hip: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M5 20l4-8 6 6 4-10" />
    </svg>
  ),
  calf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M8 20V12a4 4 0 018 0v8" />
      <line x1="5" y1="20" x2="19" y2="20" />
    </svg>
  ),
  jumping: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
    </svg>
  ),
  arms: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M4 12a8 8 0 0116 0" />
      <path d="M12 12l-3-3M12 12l3-3" />
    </svg>
  ),
  knees: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M6 20h12M9 20V10l3-4 3 4v10" />
    </svg>
  ),
  pushup: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M4 14h16M6 14l2-4h8l2 4" />
      <path d="M8 18v2M16 18v2" />
    </svg>
  ),
  squat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M8 20V12a4 4 0 018 0v8" />
      <path d="M6 12h12" />
    </svg>
  ),
  child: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 14c-3 0-5 2-5 5M12 14c3 0 5 2 5 5" />
      <circle cx="12" cy="8" r="3" />
    </svg>
  ),
  scan: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

function getIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('jumping')) return EXERCISE_ICONS.jumping;
  if (n.includes('arm circle')) return EXERCISE_ICONS.arms;
  if (n.includes('high knee')) return EXERCISE_ICONS.knees;
  if (n.includes('push-up') || n.includes('push up')) return EXERCISE_ICONS.pushup;
  if (n.includes('squat')) return EXERCISE_ICONS.squat;
  if (n.includes('child pose')) return EXERCISE_ICONS.child;
  if (n.includes('body scan')) return EXERCISE_ICONS.scan;
  if (n.includes('hip circle')) return EXERCISE_ICONS.hip;
  if (n.includes('neck')) return EXERCISE_ICONS.neck;
  if (n.includes('shoulder')) return EXERCISE_ICONS.shoulder;
  if (n.includes('chest') || n.includes('opener')) return EXERCISE_ICONS.chest;
  if (n.includes('wrist')) return EXERCISE_ICONS.wrist;
  if (n.includes('spine') || n.includes('spinal') || n.includes('twist') || n.includes('cat-cow') || n.includes('thoracic')) return EXERCISE_ICONS.spine;
  if (n.includes('eye')) return EXERCISE_ICONS.eye;
  if (n.includes('breath')) return EXERCISE_ICONS.breath;
  if (n.includes('hip')) return EXERCISE_ICONS.hip;
  if (n.includes('calf') || n.includes('standing')) return EXERCISE_ICONS.calf;
  if (n.includes('power pose') || n.includes('pose')) return EXERCISE_ICONS.shoulder;
  if (n.includes('water') || n.includes('splash')) return EXERCISE_ICONS.default;
  return EXERCISE_ICONS.default;
}

function TimeLabel({ slot, label }) {
  return (
    <div className="mb-4 flex items-center gap-2 text-[#CCFF00]">
      {PERIOD_ICONS[slot]}
      <span className="text-[10px] font-bold uppercase tracking-[2.5px]">{label}</span>
    </div>
  );
}

export default function DeskBreakSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, user, setProfile } = useAuth();
  const breakData = DESK_BREAKS.find(item => item.id === id) || DESK_BREAKS[0];
  const hour = new Date().getHours();
  const timeSlot = getTimeSlot(hour);
  const { label: timeLabel, exercises } = TIME_SLOT_CONTENT[timeSlot];
  const durationMin = Math.ceil(exercises.reduce((sum, ex) => sum + ex.duration, 0) / 60);
  const [phase, setPhase] = useState('intro');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef(null);
  const xpAwardedRef = useRef(false);
  const exercise = exercises[currentIdx];
  const coachId = profile?.coach_persona || 'elias';

  const startExercise = (index) => {
    const ex = exercises[index];
    setCurrentIdx(index);
    setPhase('exercise');
    setTimeLeft(ex.duration);
    setIsRunning(true);
    speak(index === 0 ? `Starting ${timeLabel}. First: ${ex.name}` : ex.name, coachId);
  };

  const startSession = () => startExercise(0);

  useEffect(() => {
    if (!isRunning) return undefined;

    timerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          window.clearInterval(timerRef.current);
          if (currentIdx < exercises.length - 1) {
            const next = currentIdx + 1;
            setCurrentIdx(next);
            const nextEx = exercises[next];
            setTimeLeft(nextEx.duration);
            speak(nextEx.name, coachId);
            setIsRunning(true);
          } else {
            setPhase('complete');
            setIsRunning(false);
            speak('Great job! Break complete.', coachId);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerRef.current);
  }, [coachId, currentIdx, exercises, isRunning, timeLabel]);

  useEffect(() => {
    if (phase !== 'complete' || xpAwardedRef.current) return;
    xpAwardedRef.current = true;

    const awardXp = async () => {
      const newXp = (profile?.dopa_xp || 0) + DESK_BREAK_XP;
      const newLevel = Math.floor(newXp / 500) + 1;

      if (supabase && user?.id) {
        await supabase
          .from('profiles')
          .update({ dopa_xp: newXp, dopa_level: newLevel })
          .eq('id', user.id);
      }

      setProfile(prev => ({
        ...prev,
        dopa_xp: newXp,
        dopa_level: newLevel,
      }));
    };

    awardXp();
  }, [phase, profile?.dopa_xp, setProfile, user?.id]);

  useEffect(() => {
    if (phase !== 'complete') return undefined;
    const homeTimer = window.setTimeout(() => navigate('/'), 2500);
    return () => window.clearTimeout(homeTimer);
  }, [phase, navigate]);

  if (phase === 'intro') {
    return (
      <div className="flex min-h-screen flex-col bg-[#0a0a0a] p-4">
        <button type="button" onClick={() => navigate(-1)} className="mb-4 text-left text-gray-400">← Back</button>
        <TimeLabel slot={timeSlot} label={timeLabel} />
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#CCFF00]/10 text-[#CCFF00]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
              <rect x="2" y="14" width="20" height="3" rx="1" />
              <path d="M6 17v3M18 17v3M12 14V9" />
              <circle cx="12" cy="7" r="2" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">{breakData.title}</h1>
          <p className="mt-1 text-sm text-gray-400">{durationMin} min · {exercises.length} exercises</p>
        </div>
        <div className="flex-1 space-y-2">
          {exercises.map((item, index) => (
            <button
              type="button"
              key={`${item.name}-${index}`}
              onClick={() => startExercise(index)}
              className="flex w-full items-center gap-3 rounded-xl bg-[#1a1a1a] p-3 text-left transition-all active:scale-[0.98] hover:bg-[#222222]"
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#CCFF00]/10 text-[#CCFF00]">
                {getIcon(item.name)}
              </span>
              <div>
                <p className="text-sm font-medium text-white">{item.name}</p>
                <p className="text-xs text-gray-500">{item.duration}s</p>
              </div>
            </button>
          ))}
        </div>
        <button type="button" onClick={startSession} className="mt-4 rounded-2xl bg-[#CCFF00] py-4 text-lg font-bold text-black">
          Start Break
        </button>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] p-4">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#CCFF00]/10 text-[#CCFF00]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl font-bold text-[#CCFF00]">Done! +{DESK_BREAK_XP} XP</h1>
        <p className="mb-8 text-sm text-gray-400">Returning to Home…</p>
        <button type="button" onClick={() => navigate('/')} className="w-full rounded-2xl bg-[#CCFF00] px-8 py-4 font-bold text-black">
          Back to Home
        </button>
      </div>
    );
  }

  const progress = ((exercise.duration - timeLeft) / exercise.duration) * 100;
  const circumference = 2 * Math.PI * 50;

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0a] p-4">
      <button type="button" onClick={() => navigate(-1)} className="mb-4 text-left text-gray-400">← Back</button>
      <TimeLabel slot={timeSlot} label={timeLabel} />
      <div className="mb-6 flex gap-1">
        {exercises.map((_, index) => (
          <div key={index} className={`h-1 flex-1 rounded-full ${index <= currentIdx ? 'bg-[#CCFF00]' : 'bg-[#2a2a2a]'}`} />
        ))}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#CCFF00]/10 text-[#CCFF00]">
          {getIcon(exercise.name)}
        </div>
        <h2 className="mb-2 text-xl font-bold text-white">{exercise.name}</h2>
        <p className="mb-6 px-4 text-center text-sm text-gray-400">{exercise.instruction}</p>
        <div className="relative h-32 w-32">
          <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#2a2a2a" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="#CCFF00"
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress / 100)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-3xl font-bold text-white">{timeLeft}</span>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-500">{currentIdx + 1} of {exercises.length}</p>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={skipExercise} className="rounded-xl bg-[#1a1a1a] px-4 py-3 text-sm text-gray-400">
          Skip →
        </button>
      </div>
    </div>
  );

  function skipExercise() {
    window.clearInterval(timerRef.current);
    if (currentIdx < exercises.length - 1) {
      const next = currentIdx + 1;
      setCurrentIdx(next);
      setTimeLeft(exercises[next].duration);
      setIsRunning(true);
    } else {
      setPhase('complete');
      setIsRunning(false);
    }
  }
}
