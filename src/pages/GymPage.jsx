import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExercisesBySetting } from '../data/coachExerciseLibrary';
import { fetchWgerExercises } from '../services/wgerService';
import {
  fetchAllExercises,
  fetchBodyPartList,
} from '../services/exerciseDBService';

const BODY_PART_ORDER = [
  'back',
  'cardio',
  'chest',
  'lower arms',
  'lower legs',
  'neck',
  'shoulders',
  'upper arms',
  'upper legs',
  'waist',
];

const GYM_CATEGORY_CARDS = [
  { label: 'Chest', emoji: '🏋️', filter: 'chest' },
  { label: 'Back', emoji: '🔙', filter: 'back' },
  { label: 'Shoulders', emoji: '💪', filter: 'shoulders' },
  { label: 'Arms', emoji: '💪', filter: 'upper arms' },
  { label: 'Legs', emoji: '🦵', filter: 'upper legs' },
  { label: 'Core', emoji: '🔥', filter: 'waist' },
  { label: 'Cardio', emoji: '🏃', filter: 'cardio' },
  { label: 'All', emoji: '⚡', filter: null },
];

const LEVEL_COLORS = {
  beginner: { bg: 'rgba(204,255,0,0.15)', border: 'rgba(204,255,0,0.35)', text: '#CCFF00' },
  intermediate: { bg: 'rgba(255,165,60,0.15)', border: 'rgba(255,165,60,0.35)', text: '#FFA53C' },
  expert: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
  advanced: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
};

function normalizeBodyPart(exercise, isWgerSource = false) {
  if (!exercise) return null;
  if (!isWgerSource) return exercise.bodyPart || null;

  const category = String(exercise.category || '').toLowerCase();
  if (category === 'arms') return 'upper arms';
  if (category === 'legs') return 'upper legs';
  if (category === 'abs') return 'waist';
  if (category === 'chest') return 'chest';
  if (category === 'back') return 'back';
  if (category === 'shoulders') return 'shoulders';
  return null;
}

export default function GymPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('gym');
  const [animatedItems, setAnimatedItems] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);
  const [exerciseError, setExerciseError] = useState(null);
  const [useWgerFallback, setUseWgerFallback] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [bodyParts, setBodyParts] = useState(BODY_PART_ORDER);

  const displayedGrouped = useMemo(() => {
    const source = exercises;
    const grouped = Object.fromEntries(bodyParts.map(part => [part, []]));

    source.forEach(ex => {
      const normalizedBodyPart = normalizeBodyPart(ex, useWgerFallback);
      if (!normalizedBodyPart) return;
      if (!grouped[normalizedBodyPart]) grouped[normalizedBodyPart] = [];
      grouped[normalizedBodyPart].push(ex);
    });

    return grouped;
  }, [exercises, bodyParts, useWgerFallback]);

  const displayedExerciseCount = useMemo(
    () => Object.values(displayedGrouped).reduce((sum, list) => sum + list.length, 0),
    [displayedGrouped],
  );

  const homeExercises = useMemo(() => getExercisesBySetting('home'), []);
  const deskExercises = useMemo(() => getExercisesBySetting('desk'), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoadingExercises(true);
      setExerciseError(null);
      setLoadProgress({ loaded: 0, total: 0 });
      try {
        const [allExercises, allBodyParts] = await Promise.all([
          fetchAllExercises(1300),
          fetchBodyPartList(),
        ]);
        if (cancelled) return;
        setExercises(allExercises);
        setBodyParts(allBodyParts.length ? allBodyParts : BODY_PART_ORDER);
        setUseWgerFallback(false);
        setLoadProgress({ loaded: allExercises.length, total: allExercises.length });
      } catch (err) {
        if (cancelled) return;
        console.warn('ExerciseDB API unavailable, falling back to Wger:', err);
        setExerciseError(err?.message || 'Could not load exercises from ExerciseDB');
        try {
          const fallback = await fetchWgerExercises({ language: 2, limit: 100 });
          if (cancelled) return;
          setExercises(fallback);
          setBodyParts(BODY_PART_ORDER);
          setUseWgerFallback(true);
          setLoadProgress({ loaded: fallback.length, total: fallback.length });
        } catch (fallbackErr) {
          if (cancelled) return;
          setUseWgerFallback(true);
          setExercises([]);
          setExerciseError(fallbackErr?.message || 'Could not load exercises');
        }
      } finally {
        if (!cancelled) setIsLoadingExercises(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setAnimatedItems([]);
    const items = activeTab === 'gym'
      ? bodyParts.flatMap(part => displayedGrouped[part] || [])
      : activeTab === 'home'
        ? homeExercises
        : deskExercises;
    items.forEach((_, i) => {
      setTimeout(() => setAnimatedItems(prev => [...prev, i]), i * 50);
    });
  }, [activeTab, displayedGrouped, bodyParts, homeExercises, deskExercises]);

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-24 overflow-x-hidden">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-[#CCFF00] opacity-[0.03] blur-3xl" />

      {/* Header */}
      <div className="px-5 pt-14 pb-4">
        <div className="font-['Orbitron',monospace] font-black text-[15px] tracking-[3px] mb-1">
          <span className="text-[#CCFF00]">∃</span>NDO <span className="text-white/30 text-[11px]">/ Gym</span>
        </div>
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Exercise Library</h1>
          <p className="text-[12px] text-white/35 mt-0.5 italic">Pick a category to explore movements</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 mb-4">
        <div className="flex gap-2 p-1 rounded-[16px] bg-white/[0.04] border border-white/[0.06]">
          {[
            { id: 'gym', label: '🏋️ Gym', count: displayedExerciseCount },
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

      {/* GYM Tab */}
      {activeTab === 'gym' && (
        <div className="px-5 space-y-4">
          {isLoadingExercises && (
            <p className="text-[10px] text-[#CCFF00] font-bold">
              {loadProgress.total > 0
                ? `Loading exercises... ${loadProgress.loaded}/${loadProgress.total}`
                : 'Loading exercises...'}
            </p>
          )}
          {useWgerFallback && !isLoadingExercises && (
            <p className="text-[10px] text-white/35">Showing Wger fallback — ExerciseDB unavailable</p>
          )}
          {exerciseError && (
            <p className="text-[10px] text-[#FF6B6B]">{exerciseError}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {GYM_CATEGORY_CARDS.map((card, i) => {
              const count = card.filter
                ? (displayedGrouped[card.filter]?.length || 0)
                : displayedExerciseCount;
              return (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => navigate(
                    card.filter
                      ? `/exercises?category=${encodeURIComponent(card.filter)}`
                      : '/exercises',
                  )}
                  className="rounded-3xl border border-white/10 bg-[#141416] p-4 text-left transition-all duration-200 active:scale-[0.98] hover:border-[#CCFF00]/40"
                  style={{
                    opacity: animatedItems.includes(i) ? 1 : 0,
                    transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                    transition: `opacity 0.3s ease ${i * 0.05}s, transform 0.3s ease ${i * 0.05}s`,
                  }}
                >
                  <div className="text-3xl">{card.emoji}</div>
                  <p className="mt-3 text-lg font-black">{card.label}</p>
                  <p className="text-xs text-white/50">{count} exercises</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* HOME Tab */}
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

      {/* DESK Tab */}
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
