import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EXERCISES } from '../data/exercises';
import { useAuth } from '../context/AuthContext';

const FILTERS = ['all', 'chest', 'back', 'shoulders', 'arms', 'core', 'legs', 'cardio'];
const MUSCLE_COLORS = {
  primary: '#CCFF00',
  secondary: '#FF9500',
  tertiary: '#32ADE6',
};

export default function ExerciseLibrary() {
  const { id } = useParams();
  if (id) return <ExerciseDetail id={id} />;
  return <ExerciseList />;
}

function ExerciseList() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const exercises = useMemo(
    () =>
      EXERCISES.filter(item => {
        const matchesFilter = filter === 'all' || item.category === filter;
        const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase());
        return matchesFilter && matchesQuery;
      }),
    [filter, query],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
      <header className="mb-5">
        <button type="button" onClick={() => navigate(-1)} className="mb-3 flex h-8 w-8 items-center justify-center text-gray-400">←</button>
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#CCFF00]">Training</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Exercise Library</h1>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search exercises..."
          className="mt-4 w-full rounded-2xl border border-white/10 bg-[#141416] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
        />
      </header>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(item => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-black uppercase ${
              filter === item ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/50'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {exercises.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(`/exercises/${item.id}`)}
            className="w-full rounded-3xl border border-white/10 bg-[#141416] p-4 text-left"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-black text-white">{item.emoji} {item.name}</p>
                <p className="mt-1 text-xs font-bold capitalize text-white/40">{item.category} · {item.level}</p>
              </div>
              <span className="text-xl text-[#CCFF00]">→</span>
            </div>
            <MuscleBar label={`Primary: ${item.muscles.primary}`} value={85} color="#CCFF00" />
            <MuscleBar label={`Secondary: ${item.muscles.secondary.join(', ') || 'None'}`} value={48} color="#FF9500" />
          </button>
        ))}
      </div>
    </main>
  );
}

function ExerciseDetail({ id }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const exercise = EXERCISES.find(item => item.id === id) || EXERCISES[0];
  const coachPrompt = `Tell me everything about ${exercise.name} for my ${profile?.goal || 'strength_gain'} goal as an ${profile?.experience || 'intermediate'} level athlete`;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
      <button type="button" onClick={() => navigate('/exercises')} className="mb-5 text-sm font-black text-[#CCFF00]">← Back</button>
      <h1 className="text-3xl font-black uppercase tracking-[-0.04em]">{exercise.name}</h1>

      <section className="my-5 rounded-3xl border border-white/10 bg-[#141416] p-5 text-center">
        <div className="animate-bounce text-7xl">{exercise.emoji}</div>
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-white/35">Animated movement preview</p>
      </section>

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <p className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Muscles Targeted</p>
        <MuscleBar label={`Primary: ${exercise.muscles.primary}`} value={90} color={MUSCLE_COLORS.primary} />
        <MuscleBar label={`Secondary: ${exercise.muscles.secondary.join(', ') || 'None'}`} value={55} color={MUSCLE_COLORS.secondary} />
        <MuscleBar label={`Tertiary: ${exercise.muscles.tertiary.join(', ') || 'None'}`} value={28} color={MUSCLE_COLORS.tertiary} />
      </section>

      <InfoSection title="Form Cues" items={exercise.formCues} />
      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Tempo</p>
        <p className="mt-2 text-xl font-black">{exercise.tempo}</p>
      </section>
      <InfoSection title="Sets & Reps by Goal" items={Object.entries(exercise.sets).map(([goal, text]) => `${goal}: ${text}`)} />
      <InfoSection title="Variations" items={exercise.variations} />

      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="rounded-2xl bg-[#CCFF00] py-4 text-sm font-black text-black">Add to Workout</button>
        <button type="button" onClick={() => navigate('/coach', { state: { prefill: coachPrompt } })} className="rounded-2xl border border-[#CCFF00]/40 bg-[#CCFF00]/10 py-4 text-sm font-black text-[#CCFF00]">
          Ask Coach
        </button>
      </div>
    </main>
  );
}

function MuscleBar({ label, value, color }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs font-bold text-white/55">
        <span className="capitalize">{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function InfoSection({ title, items }) {
  return (
    <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
      <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">{title}</p>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item} className="text-sm leading-6 text-white/70">✓ {item}</li>
        ))}
      </ul>
    </section>
  );
}
