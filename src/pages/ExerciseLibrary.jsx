import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchAllExercises } from '../services/exerciseDBService';

const CATEGORY_CARDS = [
  { label: 'Chest', emoji: '🏋️', filter: 'chest' },
  { label: 'Back', emoji: '🔙', filter: 'back' },
  { label: 'Shoulders', emoji: '💪', filter: 'shoulders' },
  { label: 'Arms', emoji: '💪', filter: 'upper arms' },
  { label: 'Legs', emoji: '🦵', filter: 'upper legs' },
  { label: 'Core', emoji: '🔥', filter: 'waist' },
  { label: 'Cardio', emoji: '🏃', filter: 'cardio' },
  { label: 'All', emoji: '⚡', filter: null },
];

const LEVEL_FILTERS = ['all', 'beginner', 'intermediate', 'expert'];
const EQUIPMENT_FILTERS = ['all', 'barbell', 'dumbbell', 'bodyweight', 'machine', 'kettlebell'];
const LEVEL_STYLES = {
  beginner: { bg: 'rgba(204,255,0,0.15)', border: 'rgba(204,255,0,0.35)', text: '#CCFF00' },
  intermediate: { bg: 'rgba(255,165,60,0.15)', border: 'rgba(255,165,60,0.35)', text: '#FFA53C' },
  expert: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
};

let exercisesCache = null;

function normalizeEquipmentLabel(raw) {
  const text = String(raw || '').toLowerCase();
  if (!text || text === 'none') return 'bodyweight';
  if (text.includes('barbell')) return 'barbell';
  if (text.includes('dumbbell')) return 'dumbbell';
  if (text.includes('kettlebell')) return 'kettlebell';
  if (text.includes('body')) return 'bodyweight';
  if (text.includes('machine')) return 'machine';
  return text;
}

function buildCoachPrefill(exercise, profile) {
  const level = profile?.experience || 'intermediate';
  const goal = profile?.goal || 'strength_gain';
  const equipment = exercise.equipment || 'bodyweight';
  return `Build a ${goal} focused workout around ${exercise.name} for a ${level} athlete. Include form cues, regressions, and progression with ${equipment}.`;
}

function protocolForLevel(level) {
  if (level === 'beginner') return '3 sets x 12-15 reps, 60s rest';
  if (level === 'intermediate') return '4 sets x 8-12 reps, 75s rest';
  return '5 sets x 5-8 reps, 90s rest';
}

export default function ExerciseLibrary() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [allExercises, setAllExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [equipmentFilter, setEquipmentFilter] = useState('all');
  const [selectedExercise, setSelectedExercise] = useState(null);
  const categoryParam = searchParams.get('category');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const exercises = exercisesCache || await fetchAllExercises(1300);
        if (!exercisesCache) exercisesCache = exercises;
        if (!cancelled) setAllExercises(exercises);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load exercises');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = {};
    allExercises.forEach(ex => {
      const bodyPart = ex.bodyPart || ex.category;
      if (!bodyPart) return;
      counts[bodyPart] = (counts[bodyPart] || 0) + 1;
    });
    return counts;
  }, [allExercises]);

  const categoryExercises = useMemo(() => {
    const source = allExercises;
    if (!categoryParam) return source;
    return source.filter(ex => (ex.bodyPart || ex.category) === categoryParam);
  }, [allExercises, categoryParam]);

  const searchableExercises = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categoryExercises;
    return categoryExercises.filter(ex => String(ex.name || '').toLowerCase().includes(q));
  }, [categoryExercises, query]);

  const filteredExercises = useMemo(() => {
    return searchableExercises.filter(ex => {
      const matchesLevel = levelFilter === 'all' || ex.level === levelFilter;
      const normalizedEquipment = normalizeEquipmentLabel(ex.equipment);
      const matchesEquipment = equipmentFilter === 'all' || normalizedEquipment.includes(equipmentFilter);
      return matchesLevel && matchesEquipment;
    });
  }, [searchableExercises, levelFilter, equipmentFilter]);

  const showingList = Boolean(categoryParam) || query.trim().length > 0;

  function openCategory(filter) {
    if (!filter) {
      setSearchParams({});
      return;
    }
    setSearchParams({ category: filter });
  }

  function clearCategory() {
    setSearchParams({});
    setLevelFilter('all');
    setEquipmentFilter('all');
  }

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

      {loading && <p className="text-sm text-[#CCFF00]">Loading exercises...</p>}
      {error && <p className="text-sm text-[#FF6B6B]">{error}</p>}

      {!loading && !error && !showingList && (
        <div className="grid grid-cols-2 gap-3">
          {CATEGORY_CARDS.map(card => {
            const count = card.filter ? (categoryCounts[card.filter] || 0) : allExercises.length;
            return (
              <button
                key={card.label}
                type="button"
                onClick={() => openCategory(card.filter)}
                className="rounded-3xl border border-white/10 bg-[#141416] p-4 text-left transition-all duration-200 active:scale-[0.98] hover:border-[#CCFF00]/40"
              >
                <div className="text-3xl">{card.emoji}</div>
                <p className="mt-3 text-lg font-black">{card.label}</p>
                <p className="text-xs text-white/50">{count} exercises</p>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && showingList && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <button type="button" onClick={clearCategory} className="text-sm font-black text-[#CCFF00]">← Back</button>
            <p className="text-xs text-white/50 capitalize">
              {(categoryParam || 'all exercises')} · {filteredExercises.length} exercises
            </p>
          </div>

          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {LEVEL_FILTERS.map(level => (
              <button
                key={level}
                type="button"
                onClick={() => setLevelFilter(level)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-black uppercase ${
                  levelFilter === level ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/55'
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {EQUIPMENT_FILTERS.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setEquipmentFilter(item)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-black uppercase ${
                  equipmentFilter === item ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/55'
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredExercises.map(item => {
              const levelStyle = LEVEL_STYLES[item.level] || LEVEL_STYLES.intermediate;
              const primaryMuscles = Array.isArray(item.muscles) ? item.muscles.join(', ') : (item.muscles || item.target || 'general');

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedExercise(item)}
                  className="w-full rounded-3xl border border-white/10 bg-[#141416] p-3 text-left"
                >
                  <div className="flex gap-3">
                    <div className="h-20 w-20 overflow-hidden rounded-2xl bg-black/30">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl">⚡</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-black">{item.name}</p>
                      <p className="mt-1 truncate text-[11px] capitalize text-white/45">
                        {primaryMuscles} · {item.equipment || 'bodyweight'}
                      </p>
                      <span
                        className="mt-2 inline-block rounded-full border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ background: levelStyle.bg, borderColor: levelStyle.border, color: levelStyle.text }}
                      >
                        {item.level}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {selectedExercise && (
        <ExerciseDetailModal
          exercise={selectedExercise}
          onClose={() => setSelectedExercise(null)}
          onAskCoach={() => {
            const prefill = buildCoachPrefill(selectedExercise, profile);
            navigate('/coach', { state: { prefill } });
          }}
        />
      )}
    </main>
  );
}

function ExerciseDetailModal({ exercise, onClose, onAskCoach }) {
  const protocol = protocolForLevel(exercise.level);
  const primary = Array.isArray(exercise.muscles) ? exercise.muscles : [];
  const secondary = Array.isArray(exercise.muscles_secondary) ? exercise.muscles_secondary : [];
  const instructions = Array.isArray(exercise.instructions) ? exercise.instructions : [];
  const levelStyle = LEVEL_STYLES[exercise.level] || LEVEL_STYLES.intermediate;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60">
      <button type="button" onClick={onClose} className="absolute inset-0" aria-label="Close modal" />
      <div className="relative w-full rounded-t-3xl border border-white/10 bg-[#111113] p-4 pb-8 text-white">
        <button type="button" onClick={onClose} className="mb-3 text-xs font-black text-white/60">Close</button>

        <div className="mb-4 h-44 overflow-hidden rounded-2xl bg-black/30">
          {exercise.thumbnailUrl ? (
            <img src={exercise.thumbnailUrl} alt={exercise.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-5xl">⚡</div>
          )}
        </div>

        <h2 className="text-2xl font-black text-[#CCFF00]">{exercise.name}</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase">
          <span className="rounded-full border px-2 py-1" style={{ background: levelStyle.bg, borderColor: levelStyle.border, color: levelStyle.text }}>
            {exercise.level}
          </span>
          <span className="rounded-full border border-white/20 px-2 py-1 text-white/75">{exercise.category}</span>
          <span className="rounded-full border border-white/20 px-2 py-1 text-white/75">{exercise.equipment || 'bodyweight'}</span>
        </div>

        <div className="mt-4 text-sm text-white/80">
          <p><span className="font-black text-white">Primary:</span> {primary.join(', ') || 'General'}</p>
          <p className="mt-1"><span className="font-black text-white">Secondary:</span> {secondary.join(', ') || 'None'}</p>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Instructions</p>
          <ol className="mt-2 space-y-1 text-sm text-white/75">
            {instructions.length
              ? instructions.map((step, idx) => <li key={`${exercise.id}-step-${idx}`}>{idx + 1}. {step}</li>)
              : <li>1. Focus on controlled tempo and full range of motion.</li>}
          </ol>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Suggested Protocol</p>
          <p className="mt-2 text-sm font-bold text-white/85">{protocol}</p>
        </div>

        <button
          type="button"
          onClick={onAskCoach}
          className="mt-4 w-full rounded-2xl border border-[#CCFF00]/40 bg-[#CCFF00]/10 py-3 text-sm font-black text-[#CCFF00]"
        >
          Ask Coach
        </button>
      </div>
    </div>
  );
}
