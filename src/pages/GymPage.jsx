import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExerciseById, getExercisesBySetting } from '../data/coachExerciseLibrary';
import { clearExerciseCache, fetchAllExercises } from '../services/exerciseDBService';

const GYM_CATEGORIES = [
  { label: 'Chest', emoji: '🏋️', muscles: ['chest'] },
  { label: 'Back', emoji: '🔙', muscles: ['lats', 'middle back', 'lower back', 'traps'] },
  { label: 'Shoulders', emoji: '💪', muscles: ['shoulders', 'neck'] },
  { label: 'Arms', emoji: '💪', muscles: ['biceps', 'triceps', 'forearms'] },
  { label: 'Legs', emoji: '🦵', muscles: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'] },
  { label: 'Core', emoji: '🔥', muscles: ['abdominals', 'obliques'] },
  { label: 'Cardio', emoji: '🏃', muscles: null, filterByCategory: 'cardio' },
  { label: 'Warm-Up', emoji: '🔥', filterType: 'warm-up' },
  { label: 'Cool-Down', emoji: '❄️', filterType: 'cool-down' },
  { label: 'All', emoji: '⚡', muscles: null },
];

const MOBILITY_MUSCLES = [
  'abductors',
  'adductors',
  'shoulders',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'neck',
];

const HOME_CATEGORIES = [
  { label: 'Upper Body', emoji: '💪', muscles: ['chest', 'shoulders', 'triceps', 'biceps'] },
  { label: 'Lower Body', emoji: '🦵', muscles: ['quads', 'glutes', 'hamstrings', 'calves'] },
  { label: 'Core', emoji: '🔥', muscles: ['core', 'abdominals', 'obliques'] },
  { label: 'Stretch & Recover', emoji: '🧘', category: 'mobility' },
  { label: 'Cardio', emoji: '🏃', category: 'cardio' },
  { label: 'All Home', emoji: '⚡', muscles: null },
];

const DESK_SUBCATEGORIES = [
  { label: 'Mobility', key: 'mobility' },
  { label: 'Strength', key: 'strength' },
  { label: 'Cardio', key: 'cardio' },
  { label: 'Recovery', key: 'recovery' },
];

const LEVEL_COLORS = {
  beginner: { bg: 'rgba(204,255,0,0.15)', border: 'rgba(204,255,0,0.35)', text: '#CCFF00' },
  intermediate: { bg: 'rgba(255,165,60,0.15)', border: 'rgba(255,165,60,0.35)', text: '#FFA53C' },
  advanced: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
  expert: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
};

function muscleTermMatches(group, target) {
  const g = String(group).toLowerCase().replace(/_/g, ' ');
  const t = String(target).toLowerCase();
  return g.includes(t) || t.includes(g);
}

function isWarmUpExercise(exercise) {
  if (exercise.category === 'stretching') return true;
  return (exercise.primaryMuscles || []).some(m => MOBILITY_MUSCLES.includes(m));
}

function isCoolDownExercise(exercise) {
  return exercise.category === 'stretching';
}

function matchesGymCategory(exercise, category) {
  if (!category || category.label === 'All') return true;
  if (category.filterType === 'warm-up') return isWarmUpExercise(exercise);
  if (category.filterType === 'cool-down') return isCoolDownExercise(exercise);
  if (category.filterByCategory) return exercise.category === category.filterByCategory;
  if (category.muscles) {
    return (exercise.primaryMuscles || []).some(m => category.muscles.includes(m));
  }
  return true;
}

function matchesHomeCategory(exercise, category) {
  if (!category || category.label === 'All Home') return true;
  if (category.category) return exercise.category === category.category;
  if (category.muscles) {
    const groups = exercise.muscleGroups || [];
    return category.muscles.some(m => groups.some(g => muscleTermMatches(g, m)));
  }
  return true;
}

function formatDeskDuration(exercise) {
  const reps = String(exercise.reps || '');
  if (/s\b|sec/i.test(reps)) return reps;
  if (exercise.sets && exercise.reps) return `${exercise.sets} × ${exercise.reps}`;
  return '~1 min';
}

function resolveExerciseNames(ids = []) {
  return ids
    .map(id => getExerciseById(id)?.name || id)
    .filter(Boolean);
}

export default function GymPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('gym');
  const [animatedItems, setAnimatedItems] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);
  const [exerciseError, setExerciseError] = useState(null);
  const [selectedHomeCategory, setSelectedHomeCategory] = useState(null);
  const [selectedHomeExercise, setSelectedHomeExercise] = useState(null);
  const [selectedDeskExercise, setSelectedDeskExercise] = useState(null);

  const homeExercises = useMemo(() => getExercisesBySetting('home'), []);
  const deskExercises = useMemo(() => getExercisesBySetting('desk'), []);

  const gymCategoryCounts = useMemo(() => {
    const counts = {};
    GYM_CATEGORIES.forEach(category => {
      if (category.label === 'All') {
        counts.all = exercises.length;
        return;
      }
      const key = category.label.toLowerCase();
      counts[key] = exercises.filter(ex => matchesGymCategory(ex, category)).length;
    });
    return counts;
  }, [exercises]);

  const homeCategoryCounts = useMemo(() => {
    const counts = {};
    HOME_CATEGORIES.forEach(category => {
      if (category.label === 'All Home') {
        counts.all = homeExercises.length;
        return;
      }
      const key = category.label.toLowerCase().replace(/\s+/g, '-');
      counts[key] = homeExercises.filter(ex => matchesHomeCategory(ex, category)).length;
    });
    return counts;
  }, [homeExercises]);

  const filteredHomeExercises = useMemo(() => {
    if (!selectedHomeCategory) return [];
    return homeExercises.filter(ex => matchesHomeCategory(ex, selectedHomeCategory));
  }, [homeExercises, selectedHomeCategory]);

  const deskBySubcategory = useMemo(() => {
    const grouped = Object.fromEntries(DESK_SUBCATEGORIES.map(s => [s.key, []]));
    deskExercises.forEach(ex => {
      const key = ex.subcategory || 'mobility';
      if (grouped[key]) grouped[key].push(ex);
    });
    return grouped;
  }, [deskExercises]);

  const loadExercises = useCallback(async () => {
    setIsLoadingExercises(true);
    setExerciseError(null);
    const allExercises = await fetchAllExercises(1300);
    if (!allExercises.length) {
      setExercises([]);
      setExerciseError('Could not load exercises. Check your connection and try again.');
    } else {
      setExercises(allExercises);
    }
    setIsLoadingExercises(false);
  }, []);

  useEffect(() => {
    void loadExercises();
  }, [loadExercises]);

  useEffect(() => {
    setAnimatedItems([]);
    let items = [];
    if (activeTab === 'gym') items = GYM_CATEGORIES;
    else if (activeTab === 'home') {
      items = selectedHomeCategory ? filteredHomeExercises : HOME_CATEGORIES;
    } else {
      items = deskExercises;
    }
    items.forEach((_, i) => {
      setTimeout(() => setAnimatedItems(prev => [...prev, i]), i * 50);
    });
  }, [activeTab, filteredHomeExercises, selectedHomeCategory, deskExercises]);

  useEffect(() => {
    setSelectedHomeCategory(null);
    setSelectedHomeExercise(null);
    setSelectedDeskExercise(null);
  }, [activeTab]);

  function handleRetry() {
    clearExerciseCache();
    void loadExercises();
  }

  function openGymCategory(category) {
    if (!category || category.label === 'All') {
      navigate('/exercises');
      return;
    }
    navigate(`/exercises?category=${encodeURIComponent(category.label.toLowerCase())}`);
  }

  function switchTab(tabId) {
    setActiveTab(tabId);
  }

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-24 overflow-x-hidden">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-[#CCFF00] opacity-[0.03] blur-3xl" />

      <div className="px-5 pt-14 pb-4">
        <div className="font-['Orbitron',monospace] font-black text-[15px] tracking-[3px] mb-1">
          <span className="text-[#CCFF00]">∃</span>NDO <span className="text-white/30 text-[11px]">/ Gym</span>
        </div>
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Exercise Library</h1>
          <p className="text-[12px] text-white/35 mt-0.5 italic">Pick a category to explore movements</p>
        </div>
      </div>

      <div className="px-5 mb-4">
        <div className="flex gap-2 p-1 rounded-[16px] bg-white/[0.04] border border-white/[0.06]">
          {[
            { id: 'gym', label: '🏋️ Gym', count: exercises.length },
            { id: 'home', label: '🏠 Home', count: homeExercises.length },
            { id: 'desk', label: '💻 Desk', count: deskExercises.length },
          ].map(tab => (
            <button key={tab.id} type="button" onClick={() => switchTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[12px] transition-all font-bold text-[11px]"
              style={{
                background: activeTab === tab.id ? 'rgba(204,255,0,0.12)' : 'transparent',
                border: `1px solid ${activeTab === tab.id ? 'rgba(204,255,0,0.3)' : 'transparent'}`,
                color: activeTab === tab.id ? '#CCFF00' : 'rgba(255,255,255,0.35)',
              }}>
              {tab.label}
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black"
                style={{
                  background: activeTab === tab.id ? 'rgba(204,255,0,0.2)' : 'rgba(255,255,255,0.08)',
                  color: activeTab === tab.id ? '#CCFF00' : 'rgba(255,255,255,0.4)',
                }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'gym' && (
        <div className="px-5 space-y-4">
          {isLoadingExercises && (
            <p className="text-[12px] text-[#CCFF00] font-bold">Loading exercises...</p>
          )}

          {!isLoadingExercises && exerciseError && (
            <div className="rounded-[20px] border border-[#FF6B6B]/30 p-6 text-center"
              style={{ background: 'rgba(255,107,107,0.06)' }}>
              <p className="text-[14px] font-bold text-white mb-1">Failed to load exercises</p>
              <p className="text-[12px] text-white/45 mb-4">{exerciseError}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-[14px] px-5 py-2.5 text-[12px] font-black text-black"
                style={{ background: '#CCFF00' }}
              >
                Retry
              </button>
            </div>
          )}

          {!isLoadingExercises && !exerciseError && (
            <div className="grid grid-cols-2 gap-3">
              {GYM_CATEGORIES.map((category, i) => {
                const key = category.label.toLowerCase();
                const count = category.label === 'All'
                  ? exercises.length
                  : (gymCategoryCounts[key] || 0);
                return (
                  <button
                    key={category.label}
                    type="button"
                    onClick={() => openGymCategory(category)}
                    className="rounded-3xl border border-white/10 bg-[#141416] p-4 text-left transition-all duration-200 active:scale-[0.98] hover:border-[#CCFF00]/40"
                    style={{
                      opacity: animatedItems.includes(i) ? 1 : 0,
                      transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                      transition: `opacity 0.3s ease ${i * 0.05}s, transform 0.3s ease ${i * 0.05}s`,
                    }}
                  >
                    <div className="text-3xl">{category.emoji}</div>
                    <p className="mt-3 text-lg font-black">{category.label}</p>
                    <p className="text-xs text-white/50">{count} exercises</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'home' && (
        <div className="px-5 space-y-4">
          {selectedHomeCategory && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setSelectedHomeCategory(null);
                  setSelectedHomeExercise(null);
                }}
                className="text-sm font-black text-[#CCFF00]"
              >
                ← Back
              </button>
              <p className="text-xs text-white/50">
                {selectedHomeCategory.label} · {filteredHomeExercises.length} exercises
              </p>
            </div>
          )}

          {!selectedHomeCategory && (
            <div className="grid grid-cols-2 gap-3">
              {HOME_CATEGORIES.map((category, i) => {
                const key = category.label.toLowerCase().replace(/\s+/g, '-');
                const count = category.label === 'All Home'
                  ? homeExercises.length
                  : (homeCategoryCounts[key] || 0);
                return (
                  <button
                    key={category.label}
                    type="button"
                    onClick={() => setSelectedHomeCategory(category)}
                    className="rounded-3xl border border-white/10 bg-[#141416] p-4 text-left transition-all duration-200 active:scale-[0.98] hover:border-[#CCFF00]/40"
                    style={{
                      opacity: animatedItems.includes(i) ? 1 : 0,
                      transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                      transition: `opacity 0.3s ease ${i * 0.05}s, transform 0.3s ease ${i * 0.05}s`,
                    }}
                  >
                    <div className="text-3xl">{category.emoji}</div>
                    <p className="mt-3 text-lg font-black">{category.label}</p>
                    <p className="text-xs text-white/50">{count} exercises</p>
                  </button>
                );
              })}
            </div>
          )}

          {selectedHomeCategory && (
            <div className="space-y-2">
              {filteredHomeExercises.map((ex, i) => {
                const levelStyle = LEVEL_COLORS[ex.level] || LEVEL_COLORS.intermediate;
                return (
                  <button
                    key={ex.id || `home-${i}`}
                    type="button"
                    onClick={() => setSelectedHomeExercise(ex)}
                    className="w-full rounded-[18px] border p-4 flex items-center justify-between transition-all duration-200 text-left active:scale-[0.99]"
                    style={{
                      background: 'rgba(255,255,255,0.025)',
                      borderColor: 'rgba(255,255,255,0.07)',
                      opacity: animatedItems.includes(i) ? 1 : 0,
                      transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                      transition: `opacity 0.3s ease ${i * 0.03}s, transform 0.3s ease ${i * 0.03}s`,
                    }}
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-white truncate">{ex.name}</p>
                      <p className="text-[10px] text-white/35 mt-0.5 capitalize truncate">
                        {ex.muscleGroups?.join(', ')}
                        {ex.equipment?.length ? ` · ${ex.equipment.join(', ')}` : ''}
                      </p>
                    </div>
                    <span
                      className="text-[9px] px-2 py-1 rounded-full font-bold uppercase shrink-0 ml-2"
                      style={{
                        background: levelStyle.bg,
                        border: `1px solid ${levelStyle.border}`,
                        color: levelStyle.text,
                      }}
                    >
                      {ex.level}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'desk' && (
        <div className="px-5 space-y-4">
          <p className="text-[12px] font-black text-[#A064FF]">💻 Quick Desk Breaks</p>

          {DESK_SUBCATEGORIES.map(sub => {
            const items = deskBySubcategory[sub.key] || [];
            if (!items.length) return null;
            return (
              <section key={sub.key}>
                <p className="text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold mb-2">
                  {sub.label}
                </p>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <button
                      key={item.id || `${sub.key}-${i}`}
                      type="button"
                      onClick={() => setSelectedDeskExercise(item)}
                      className="w-full rounded-[14px] border px-3 py-2.5 flex items-center justify-between transition-all duration-200 text-left active:scale-[0.99]"
                      style={{
                        background: 'rgba(255,255,255,0.025)',
                        borderColor: 'rgba(160,100,255,0.2)',
                      }}
                    >
                      <div className="min-w-0 text-left">
                        <p className="text-[12px] font-bold text-white truncate">{item.name}</p>
                        <p className="text-[10px] text-white/35 mt-0.5 truncate">
                          {formatDeskDuration(item)} · {item.muscleGroups?.join(', ')}
                        </p>
                      </div>
                      <span className="text-[9px] font-black text-[#A064FF] bg-[#A064FF]/10 px-2 py-1 rounded-full border border-[#A064FF]/20 shrink-0 ml-2">
                        {item.level}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selectedHomeExercise && (
        <HomeExerciseModal
          exercise={selectedHomeExercise}
          onClose={() => setSelectedHomeExercise(null)}
        />
      )}

      {selectedDeskExercise && (
        <DeskExerciseModal
          exercise={selectedDeskExercise}
          onClose={() => setSelectedDeskExercise(null)}
        />
      )}
    </main>
  );
}

function HomeExerciseModal({ exercise, onClose }) {
  const levelStyle = LEVEL_COLORS[exercise.level] || LEVEL_COLORS.intermediate;
  const regressions = resolveExerciseNames(exercise.regressions);
  const progressions = resolveExerciseNames(exercise.progressions);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60">
      <button type="button" onClick={onClose} className="absolute inset-0" aria-label="Close modal" />
      <div className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#111113] p-4 pb-8 text-white">
        <button type="button" onClick={onClose} className="mb-3 text-xs font-black text-white/60">Close</button>

        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-black text-[#CCFF00]">{exercise.name}</h2>
          <span
            className="text-[9px] px-2 py-1 rounded-full font-bold uppercase shrink-0"
            style={{
              background: levelStyle.bg,
              border: `1px solid ${levelStyle.border}`,
              color: levelStyle.text,
            }}
          >
            {exercise.level}
          </span>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Sets & Reps</p>
          <p className="mt-2 text-sm font-bold text-white/85">
            {exercise.sets} sets × {exercise.reps} · Rest {exercise.rest}
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Form Cues</p>
          <ol className="mt-2 space-y-1 text-sm text-white/75">
            {(exercise.cues || []).map((cue, idx) => (
              <li key={`${exercise.id}-cue-${idx}`}>{idx + 1}. {cue}</li>
            ))}
          </ol>
        </div>

        {(regressions.length > 0 || progressions.length > 0) && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {regressions.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Regression</p>
                <ul className="mt-2 space-y-1 text-sm text-white/70">
                  {regressions.map(name => <li key={name}>↓ {name}</li>)}
                </ul>
              </div>
            )}
            {progressions.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Progression</p>
                <ul className="mt-2 space-y-1 text-sm text-white/70">
                  {progressions.map(name => <li key={name}>↑ {name}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DeskExerciseModal({ exercise, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60">
      <button type="button" onClick={onClose} className="absolute inset-0" aria-label="Close modal" />
      <div className="relative w-full max-h-[70vh] overflow-y-auto rounded-t-3xl border border-[#A064FF]/30 bg-[#111113] p-4 pb-8 text-white">
        <button type="button" onClick={onClose} className="mb-3 text-xs font-black text-white/60">Close</button>

        <h2 className="text-xl font-black text-[#A064FF]">{exercise.name}</h2>
        <p className="mt-1 text-[11px] text-white/45 capitalize">
          {formatDeskDuration(exercise)} · {exercise.muscleGroups?.join(', ')}
        </p>

        <div className="mt-4 rounded-2xl border border-[#A064FF]/20 bg-[#A064FF]/5 p-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#A064FF]">Step-by-step</p>
          <ol className="mt-2 space-y-2 text-sm text-white/80">
            {(exercise.cues || []).map((cue, idx) => (
              <li key={`${exercise.id}-desk-${idx}`} className="flex gap-2">
                <span className="font-black text-[#A064FF]">{idx + 1}.</span>
                <span>{cue}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
