import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { RestDayProtocol } from '../components/gym/RestDayProtocol';
import { EXERCISES } from '../data/exercises';
import { getExercisesBySetting } from '../data/coachExerciseLibrary';
import { supabase } from '../lib/supabase';
import { fetchWgerExercises, searchWgerExercises } from '../services/wgerService';
import {
  fetchAllExercises,
  fetchBodyPartList,
  searchExercises,
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

const BODY_PART_LABELS = {
  back: 'Back',
  cardio: 'Cardio',
  chest: 'Chest',
  'lower arms': 'Lower Arms',
  'lower legs': 'Lower Legs',
  neck: 'Neck',
  shoulders: 'Shoulders',
  'upper arms': 'Upper Arms',
  'upper legs': 'Upper Legs',
  waist: 'Waist',
};

const CATEGORY_EMOJI = {
  back: '🧱',
  cardio: '🏃',
  chest: '🏋️',
  'lower arms': '💪',
  'lower legs': '🦵',
  neck: '🧠',
  shoulders: '🤸',
  'upper arms': '💪',
  'upper legs': '🦵',
  waist: '🔥',
};

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

const EQUIPMENT = [
  { id: 'barbell', name: 'Barbell', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="11" width="4" height="2" rx="1"/><rect x="18" y="11" width="4" height="2" rx="1"/><rect x="5" y="9" width="3" height="6" rx="1"/><rect x="16" y="9" width="3" height="6" rx="1"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
  { id: 'dumbbell', name: 'Dumbbell', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="1" y="11" width="3" height="2" rx="0.5"/><rect x="20" y="11" width="3" height="2" rx="0.5"/><rect x="3" y="10" width="2" height="4" rx="0.5"/><rect x="19" y="10" width="2" height="4" rx="0.5"/><line x1="5" y1="12" x2="19" y2="12"/></svg> },
  { id: 'cables', name: 'Cables', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M4 4v16M20 4v16"/><path d="M4 8h16M4 16h16"/><circle cx="12" cy="12" r="2"/></svg> },
  { id: 'smith', name: 'Smith', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="2" width="3" height="20" rx="1"/><rect x="19" y="2" width="3" height="20" rx="1"/><path d="M5 12h14"/><rect x="7" y="10" width="10" height="4" rx="1"/></svg> },
  { id: 'bench', name: 'Bench', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="2" y="9" width="20" height="4" rx="2"/><path d="M5 13v4M19 13v4"/><path d="M3 9V7a1 1 0 011-1h16a1 1 0 011 1v2"/></svg> },
  { id: 'squat_rack', name: 'Squat Rack', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><rect x="3" y="2" width="3" height="20" rx="1"/><rect x="18" y="2" width="3" height="20" rx="1"/><path d="M6 8h12M6 16h12"/><path d="M8 8v8M16 8v8"/></svg> },
  { id: 'pull_up_bar', name: 'Pull-up', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="2" y1="5" x2="22" y2="5"/><path d="M8 5v5a4 4 0 008 0V5"/><path d="M12 14v6"/></svg> },
  { id: 'resistance_bands', name: 'Bands', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M5 12c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7-7-3.13-7-7z"/><path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4z"/></svg> },
  { id: 'kettlebell', name: 'Kettlebell', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M8 8a4 4 0 018 0"/><path d="M6 8c0 6 2 10 6 12s6-6 6-12"/><path d="M9 8h6"/></svg> },
  { id: 'treadmill', name: 'Treadmill', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M5 20h14"/><path d="M3 14l4-8 4 4 4-6 4 10"/><circle cx="18" cy="6" r="1"/></svg> },
  { id: 'bike', name: 'Bike', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M6 15l4-8h4l2 4"/><path d="M14 7l2 4H6"/></svg> },
  { id: 'bodyweight', name: 'Bodyweight', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="12" cy="4" r="2"/><path d="M12 6v6M9 9l3-3 3 3M9 18l3 3 3-3M12 12v6"/><path d="M6 13c0 0 2-2 6-2s6 2 6 2"/></svg> },
];


export default function GymPage() {
  const { user, profile, setProfile } = useAuth();
  const navigate = useNavigate();
  const [showRestDay, setShowRestDay] = useState(() => new Date().getDay() === 0);
  const [selectedEquipment, setSelectedEquipment] = useState(() => {
    try { return JSON.parse(localStorage.getItem('endopamin_equipment') || '["bodyweight"]'); }
    catch { return ['bodyweight']; }
  });
  const [activeTab, setActiveTab] = useState('gym');
  const [animatedItems, setAnimatedItems] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);
  const [exerciseError, setExerciseError] = useState(null);
  const [useWgerFallback, setUseWgerFallback] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [bodyParts, setBodyParts] = useState(BODY_PART_ORDER);

  const compatibleExercises = useMemo(
    () => EXERCISES.filter(ex => ex.equipment.every(item => selectedEquipment.includes(item))),
    [selectedEquipment],
  );

  const displayedGrouped = useMemo(() => {
    const source = searchResults ?? exercises;
    const grouped = Object.fromEntries(bodyParts.map(part => [part, []]));

    source.forEach(ex => {
      const normalizedBodyPart = normalizeBodyPart(ex, useWgerFallback);
      if (!normalizedBodyPart) return;
      if (!grouped[normalizedBodyPart]) grouped[normalizedBodyPart] = [];
      grouped[normalizedBodyPart].push(ex);
    });

    return grouped;
  }, [searchResults, exercises, bodyParts, useWgerFallback]);

  const displayedExerciseCount = useMemo(
    () => Object.values(displayedGrouped).reduce((sum, list) => sum + list.length, 0),
    [displayedGrouped],
  );

  const homeExercises = useMemo(() => getExercisesBySetting('home'), []);
  const deskExercises = useMemo(() => getExercisesBySetting('desk'), []);

  useEffect(() => {
    if (Array.isArray(profile?.equipment) && profile.equipment.length > 0) {
      const t = window.setTimeout(() => {
        setSelectedEquipment(profile.equipment);
        localStorage.setItem('endopamin_equipment', JSON.stringify(profile.equipment));
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [profile?.equipment]);

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
    const term = searchQuery.trim();
    if (!term) {
      setSearchResults(null);
      setSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const results = useWgerFallback
            ? await searchWgerExercises(term)
            : await searchExercises(term);
          if (!cancelled) {
            setSearchResults(results);
          }
        } catch (err) {
          if (!cancelled) {
            console.warn('Primary search API failed, filtering local library:', err);
            const lower = term.toLowerCase();
            const filtered = compatibleExercises.filter(ex =>
              ex.name.toLowerCase().includes(lower)
              || ex.category?.toLowerCase().includes(lower),
            );
            setSearchResults(filtered.map(ex => ({
              id: ex.id,
              name: ex.name,
              description: ex.coachTip || '',
              category: ex.category === 'core' ? 'abs' : ex.category,
              bodyPart: normalizeBodyPart({ category: ex.category === 'core' ? 'abs' : ex.category }, true),
              muscles: [ex.muscles?.primary, ...(ex.muscles?.secondary || [])].filter(Boolean),
              equipment: ex.equipment || [],
              images: [],
              videos: [],
              mainImage: null,
              gifUrl: null,
              emoji: ex.emoji,
            })));
          }
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, compatibleExercises, useWgerFallback]);

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

  if (showRestDay) {
    return (
      <main className="min-h-screen bg-[#080808] px-5 pb-24 pt-14 text-white">
        <div className="font-['Orbitron',monospace] font-black text-[15px] tracking-[3px] mb-1">
          <span className="text-[#CCFF00]">∃</span>NDO <span className="text-white/30 text-[11px]">/ Gym</span>
        </div>
        <RestDayProtocol />
        <button type="button" onClick={() => setShowRestDay(false)}
          className="mt-4 w-full rounded-[18px] py-3.5 text-[13px] font-black text-white/60 border border-white/[0.08] transition-all active:scale-95"
          style={{ background: 'rgba(255,255,255,0.04)' }}>
          Show Gym Workouts →
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-24 overflow-x-hidden">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-[#CCFF00] opacity-[0.03] blur-3xl" />

      {/* Header */}
      <div className="px-5 pt-14 pb-4">
        <div className="font-['Orbitron',monospace] font-black text-[15px] tracking-[3px] mb-1">
          <span className="text-[#CCFF00]">∃</span>NDO <span className="text-white/30 text-[11px]">/ Gym</span>
        </div>
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">Train Smarter</h1>
            <p className="text-[12px] text-white/35 mt-0.5 italic">Built around your equipment</p>
          </div>
          <Link to="/exercises"
            className="px-3 py-2 rounded-[12px] text-[11px] font-black no-underline border transition-all active:scale-95"
            style={{ background: 'rgba(204,255,0,0.1)', borderColor: 'rgba(204,255,0,0.25)', color: '#CCFF00' }}>
            📚 Library →
          </Link>
        </div>
      </div>

      {/* Equipment Selector */}
      <div className="mx-5 mb-5 rounded-[24px] border border-white/[0.07] p-4"
        style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}>
        <div className="flex justify-between items-center mb-3">
          <p className="text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold">Your Equipment</p>
          <span className="text-[10px] text-[#CCFF00] font-bold">{selectedEquipment.length} selected</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {EQUIPMENT.map(eq => {
            const sel = selectedEquipment.includes(eq.id);
            return (
              <button key={eq.id} type="button"
                onClick={() => void toggleEquipment(eq.id)}
                className="rounded-[14px] p-2.5 flex flex-col items-center gap-1.5 transition-all active:scale-95 border"
                style={{
                  background: sel ? 'rgba(204,255,0,0.12)' : 'rgba(255,255,255,0.03)',
                  borderColor: sel ? 'rgba(204,255,0,0.4)' : 'rgba(255,255,255,0.07)',
                  boxShadow: sel ? '0 0 12px rgba(204,255,0,0.15)' : 'none',
                  color: sel ? '#CCFF00' : 'rgba(255,255,255,0.3)',
                }}>
                {eq.svg}
                <p className="text-[8px] font-bold text-center leading-tight"
                  style={{ color: sel ? '#CCFF00' : 'rgba(255,255,255,0.3)' }}>
                  {eq.name}
                </p>
              </button>
            );
          })}
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
          <div className="rounded-[18px] border border-white/[0.07] p-3"
            style={{ background: 'rgba(255,255,255,0.025)' }}>
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search exercises (ExerciseDB)..."
              className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
            />
            {(searchLoading || isLoadingExercises) && (
              <p className="mt-2 text-[10px] text-[#CCFF00] font-bold">
                {loadProgress.total > 0
                  ? `Loading exercises... ${loadProgress.loaded}/${loadProgress.total}`
                  : 'Loading exercises...'}
              </p>
            )}
            {useWgerFallback && !isLoadingExercises && (
              <p className="mt-2 text-[10px] text-white/35">Showing Wger fallback — ExerciseDB unavailable</p>
            )}
            {exerciseError && (
              <p className="mt-2 text-[10px] text-[#FF6B6B]">{exerciseError}</p>
            )}
          </div>

          {displayedExerciseCount === 0 && !isLoadingExercises && !searchLoading ? (
            <div className="rounded-[20px] border border-white/[0.07] p-8 text-center"
              style={{ background: 'rgba(255,255,255,0.02)' }}>
              <p className="text-[32px] mb-3">🏋️</p>
              <p className="text-[14px] font-bold text-white mb-1">No exercises found</p>
              <p className="text-[12px] text-white/35">
                {searchQuery.trim() ? 'Try a different search term' : 'Select equipment above or check back later'}
              </p>
            </div>
          ) : (
            bodyParts.map(bodyPart => {
              const exercises = displayedGrouped[bodyPart] || [];
              if (!exercises.length) return null;

              let itemIndex = 0;
              bodyParts.slice(0, bodyParts.indexOf(bodyPart)).forEach(part => {
                itemIndex += (displayedGrouped[part] || []).length;
              });

              return (
                <section key={bodyPart}>
                  <p className="text-[10px] tracking-[2.5px] uppercase text-[#CCFF00] font-bold mb-2">
                    {BODY_PART_LABELS[bodyPart] || bodyPart}
                  </p>
                  <div className="space-y-2">
                    {exercises.map((ex, i) => {
                      const animIndex = itemIndex + i;
                      const muscles = Array.isArray(ex.muscles)
                        ? ex.muscles.join(', ')
                        : ex.target || ex.muscle_group || ex.category || ex.bodyPart;
                      const secondaryMuscles = Array.isArray(ex.muscles_secondary)
                        ? ex.muscles_secondary.join(', ')
                        : '';
                      const thumbnailUrl = ex.thumbnailUrl || ex.images?.[0];
                      const hoverImageUrl = ex.hoverImageUrl || ex.images?.[1] || null;
                      const fallbackEmoji = CATEGORY_EMOJI[bodyPart] || '💪';

                      return (
                        <div
                          key={ex.id || `${bodyPart}-${i}`}
                          className="rounded-[18px] border p-4 flex items-center gap-3 transition-all duration-200"
                          style={{
                            background: 'rgba(255,255,255,0.025)',
                            borderColor: 'rgba(255,255,255,0.07)',
                            opacity: animatedItems.includes(animIndex) ? 1 : 0,
                            transform: animatedItems.includes(animIndex) ? 'translateY(0)' : 'translateY(12px)',
                            transition: `opacity 0.3s ease ${animIndex * 0.04}s, transform 0.3s ease ${animIndex * 0.04}s`,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                          }}
                        >
                          <div className="w-14 h-14 rounded-[12px] overflow-hidden flex-shrink-0 flex items-center justify-center"
                            style={{
                              background: 'rgba(204,255,0,0.08)',
                              border: '1px solid rgba(204,255,0,0.15)',
                            }}>
                            {thumbnailUrl ? (
                              <div className="relative w-full h-full group">
                                <img
                                  src={thumbnailUrl}
                                  alt={ex.name}
                                  className="w-full h-full object-cover transition-opacity duration-200 group-hover:opacity-0"
                                  loading="lazy"
                                />
                                {hoverImageUrl && (
                                  <img
                                    src={hoverImageUrl}
                                    alt={`${ex.name} alternate`}
                                    className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                                    loading="lazy"
                                  />
                                )}
                              </div>
                            ) : (
                              <span className="text-[22px]">{ex.emoji || fallbackEmoji}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-bold text-white truncate">{ex.name}</p>
                            <p className="text-[10px] text-white/35 mt-0.5 capitalize truncate">
                              {muscles || bodyPart}
                              {secondaryMuscles ? ` · ${secondaryMuscles}` : ''}
                              {Array.isArray(ex.equipment)
                                ? (ex.equipment.length ? ` · ${ex.equipment.join(', ')}` : '')
                                : (ex.equipment ? ` · ${ex.equipment}` : '')}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}

          {displayedExerciseCount > 0 && (
            <button type="button"
              onClick={() => navigate('/workout/strength')}
              className="w-full py-4 rounded-[18px] font-black text-[14px] text-black mt-3 transition-all active:scale-95"
              style={{ background: '#CCFF00', boxShadow: '0 8px 24px rgba(204,255,0,0.35)' }}>
              Start Workout with {displayedExerciseCount} Exercises
            </button>
          )}
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

      {/* Rest Day toggle */}
      <div className="px-5 mt-5">
        <button type="button" onClick={() => setShowRestDay(true)}
          className="w-full py-3 rounded-[16px] text-[12px] font-bold text-white/30 border border-white/[0.06] transition-all active:scale-95"
          style={{ background: 'rgba(255,255,255,0.02)' }}>
          Today is a rest day →
        </button>
      </div>

    </main>
  );

  async function toggleEquipment(id) {
    const next = selectedEquipment.includes(id)
      ? selectedEquipment.filter(e => e !== id)
      : [...selectedEquipment, id];
    setSelectedEquipment(next);
    localStorage.setItem('endopamin_equipment', JSON.stringify(next));
    setProfile(prev => ({ ...prev, equipment: next }));
    if (supabase && user?.id) {
      await supabase.from('profiles').update({ equipment: next }).eq('id', user.id);
    }
  }
}
