import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useCoach } from '../hooks/useCoach';
import { useStreak } from '../hooks/useStreak';

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

export default function WorkoutSession({ planMode = false }) {
  const navigate = useNavigate();
  const { type } = useParams();
  const { user } = useAuth();
  const { coach, speak } = useCoach();
  const { updateStreak } = useStreak();
  const sessionType = planMode ? 'strength' : (type || 'strength').toLowerCase();
  const session = WORKOUT_SESSIONS[sessionType] || WORKOUT_SESSIONS.strength;
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState({});
  const [weight, setWeight] = useState('80');
  const [reps, setReps] = useState('8');
  const [finished, setFinished] = useState(false);
  const exercise = session.exercises[exerciseIndex];
  const doneForExercise = completedSets[exercise.name] || 0;
  const totalSets = useMemo(() => session.exercises.reduce((sum, item) => sum + item.sets, 0), [session.exercises]);
  const doneSets = Object.values(completedSets).reduce((sum, value) => sum + value, 0);
  const progress = totalSets ? doneSets / totalSets : 0;

  const completeSet = async () => {
    const nextCount = Math.min(doneForExercise + 1, exercise.sets);
    const next = { ...completedSets, [exercise.name]: nextCount };
    setCompletedSets(next);

    if (nextCount >= exercise.sets) {
      if (exerciseIndex < session.exercises.length - 1) {
        setExerciseIndex(index => index + 1);
        return;
      }

      setFinished(true);
      const streakResult = await updateStreak();
      const message = streakResult
        ? `${streakResult.xpGained} XP earned! ${streakResult.newStreak} day streak!`
        : `${coach.name} says: Session complete. Strong work today.`;
      speak(message);
      if (supabase && user?.id) {
        await supabase.from('workout_logs').insert({
          user_id: user.id,
          workout_type: sessionType,
          duration_minutes: Number(session.duration.match(/\d+/)?.[0]) || 30,
          exercises: session.exercises,
          coach_feedback: message,
          logged_at: new Date().toISOString(),
        });
      }
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
      <header className="mb-5 flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center text-gray-400">←</button>
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#CCFF00]">{sessionType}</p>
          <h1 className="text-lg font-black">{session.title}</h1>
        </div>
        <span className="rounded-full bg-white/[0.06] px-2 py-1 text-xs font-bold text-white/50">⏱ 00:00</span>
      </header>

      <div className="mb-5 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[#CCFF00]" style={{ width: `${progress * 100}%` }} />
      </div>

      {finished ? (
        <section className="rounded-3xl border border-[#CCFF00]/30 bg-[#CCFF00]/10 p-4 text-center">
          <div className="text-5xl">✅</div>
          <h2 className="mt-3 text-xl font-black text-[#CCFF00]">Workout Complete</h2>
          <p className="mt-2 text-sm text-white/60">{coach.name} is proud. Streak updated.</p>
          <button type="button" onClick={() => navigate(-1)} className="mt-5 w-full rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black">
            Back
          </button>
        </section>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-[#141416] p-4">
          <p className="text-xs font-bold text-white/45">Exercise {exerciseIndex + 1} of {session.exercises.length}</p>
          <div className="mt-5 text-center">
            <div className="text-6xl">{exercise.emoji}</div>
            <h2 className="mt-3 text-xl font-black">{exercise.name}</h2>
            <p className="mt-1 text-sm capitalize text-white/45">{exercise.muscle} · {exercise.sets} sets x {exercise.reps} reps</p>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            {Array.from({ length: exercise.sets }).map((_, index) => (
              <div key={index} className={`rounded-2xl py-3 text-center text-xs font-black ${index < doneForExercise ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/35'}`}>
                Set {index + 1}<br />{index < doneForExercise ? '✓' : '○'}
              </div>
            ))}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-bold text-white/45">Rest Timer: {exercise.rest}s</p>
            <div className="h-2 rounded-full bg-white/10">
              <div className="h-full w-3/4 rounded-full bg-[#CCFF00]" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-white/45">
              Weight
              <input value={weight} onChange={event => setWeight(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white outline-none" />
            </label>
            <label className="text-xs font-bold text-white/45">
              Reps
              <input value={reps} onChange={event => setReps(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white outline-none" />
            </label>
          </div>

          <button type="button" onClick={() => void completeSet()} className="mt-5 w-full rounded-2xl bg-[#CCFF00] py-4 text-sm font-black text-black">
            Complete Set
          </button>
          <p className="mt-4 rounded-2xl bg-black/35 p-3 text-sm leading-6 text-white/65">Coach tip: "{exercise.tip}"</p>
        </section>
      )}
    </main>
  );
}
