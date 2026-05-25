import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useCoach } from '../hooks/useCoach';
import { useStreak } from '../hooks/useStreak';

const DEFAULT_REST_SECONDS = 60;
const SET_WORK_SECONDS = 45;
const XP_PER_SET = 10;
const ALL_SETS_BONUS_XP = 50;
const XP_PER_LEVEL = 500;

const WORKOUT_SESSIONS = {
  strength: {
    title: 'Strength Training',
    duration: '30-60 min',
    exercises: [
      { name: 'Bench Press', sets: 4, reps: '6-8', rest: 90, muscle: 'chest', emoji: '🏋️', tip: 'Retract your shoulder blades before every rep.' },
      { name: 'Barbell Row', sets: 4, reps: '6-8', rest: 90, muscle: 'back', emoji: '💪', tip: 'Pull elbows toward your hips.' },
      { name: 'Overhead Press', sets: 3, reps: '8-10', rest: 75, muscle: 'shoulders', emoji: '⬆️', tip: 'Brace your core before pressing.' },
      { name: 'Squat', sets: 4, reps: '6-8', rest: 120, muscle: 'legs', emoji: '🦵', tip: 'Knees track over toes.' },
      { name: 'Pull Up', sets: 3, reps: 'max', rest: 75, muscle: 'back', emoji: '🧗', tip: 'Start by pulling your shoulder blades down.' },
    ],
  },
  cardio: {
    title: 'Cardio Session',
    duration: '20-45 min',
    exercises: [
      { name: 'Warm Up Walk', sets: 1, reps: '5 min', rest: 0, muscle: 'full body', emoji: '🚶', tip: 'Keep nasal breathing easy.' },
      { name: 'Zone 2 Run', sets: 1, reps: '20-30 min', rest: 0, muscle: 'legs', emoji: '🏃', tip: 'Stay at a pace where you can talk.' },
      { name: 'Sprint Intervals', sets: 6, reps: '30s on / 30s off', rest: 30, muscle: 'full body', emoji: '⚡', tip: 'Explode, then recover fully.' },
      { name: 'Cool Down', sets: 1, reps: '5 min', rest: 0, muscle: 'full body', emoji: '🧘', tip: 'Let your heart rate drop slowly.' },
    ],
  },
  mobility: {
    title: 'Mobility Flow',
    duration: '15-30 min',
    exercises: [
      { name: 'Cat-Cow', sets: 3, reps: '10 reps', rest: 0, muscle: 'spine', emoji: '🐱', tip: 'Move one vertebra at a time.' },
      { name: 'Hip 90/90 Stretch', sets: 2, reps: '60s each', rest: 0, muscle: 'hips', emoji: '🦵', tip: 'Keep the torso tall.' },
      { name: 'Thoracic Rotation', sets: 3, reps: '10 each side', rest: 0, muscle: 'upper back', emoji: '🌀', tip: 'Rotate through the rib cage.' },
      { name: 'Pigeon Pose', sets: 2, reps: '60s each', rest: 0, muscle: 'hips', emoji: '🕊️', tip: 'Breathe into the stretch.' },
      { name: 'World Greatest Stretch', sets: 3, reps: '5 each side', rest: 0, muscle: 'full body', emoji: '🌍', tip: 'Open the hips and chest together.' },
    ],
  },
  hiit: {
    title: 'HIIT Session',
    duration: '20-40 min',
    exercises: [
      { name: 'Burpees', sets: 4, reps: '45s on / 15s off', rest: 60, muscle: 'full body', emoji: '💥', tip: 'Land soft and stay rhythmic.' },
      { name: 'Jump Squats', sets: 4, reps: '45s on / 15s off', rest: 60, muscle: 'legs', emoji: '🦘', tip: 'Explode up, control down.' },
      { name: 'Mountain Climbers', sets: 4, reps: '45s on / 15s off', rest: 60, muscle: 'core', emoji: '🧗', tip: 'Keep hips low.' },
      { name: 'Push Up to Rotation', sets: 4, reps: '45s on / 15s off', rest: 60, muscle: 'chest', emoji: '🔄', tip: 'Stack shoulder over wrist.' },
      { name: 'Box Jump', sets: 4, reps: '10 reps', rest: 60, muscle: 'legs', emoji: '📦', tip: 'Step down to protect your knees.' },
    ],
  },
};

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function estimateCalories(sessionSeconds, setsCompleted, sessionType) {
  const minutes = sessionSeconds / 60;
  const rate = sessionType === 'cardio' || sessionType === 'hiit' ? 10 : 7;
  return Math.round(minutes * rate + setsCompleted * 8);
}

function calcLevel(xp) {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

function calcWorkoutXp(setsCompleted, totalSets) {
  const setXp = setsCompleted * XP_PER_SET;
  const bonus = totalSets > 0 && setsCompleted >= totalSets ? ALL_SETS_BONUS_XP : 0;
  return setXp + bonus;
}

export default function WorkoutSession({ planMode = false }) {
  const navigate = useNavigate();
  const { type } = useParams();
  const { user, profile, setProfile } = useAuth();
  const { coach, speak } = useCoach();
  const { updateStreak } = useStreak();

  const sessionType = planMode ? 'strength' : (type || 'strength').toLowerCase();
  const session = WORKOUT_SESSIONS[sessionType] || WORKOUT_SESSIONS.strength;

  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [setIndex, setSetIndex] = useState(0);
  const [phase, setPhase] = useState('active');
  const [paused, setPaused] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [setSecondsLeft, setSetSecondsLeft] = useState(SET_WORK_SECONDS);
  const [restSecondsLeft, setRestSecondsLeft] = useState(0);
  const [restTotal, setRestTotal] = useState(DEFAULT_REST_SECONDS);
  const [weight, setWeight] = useState('80');
  const [reps, setReps] = useState('8');
  const [setLogs, setSetLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [saving, setSaving] = useState(false);

  const pausedRef = useRef(false);
  const finishingRef = useRef(false);

  const exercise = session.exercises[exerciseIndex];
  const totalSets = useMemo(
    () => session.exercises.reduce((sum, item) => sum + item.sets, 0),
    [session.exercises],
  );
  const completedSets = setLogs.length;
  const globalSetNumber = completedSets + 1;
  const sessionProgress = totalSets ? completedSets / totalSets : 0;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (phase === 'summary' || paused) return undefined;

    const id = window.setInterval(() => {
      setSessionSeconds(prev => prev + 1);
    }, 1000);

    return () => window.clearInterval(id);
  }, [phase, paused]);

  useEffect(() => {
    if (phase !== 'active' || paused) return undefined;

    const id = window.setInterval(() => {
      setSetSecondsLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(id);
  }, [phase, paused, exerciseIndex, setIndex]);

  useEffect(() => {
    if (phase !== 'rest' || paused) return undefined;

    const id = window.setInterval(() => {
      setRestSecondsLeft(prev => {
        if (prev <= 1) {
          window.clearInterval(id);
          setPhase('active');
          setSetSecondsLeft(SET_WORK_SECONDS);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [phase, paused, exerciseIndex, setIndex]);

  const getRestDuration = useCallback(ex => {
    if (!ex?.rest || ex.rest <= 0) return DEFAULT_REST_SECONDS;
    return ex.rest;
  }, []);

  const finishWorkout = useCallback(async (logs = setLogs) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setSaving(true);

    const setsCompleted = logs.length;
    const calories = estimateCalories(sessionSeconds, setsCompleted, sessionType);
    const workoutXp = calcWorkoutXp(setsCompleted, totalSets);
    const durationMinutes = Math.max(1, Math.round(sessionSeconds / 60));

    let newStreak = profile?.streak_count || 0;

    try {
      const streakResult = await updateStreak();
      if (streakResult) {
        newStreak = streakResult.newStreak;
      }

      let latestXp = profile?.dopa_xp || 0;
      let previousLevel = calcLevel(latestXp);

      if (supabase && user?.id) {
        const { data: freshProfile } = await supabase
          .from('profiles')
          .select('dopa_xp, dopa_level')
          .eq('id', user.id)
          .maybeSingle();

        latestXp = freshProfile?.dopa_xp ?? latestXp;
        previousLevel = freshProfile?.dopa_level ?? calcLevel(latestXp);

        const finalXp = latestXp + workoutXp;
        const newLevel = calcLevel(finalXp);
        const leveledUp = newLevel > previousLevel;

        await supabase
          .from('profiles')
          .update({ dopa_xp: finalXp, dopa_level: newLevel })
          .eq('id', user.id);

        setProfile(prev => ({
          ...prev,
          dopa_xp: finalXp,
          dopa_level: newLevel,
          streak_count: newStreak,
        }));

        await supabase.from('workout_logs').insert({
          user_id: user.id,
          workout_type: sessionType,
          duration_minutes: durationMinutes,
          exercises: {
            sets: logs,
            sets_completed: setsCompleted,
            xp_earned: workoutXp,
            duration_seconds: sessionSeconds,
          },
          calories_burned: calories,
          coach_feedback: `+${workoutXp} ENDO SCORE`,
          logged_at: new Date().toISOString(),
        });

        setSummary({
          totalTime: sessionSeconds,
          setsCompleted,
          calories,
          xpEarned: workoutXp,
          leveledUp,
          newLevel,
          allSetsComplete: setsCompleted >= totalSets && totalSets > 0,
          streak: newStreak,
        });
      } else {
        setSummary({
          totalTime: sessionSeconds,
          setsCompleted,
          calories,
          xpEarned: workoutXp,
          leveledUp: false,
          newLevel: previousLevel,
          allSetsComplete: setsCompleted >= totalSets && totalSets > 0,
          streak: newStreak,
        });
      }

      setPhase('summary');
      speak(`+${workoutXp} ENDO SCORE. Strong work today.`);
    } catch (error) {
      console.error('Failed to save workout:', error);
      setSummary({
        totalTime: sessionSeconds,
        setsCompleted,
        calories,
        xpEarned: workoutXp,
        leveledUp: false,
        newLevel: calcLevel(profile?.dopa_xp || 0),
        allSetsComplete: setsCompleted >= totalSets && totalSets > 0,
        streak: newStreak,
      });
      setPhase('summary');
    } finally {
      setSaving(false);
    }
  }, [
    setLogs,
    sessionSeconds,
    sessionType,
    totalSets,
    updateStreak,
    profile,
    user?.id,
    setProfile,
    speak,
  ]);

  const advanceAfterSet = useCallback((logs, exIdx, currentSetIdx) => {
    const ex = session.exercises[exIdx];
    const isLastSetOfExercise = currentSetIdx + 1 >= ex.sets;
    const isLastExercise = exIdx >= session.exercises.length - 1;

    if (isLastSetOfExercise && isLastExercise) {
      void finishWorkout(logs);
      return;
    }

    if (isLastSetOfExercise) {
      const nextExercise = session.exercises[exIdx + 1];
      const restDuration = getRestDuration(ex);
      setExerciseIndex(exIdx + 1);
      setSetIndex(0);
      setSetSecondsLeft(SET_WORK_SECONDS);
      if (restDuration > 0) {
        setRestTotal(restDuration);
        setRestSecondsLeft(restDuration);
        setPhase('rest');
      } else {
        setPhase('active');
      }
      return;
    }

    const restDuration = getRestDuration(ex);
    setSetIndex(currentSetIdx + 1);
    setSetSecondsLeft(SET_WORK_SECONDS);
    if (restDuration > 0) {
      setRestTotal(restDuration);
      setRestSecondsLeft(restDuration);
      setPhase('rest');
    } else {
      setPhase('active');
    }
  }, [session.exercises, getRestDuration, finishWorkout]);

  const completeSet = () => {
    if (phase !== 'active' || saving) return;

    const log = {
      exercise: exercise.name,
      exerciseIndex,
      set: setIndex + 1,
      weight: weight.trim() || null,
      reps: reps.trim() || null,
      targetReps: exercise.reps,
      completedAt: new Date().toISOString(),
    };

    const nextLogs = [...setLogs, log];
    setSetLogs(nextLogs);
    advanceAfterSet(nextLogs, exerciseIndex, setIndex);
  };

  const skipRest = () => {
    setRestSecondsLeft(0);
    setPhase('active');
    setSetSecondsLeft(SET_WORK_SECONDS);
  };

  const togglePause = () => setPaused(prev => !prev);

  if (phase === 'summary' && summary) {
    return (
      <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#0A0A0A] px-5 pb-10 pt-12 text-white">
        <AnimatePresence>
          {summary.leveledUp && (
            <motion.div
              initial={{ opacity: 0, y: -60, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.6 }}
              className="pointer-events-none absolute left-5 right-5 top-6 z-20 rounded-2xl border border-[#CCFF00]/40 bg-gradient-to-r from-[#CCFF00]/20 via-[#CCFF00]/10 to-transparent px-4 py-3 text-center shadow-[0_0_40px_rgba(204,255,0,0.15)]"
            >
              <motion.p
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                className="text-lg font-black uppercase tracking-[0.12em] text-[#CCFF00]"
              >
                LEVEL UP! 🔥
              </motion.p>
              <p className="mt-0.5 text-xs font-bold text-white/60">Level {summary.newLevel} unlocked</p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          <motion.div
            key="endo-score-float"
            initial={{ opacity: 0, y: 120, scale: 0.9 }}
            animate={{ opacity: [0, 1, 1, 0], y: [120, 20, -10, -80], scale: [0.9, 1.08, 1, 0.95] }}
            transition={{ duration: 2.4, ease: 'easeOut', delay: 0.35 }}
            className="pointer-events-none absolute inset-x-0 bottom-28 z-30 text-center"
          >
            <p className="text-3xl font-black uppercase tracking-[-0.03em] text-[#CCFF00] drop-shadow-[0_0_24px_rgba(204,255,0,0.45)]">
              +{summary.xpEarned} ENDO SCORE
            </p>
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          <motion.section
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="mx-auto flex w-full max-w-[430px] flex-1 flex-col justify-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, delay: 0.15 }}
              className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#CCFF00] bg-[#CCFF00]/10 text-4xl"
            >
              ✅
            </motion.div>

            <h1 className="text-center text-3xl font-black uppercase tracking-[-0.04em] text-[#CCFF00]">
              Workout Complete
            </h1>
            <p className="mt-2 text-center text-sm text-white/50">
              {coach.name} logged your session. Dopa score updated.
            </p>

            {summary.allSetsComplete && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mt-3 text-center text-xs font-black uppercase tracking-[0.14em] text-[#CCFF00]/80"
              >
                All sets complete · +{ALL_SETS_BONUS_XP} bonus XP
              </motion.p>
            )}

            <div className="mt-8 grid grid-cols-2 gap-3">
              {[
                { label: 'Total Time', value: formatTime(summary.totalTime), icon: '⏱' },
                { label: 'Sets Done', value: `${summary.setsCompleted}`, icon: '💪' },
                { label: 'Calories', value: `~${summary.calories}`, icon: '🔥' },
                { label: 'Endo Score', value: `+${summary.xpEarned}`, icon: '⚡' },
              ].map(({ label, value, icon }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.08 }}
                  className="rounded-2xl border border-white/10 bg-[#141416] p-4 text-center"
                >
                  <motion.div className="text-xl">{icon}</motion.div>
                  <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/40">{label}</p>
                  <p className="mt-1 text-xl font-black text-[#CCFF00]">{value}</p>
                </motion.div>
              ))}
            </div>

            {summary.streak > 0 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-4 text-center text-sm font-bold text-white/60"
              >
                🔥 {summary.streak}-day streak active
              </motion.p>
            )}

            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => navigate(-1)}
              className="mt-8 w-full rounded-2xl bg-[#CCFF00] py-4 text-sm font-black text-black"
            >
              Done
            </motion.button>
          </motion.section>
        </AnimatePresence>
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col bg-[#0A0A0A] px-4 pb-6 pt-6 text-white">
      {/* Header */}
      <header className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-gray-400"
        >
          ←
        </button>
        <motion.div
          key={session.title}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#CCFF00]">{sessionType}</p>
          <h1 className="text-base font-black">{session.title}</h1>
        </motion.div>
        <button
          type="button"
          onClick={togglePause}
          className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${
            paused ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/60'
          }`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </header>

      {/* Session timer — full width hero */}
      <motion.section
        layout
        className="mb-4 rounded-3xl border border-[#CCFF00]/20 bg-gradient-to-b from-[#141416] to-[#0A0A0A] p-5 text-center"
      >
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Session Time</p>
        <motion.p
          key={sessionSeconds}
          initial={{ scale: 1.04 }}
          animate={{ scale: 1 }}
          className="mt-1 font-mono text-5xl font-black tracking-tight text-[#CCFF00]"
        >
          {formatTime(sessionSeconds)}
        </motion.p>
        <motion.div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-[#CCFF00]"
            animate={{ width: `${sessionProgress * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </motion.div>
        <p className="mt-2 text-xs font-bold text-white/45">
          Set {globalSetNumber} / {totalSets} · {completedSets} completed
        </p>
      </motion.section>

      {/* Active exercise */}
      <AnimatePresence mode="wait">
        <motion.section
          key={`${exerciseIndex}-${setIndex}-${phase}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25 }}
          className="flex flex-1 flex-col rounded-3xl border border-white/10 bg-[#141416] p-4"
        >
          <p className="text-xs font-bold text-white/45">
            Exercise {exerciseIndex + 1} of {session.exercises.length}
          </p>

          <div className="mt-4 text-center">
            <motion.div
              animate={{ scale: phase === 'active' && !paused ? [1, 1.06, 1] : 1 }}
              transition={{ duration: 2, repeat: phase === 'active' && !paused ? Infinity : 0 }}
              className="text-6xl"
            >
              {exercise.emoji}
            </motion.div>
            <h2 className="mt-3 text-xl font-black">{exercise.name}</h2>
            <p className="mt-1 text-sm capitalize text-white/45">
              {exercise.muscle} · target {exercise.reps}
            </p>
          </div>

          {/* Set tracker */}
          <motion.div className="mt-5 flex items-center justify-center gap-2">
            {Array.from({ length: exercise.sets }).map((_, index) => (
              <motion.div
                key={index}
                animate={{
                  scale: index === setIndex && phase === 'active' ? 1.08 : 1,
                  backgroundColor: index < setIndex ? '#CCFF00' : index === setIndex ? '#CCFF0033' : 'rgba(255,255,255,0.06)',
                }}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-black ${
                  index < setIndex ? 'text-black' : index === setIndex ? 'text-[#CCFF00]' : 'text-white/35'
                }`}
              >
                {index < setIndex ? '✓' : index + 1}
              </motion.div>
            ))}
          </motion.div>

          <p className="mt-4 text-center text-sm font-black text-white/70">
            Set {setIndex + 1} of {exercise.sets}
          </p>

          {/* Set countdown (work phase) */}
          {phase === 'active' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-2xl bg-black/40 p-4 text-center"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Set Countdown</p>
              <p className={`mt-1 font-mono text-3xl font-black ${setSecondsLeft <= 10 ? 'text-[#CCFF00]' : 'text-white'}`}>
                {formatTime(setSecondsLeft)}
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-[#CCFF00]"
                  animate={{ width: `${(setSecondsLeft / SET_WORK_SECONDS) * 100}%` }}
                />
              </div>
            </motion.div>
          )}

          {/* Weight & reps */}
          {phase === 'active' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 grid grid-cols-2 gap-3"
            >
              <label className="text-xs font-bold text-white/45">
                Weight (kg)
                <input
                  value={weight}
                  onChange={e => setWeight(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white outline-none focus:border-[#CCFF00]/50"
                />
              </label>
              <label className="text-xs font-bold text-white/45">
                Reps
                <input
                  value={reps}
                  onChange={e => setReps(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white outline-none focus:border-[#CCFF00]/50"
                />
              </label>
            </motion.div>
          )}

          <p className="mt-4 rounded-2xl bg-black/35 p-3 text-sm leading-6 text-white/65">
            Coach tip: &ldquo;{exercise.tip}&rdquo;
          </p>

          {phase === 'active' && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={completeSet}
              disabled={paused || saving}
              className="mt-auto pt-4 w-full rounded-2xl bg-[#CCFF00] py-4 text-sm font-black text-black disabled:opacity-50"
            >
              Complete Set
            </motion.button>
          )}
        </motion.section>
      </AnimatePresence>

      {/* Complete workout */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        type="button"
        onClick={() => void finishWorkout()}
        disabled={saving || completedSets === 0}
        className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3.5 text-sm font-black text-white/60 disabled:opacity-40"
      >
        {saving ? 'Saving...' : 'Complete Workout'}
      </motion.button>

      {/* Rest overlay */}
      <AnimatePresence>
        {phase === 'rest' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0A]/95 px-6 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-[320px] text-center"
            >
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#CCFF00]">Rest</p>
              <h2 className="mt-2 text-2xl font-black">Recover</h2>
              <p className="mt-1 text-sm text-white/45">Next: {exercise.name} · Set {setIndex + 1}</p>

              <div className="relative mx-auto mt-8 h-44 w-44">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#222" strokeWidth="6" />
                  <motion.circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="#CCFF00"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 42}
                    animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - restSecondsLeft / restTotal) }}
                    transition={{ duration: 0.3 }}
                  />
                </svg>
                <motion.p
                  key={restSecondsLeft}
                  initial={{ scale: 1.1 }}
                  animate={{ scale: 1 }}
                  className="absolute inset-0 flex items-center justify-center font-mono text-4xl font-black text-[#CCFF00]"
                >
                  {formatTime(restSecondsLeft)}
                </motion.p>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={togglePause}
                  className="flex-1 rounded-2xl border border-white/10 bg-[#141416] py-3.5 text-sm font-black text-white/70"
                >
                  {paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={skipRest}
                  className="flex-1 rounded-2xl bg-[#CCFF00] py-3.5 text-sm font-black text-black"
                >
                  Skip Rest
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Paused overlay (active phase) */}
      <AnimatePresence>
        {paused && phase === 'active' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-[#0A0A0A]/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="rounded-3xl border border-white/10 bg-[#141416] px-8 py-6 text-center"
            >
              <p className="text-4xl">⏸</p>
              <p className="mt-3 text-lg font-black text-[#CCFF00]">Paused</p>
              <button
                type="button"
                onClick={togglePause}
                className="mt-4 rounded-2xl bg-[#CCFF00] px-6 py-3 text-sm font-black text-black"
              >
                Resume
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
