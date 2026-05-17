import { useCallback, useEffect, useRef, useState } from 'react';
import { speak } from '../../services/voiceService';
import { useAuth } from '../../context/AuthContext';
import { DESK_BREAK_COACH_MESSAGES, DESK_BREAKS } from '../../data/deskBreaks';

export const DeskBreakSession = ({ breakId = 'quick_5', onComplete }) => {
  const { profile } = useAuth();
  const [currentExercise, setCurrentExercise] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState('intro');
  const timerRef = useRef(null);

  const breakData = DESK_BREAKS.find(item => item.id === breakId) || DESK_BREAKS[0];
  const coachId = profile?.coach_persona || 'elias';
  const exercise = breakData.exercises[currentExercise];

  const nextExercise = useCallback(() => {
    if (currentExercise < breakData.exercises.length - 1) {
      const next = currentExercise + 1;
      setCurrentExercise(next);
      setTimeLeft(breakData.exercises[next].duration);
      speak(breakData.exercises[next].name, coachId);
      setIsRunning(true);
      return;
    }

    setIsRunning(false);
    setPhase('complete');
    speak('Great work! Break complete. Back to it!', coachId);
  }, [breakData.exercises, coachId, currentExercise]);

  const startSession = () => {
    const messages = DESK_BREAK_COACH_MESSAGES[coachId] || DESK_BREAK_COACH_MESSAGES.elias;
    const message = messages[Math.floor(Math.random() * messages.length)];
    speak(message, coachId);
    setPhase('exercise');
    setTimeLeft(exercise.duration);
    setIsRunning(true);
  };

  useEffect(() => {
    if (!isRunning) return undefined;

    timerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          window.clearInterval(timerRef.current);
          nextExercise();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerRef.current);
  }, [isRunning, currentExercise, nextExercise]);

  if (phase === 'intro') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#111] p-6">
        <div className="mb-4 text-6xl">🪑</div>
        <h1 className="mb-2 text-2xl font-bold text-white">{breakData.title}</h1>
        <p className="mb-1 text-sm text-gray-400">
          {breakData.duration} min · {breakData.exercises.length} exercises
        </p>
        <p className="mb-8 text-center text-sm text-gray-500">{breakData.description}</p>

        <div className="mb-8 w-full space-y-2">
          {breakData.exercises.map(item => (
            <div key={item.name} className="flex items-center gap-3 rounded-xl bg-[#1a1a1a] p-3">
              <span className="text-2xl">{item.gif}</span>
              <div>
                <p className="text-sm font-medium text-white">{item.name}</p>
                <p className="text-xs text-gray-500">
                  {item.duration}s · {item.targetArea}
                </p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={startSession}
          className="w-full rounded-2xl bg-[#CCFF00] px-8 py-4 text-lg font-bold text-black"
        >
          Start Break
        </button>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#111] p-6">
        <div className="mb-4 text-6xl">✅</div>
        <h1 className="mb-2 text-2xl font-bold text-[#CCFF00]">Break Complete!</h1>
        <p className="mb-8 text-sm text-gray-400">+{breakData.exercises.length * 5} XP earned</p>
        <button
          onClick={onComplete}
          className="w-full rounded-2xl bg-[#CCFF00] px-8 py-4 text-lg font-bold text-black"
        >
          Back to Work
        </button>
      </div>
    );
  }

  const progress = ((exercise.duration - timeLeft) / exercise.duration) * 100;
  const circumference = 2 * Math.PI * 56;

  return (
    <div className="flex min-h-screen flex-col bg-[#111] p-6">
      <div className="mb-6 flex gap-1">
        {breakData.exercises.map((item, index) => (
          <div
            key={item.name}
            className={`h-1 flex-1 rounded-full ${
              index < currentExercise
                ? 'bg-[#CCFF00]'
                : index === currentExercise
                  ? 'bg-[#CCFF00]/50'
                  : 'bg-[#2a2a2a]'
            }`}
          />
        ))}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="mb-6 animate-bounce text-8xl">{exercise.gif}</div>
        <h2 className="mb-2 text-2xl font-bold text-white">{exercise.name}</h2>
        <p className="mb-8 px-4 text-center text-sm text-gray-400">{exercise.instruction}</p>

        <div className="relative mb-8 h-32 w-32">
          <svg className="h-32 w-32 -rotate-90" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="56" fill="none" stroke="#2a2a2a" strokeWidth="8" />
            <circle
              cx="64"
              cy="64"
              r="56"
              fill="none"
              stroke="#CCFF00"
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress / 100)}
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-3xl font-bold text-white">{timeLeft}</span>
          </div>
        </div>

        <p className="text-sm text-gray-500">
          Exercise {currentExercise + 1} of {breakData.exercises.length}
        </p>
      </div>

      <button onClick={nextExercise} className="rounded-xl bg-[#1a1a1a] py-3 text-sm text-gray-400">
        Skip →
      </button>
    </div>
  );
};

