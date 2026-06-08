import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchAllExercises } from '../services/exerciseDBService';

const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

const CATEGORIES = [
  { label: 'Chest', color: '#CCFF00', svg: '<path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8M4 12c0 2 .8 3.8 2 5.1M20 12c0 2-.8 3.8-2 5.1M8 17.5C9.2 18.4 10.5 19 12 19s2.8-.6 4-1.5"/><circle cx="12" cy="12" r="3"/>', muscles: ['chest'] },
  { label: 'Back', color: '#5088FF', svg: '<path d="M12 2v20M4 6l4 2M20 6l-4 2M4 18l4-2M20 18l-4-2M4 12h4M20 12h-4"/>', muscles: ['lats', 'middle back', 'lower back', 'traps'] },
  { label: 'Shoulders', color: '#FF6B35', svg: '<path d="M12 5a3 3 0 100 6 3 3 0 000-6z"/><path d="M4 19c0-4 3.6-7 8-7s8 3 8 7"/><path d="M2 12c2-3 5-5 10-5s8 2 10 5"/>', muscles: ['shoulders', 'neck'] },
  { label: 'Arms', color: '#CCFF00', svg: '<path d="M6 12c0-3.3 2.7-6 6-6V4l4 3-4 3V8c-2.2 0-4 1.8-4 4"/><path d="M18 12c0 3.3-2.7 6-6 6v2l-4-3 4-3v2c2.2 0 4-1.8 4-4"/>', muscles: ['biceps', 'triceps', 'forearms'] },
  { label: 'Legs', color: '#5088FF', svg: '<path d="M12 3v10M8 8l4-5 4 5M8 21l4-8 4 8M10 21h4"/>', filterType: 'legs' },
  { label: 'Core', color: '#FF6B35', svg: '<path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>', muscles: ['abdominals', 'obliques'] },
  { label: 'Cardio', color: '#CCFF00', svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', muscles: null, filterByCategory: 'cardio' },
  { label: 'Warm-Up', color: '#FFA53C', svg: '<path d="M12 2a5 5 0 015 5c0 5-5 11-5 11S7 12 7 7a5 5 0 015-5z"/><circle cx="12" cy="7" r="2"/>', filterType: 'warm-up' },
  { label: 'Cool-Down', color: '#88CCFF', svg: '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>', filterType: 'cool-down' },
  { label: 'All', color: '#CCFF00', svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', muscles: null },
];

function isWarmUpExercise(exercise) {
  if (exercise.category !== 'stretching') return false;
  const equipment = String(exercise.equipment || '').toLowerCase();
  return equipment.includes('body only') || equipment.includes('band');
}

function isCoolDownExercise(exercise) {
  return exercise.category === 'stretching' && exercise.level === 'beginner';
}

const LEG_MUSCLES = ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'];

function isLegsExercise(exercise) {
  return exercise.category === 'strength'
    && (exercise.primaryMuscles || []).some(m => LEG_MUSCLES.includes(m));
}

function formatMusclesLabel(muscles, max = 2) {
  const list = Array.isArray(muscles) ? muscles.filter(Boolean) : [];
  if (!list.length) return 'general';
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} +${list.length - max}`;
}

const LEVEL_FILTERS = ['all', 'beginner', 'intermediate', 'expert'];
const EQUIPMENT_FILTERS = ['all', 'barbell', 'dumbbell', 'bodyweight', 'machine', 'kettlebell'];
const LEVEL_STYLES = {
  beginner: { bg: 'rgba(204,255,0,0.15)', border: 'rgba(204,255,0,0.35)', text: '#CCFF00' },
  intermediate: { bg: 'rgba(255,165,60,0.15)', border: 'rgba(255,165,60,0.35)', text: '#FFA53C' },
  expert: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
};

let exercisesCache = null;

function getThumbnailUrl(exercise) {
  if (!exercise?.images?.[0]) return null;
  return `${IMAGE_BASE}${exercise.images[0]}`;
}

function findCategoryByKey(key) {
  if (!key) return null;
  const normalized = key.toLowerCase();
  return CATEGORIES.find(category => category.label.toLowerCase() === normalized) || null;
}

function matchesCategory(exercise, category) {
  if (!category || category.label === 'All') return true;
  if (category.filterType === 'warm-up') return isWarmUpExercise(exercise);
  if (category.filterType === 'cool-down') return isCoolDownExercise(exercise);
  if (category.filterType === 'legs') return isLegsExercise(exercise);
  if (category.filterByCategory) return exercise.category === category.filterByCategory;
  if (category.muscles) {
    const primary = exercise.primaryMuscles || [];
    return primary.some(m => category.muscles.includes(m));
  }
  return true;
}

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
  const activeCategory = findCategoryByKey(categoryParam);

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
    CATEGORIES.forEach(category => {
      if (category.label === 'All') {
        counts.all = allExercises.length;
        return;
      }
      const key = category.label.toLowerCase();
      counts[key] = allExercises.filter(ex => matchesCategory(ex, category)).length;
    });
    return counts;
  }, [allExercises]);

  const categoryExercises = useMemo(() => {
    if (!activeCategory) return allExercises;
    return allExercises.filter(ex => matchesCategory(ex, activeCategory));
  }, [allExercises, activeCategory]);

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

  const showingList = Boolean(activeCategory) || query.trim().length > 0;

  function openCategory(category) {
    if (!category || category.label === 'All') {
      setSearchParams({});
      return;
    }
    setSearchParams({ category: category.label.toLowerCase() });
  }

  function clearCategory() {
    setSearchParams({});
    setLevelFilter('all');
    setEquipmentFilter('all');
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
      <header className="mb-5">
        <button type="button" onClick={() => navigate(-1)} className="mb-3" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
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
          {CATEGORIES.map(category => {
            const key = category.label.toLowerCase();
            const count = category.label === 'All'
              ? allExercises.length
              : (categoryCounts[key] || 0);
            return (
              <button
                key={category.label}
                type="button"
                onClick={() => openCategory(category.label === 'All' ? null : category)}
                className="rounded-3xl border border-white/10 bg-[#141416] p-4 text-left transition-all duration-200 active:scale-[0.98] hover:border-[#CCFF00]/40"
              >
                <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: `${category.color}18`, border: `1px solid ${category.color}33` }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={category.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: category.svg }} />
                </div>
                <p className="mt-3 text-lg font-black">{category.label}</p>
                <p className="text-xs text-white/50">{count} exercises</p>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && showingList && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <button type="button" onClick={clearCategory} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <p className="text-xs text-white/50 capitalize">
              {(activeCategory?.label || 'all exercises')} · {filteredExercises.length} exercises
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
              const primaryMuscles = formatMusclesLabel(item.primaryMuscles);
              const thumbnailUrl = getThumbnailUrl(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedExercise(item)}
                  className="w-full min-h-[80px] rounded-3xl border border-white/10 bg-[#141416] p-3 text-left"
                >
                  <div className="flex gap-3 items-center">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-black/30">
                      {thumbnailUrl ? (
                        <img
                          src={thumbnailUrl}
                          alt={item.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl">⚡</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 py-0.5">
                      <p className="text-[15px] font-black text-white line-clamp-2 leading-snug">{item.name}</p>
                      <p className="mt-1 text-[9px] capitalize text-white/45 overflow-hidden text-ellipsis whitespace-nowrap">
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
  const primary = exercise.primaryMuscles || [];
  const secondary = exercise.secondaryMuscles || [];
  const instructions = Array.isArray(exercise.instructions) ? exercise.instructions : [];
  const levelStyle = LEVEL_STYLES[exercise.level] || LEVEL_STYLES.intermediate;
  const thumbnailUrl = getThumbnailUrl(exercise);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60">
      <button type="button" onClick={onClose} className="absolute inset-0" aria-label="Close modal" />
      <div className="relative w-full rounded-t-3xl border border-white/10 bg-[#111113] p-4 pb-8 text-white">
        <button type="button" onClick={onClose} className="mb-3 text-xs font-black text-white/60">Close</button>

        <div className="mb-4 h-44 overflow-hidden rounded-2xl bg-black/30">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={exercise.name} className="h-full w-full object-cover" />
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
