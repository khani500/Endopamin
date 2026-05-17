import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DESK_BREAKS } from '../data/deskBreaks';
import { speak } from '../lib/voice';

export default function DeskBreakSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const breakData = DESK_BREAKS.find(item => item.id === id) || DESK_BREAKS[0];
  const [phase, setPhase] = useState('intro');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef(null);
  const exercise = breakData.exercises[currentIdx];
  const coachId = profile?.coach_persona || 'elias';

  const startSession = () => {
    setPhase('exercise');
    setTimeLeft(exercise.duration);
    setIsRunning(true);
    speak(`Starting ${breakData.title}. First: ${exercise.name}`, coachId);
  };

  useEffect(() => {
    if (!isRunning) return undefined;

    timerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          window.clearInterval(timerRef.current);
          if (currentIdx < breakData.exercises.length - 1) {
            const next = currentIdx + 1;
            setCurrentIdx(next);
            const nextEx = breakData.exercises[next];
            setTimeLeft(nextEx.duration);
            speak(nextEx.name, coachId);
            setIsRunning(true);
          } else {
            setPhase('complete');
            setIsRunning(false);
            speak('Great job! Break complete. Back to work!', coachId);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerRef.current);
  }, [breakData.exercises, coachId, currentIdx, isRunning]);

  if (phase === 'intro') {
    return (
      <div className="flex min-h-screen flex-col bg-[#0a0a0a] p-4">
        <button type="button" onClick={() => navigate(-1)} className="mb-4 text-left text-gray-400">← Back</button>
        <div className="mb-6 text-center">
          <div className="mb-3 text-6xl">{breakData.emoji}</div>
          <h1 className="text-2xl font-bold text-white">{breakData.title}</h1>
          <p className="mt-1 text-sm text-gray-400">{breakData.duration} min · {breakData.exercises.length} exercises</p>
        </div>
        <div className="flex-1 space-y-2">
          {breakData.exercises.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center gap-3 rounded-xl bg-[#1a1a1a] p-3">
              <span className="text-2xl">{item.emoji || item.gif}</span>
              <div>
                <p className="text-sm font-medium text-white">{item.name}</p>
                <p className="text-xs text-gray-500">{item.duration}s</p>
              </div>
            </div>
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
        <div className="mb-4 text-6xl">✅</div>
        <h1 className="mb-2 text-2xl font-bold text-[#CCFF00]">Break Complete!</h1>
        <p className="mb-8 text-sm text-gray-400">+{breakData.exercises.length * 5} XP earned</p>
        <button type="button" onClick={() => navigate(-1)} className="w-full rounded-2xl bg-[#CCFF00] px-8 py-4 font-bold text-black">
          Back to Work
        </button>
      </div>
    );
  }

  const progress = ((exercise.duration - timeLeft) / exercise.duration) * 100;
  const circumference = 2 * Math.PI * 50;

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0a] p-4">
      <div className="mb-6 flex gap-1">
        {breakData.exercises.map((_, index) => (
          <div key={index} className={`h-1 flex-1 rounded-full ${index <= currentIdx ? 'bg-[#CCFF00]' : 'bg-[#2a2a2a]'}`} />
        ))}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="mb-4 animate-bounce text-6xl">{exercise.emoji || exercise.gif}</div>
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
        <p className="mt-4 text-sm text-gray-500">{currentIdx + 1} of {breakData.exercises.length}</p>
      </div>
      <button type="button" onClick={skipExercise} className="rounded-xl bg-[#1a1a1a] py-3 text-sm text-gray-400">
        Skip →
      </button>
    </div>
  );

  function skipExercise() {
    window.clearInterval(timerRef.current);
    if (currentIdx < breakData.exercises.length - 1) {
      const next = currentIdx + 1;
      setCurrentIdx(next);
      setTimeLeft(breakData.exercises[next].duration);
      setIsRunning(true);
    } else {
      setPhase('complete');
    }
  }
}
