import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExercisesBySetting } from '../data/coachExerciseLibrary';
import { clearExerciseCache, fetchAllExercises } from '../services/exerciseDBService';

const GYM_CATEGORIES = [
  { label: 'Chest', emoji: '🏋️', muscles: ['chest'] },
  { label: 'Back', emoji: '🔙', muscles: ['middle back', 'lower back', 'lats', 'traps'] },
  { label: 'Shoulders', emoji: '💪', muscles: ['shoulders'] },
  { label: 'Arms', emoji: '💪', muscles: ['biceps', 'triceps', 'forearms'] },
  { label: 'Legs', emoji: '🦵', muscles: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'] },
  { label: 'Core', emoji: '🔥', muscles: ['abdominals', 'obliques'] },
  { label: 'Cardio', emoji: '🏃', muscles: null, filterByCategory: 'cardio' },
  { label: 'All', emoji: '⚡', muscles: null },
];

const LEVEL_COLORS = {
  beginner: { bg: 'rgba(204,255,0,0.15)', border: 'rgba(204,255,0,0.35)', text: '#CCFF00' },
  intermediate: { bg: 'rgba(255,165,60,0.15)', border: 'rgba(255,165,60,0.35)', text: '#FFA53C' },
  advanced: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
};

function matchesCategory(exercise, category) {
  if (!category || category.label === 'All') return true;
  if (category.filterByCategory) return exercise.category === category.filterByCategory;
  if (category.muscles) {
    return (exercise.primaryMuscles || []).some(m => category.muscles.includes(m));
  }
  return true;
}

export default function GymPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('gym');
  const [animatedItems, setAnimatedItems] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);
  const [exerciseError, setExerciseError] = useState(null);

  const homeExercises = useMemo(() => getExercisesBySetting('home'), []);
  const deskExercises = useMemo(() => getExercisesBySetting('desk'), []);

  const categoryCounts = useMemo(() => {
    const counts = {};
    GYM_CATEGORIES.forEach(category => {
      if (category.label === 'All') {
        counts.all = exercises.length;
        return;
      }
      const key = category.label.toLowerCase();
      counts[key] = exercises.filter(ex => matchesCategory(ex, category)).length;
    });
    return counts;
  }, [exercises]);

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
    const items = activeTab === 'gym'
      ? GYM_CATEGORIES
      : activeTab === 'home'
        ? homeExercises
        : deskExercises;
    items.forEach((_, i) => {
      setTimeout(() => setAnimatedItems(prev => [...prev, i]), i * 50);
    });
  }, [activeTab, homeExercises, deskExercises]);

  function handleRetry() {
    clearExerciseCache();
    void loadExercises();
  }

  function openCategory(category) {
    if (!category || category.label === 'All') {
      navigate('/exercises');
      return;
    }
    navigate(`/exercises?category=${encodeURIComponent(category.label.toLowerCase())}`);
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
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
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
                  : (categoryCounts[key] || 0);
                return (
                  <button
                    key={category.label}
                    type="button"
                    onClick={() => openCategory(category)}
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
        <div className="px-5 space-y-2">
          {homeExercises.map((ex, i) => {
            const levelStyle = LEVEL_COLORS[ex.level] || LEVEL_COLORS.intermediate;
            return (
              <div
                key={ex.id || `home-${i}`}
                className="rounded-[18px] border p-4 flex items-center justify-between transition-all duration-200"
                style={{
                  background: 'rgba(255,255,255,0.025)',
                  borderColor: 'rgba(255,255,255,0.07)',
                  opacity: animatedItems.includes(i) ? 1 : 0,
                  transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                  transition: `opacity 0.3s ease ${i * 0.03}s, transform 0.3s ease ${i * 0.03}s`,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-white truncate">{ex.name}</p>
                  <p className="text-[10px] text-white/35 mt-0.5 capitalize truncate">
                    {ex.muscleGroups?.join(', ') || ex.category}
                    {ex.equipment?.length ? ` · ${ex.equipment.join(', ')}` : ''}
                  </p>
                </div>
                <span
                  className="text-[9px] px-2 py-1 rounded-full font-bold uppercase"
                  style={{
                    background: levelStyle.bg,
                    border: `1px solid ${levelStyle.border}`,
                    color: levelStyle.text,
                  }}
                >
                  {ex.level}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'desk' && (
        <div className="px-5 space-y-3">
          {deskExercises.map((item, i) => (
            <div
              key={item.id || `desk-${i}`}
              className="w-full rounded-[14px] border px-3 py-2.5 flex items-center justify-between transition-all duration-200"
              style={{
                background: 'rgba(255,255,255,0.025)',
                borderColor: 'rgba(160,100,255,0.2)',
                opacity: animatedItems.includes(i) ? 1 : 0,
                transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                transition: `opacity 0.3s ease ${i * 0.06}s, transform 0.3s ease ${i * 0.06}s`,
                boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
              }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(160,100,255,0.12)', border: '1px solid rgba(160,100,255,0.2)' }}>
                  <span className="text-[14px]">💻</span>
                </div>
                <div className="text-left">
                  <p className="text-[12px] font-bold text-white">{item.name}</p>
                  <p className="text-[10px] text-white/35 mt-0.5 truncate">
                    {item.muscleGroups?.join(', ') || item.category}
                  </p>
                </div>
              </div>
              <span className="text-[9px] font-black text-[#A064FF] bg-[#A064FF]/10 px-2 py-1 rounded-full border border-[#A064FF]/20">
                {item.level}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
