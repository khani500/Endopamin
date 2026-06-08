import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getExerciseById, getExercisesBySetting } from '../data/coachExerciseLibrary';
import { clearExerciseCache, fetchAllExercises } from '../services/exerciseDBService';

const GYM_CATEGORIES = [
  { label: 'Chest', svg: '<path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8M4 12c0 2 .8 3.8 2 5.1M20 12c0 2-.8 3.8-2 5.1M8 17.5C9.2 18.4 10.5 19 12 19s2.8-.6 4-1.5"/><circle cx="12" cy="12" r="3"/>', color: '#CCFF00', muscles: ['chest'] },
  { label: 'Back', svg: '<path d="M12 2v20M4 6l4 2M20 6l-4 2M4 18l4-2M20 18l-4-2M4 12h4M20 12h-4"/>', color: '#5088FF', muscles: ['lats', 'middle back', 'lower back', 'traps'] },
  { label: 'Shoulders', svg: '<path d="M12 5a3 3 0 100 6 3 3 0 000-6z"/><path d="M4 19c0-4 3.6-7 8-7s8 3 8 7"/><path d="M2 12c2-3 5-5 10-5s8 2 10 5"/>', color: '#FF6B35', muscles: ['shoulders', 'neck'] },
  { label: 'Arms', svg: '<path d="M6 12c0-3.3 2.7-6 6-6V4l4 3-4 3V8c-2.2 0-4 1.8-4 4"/><path d="M18 12c0 3.3-2.7 6-6 6v2l-4-3 4-3v2c2.2 0 4-1.8 4-4"/>', color: '#CCFF00', muscles: ['biceps', 'triceps', 'forearms'] },
  { label: 'Legs', svg: '<path d="M12 3v10M8 8l4-5 4 5M8 21l4-8 4 8M10 21h4"/>', color: '#5088FF', filterType: 'legs' },
  { label: 'Core', svg: '<path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>', color: '#FF6B35', muscles: ['abdominals', 'obliques'] },
  { label: 'Cardio', svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', color: '#CCFF00', muscles: null, filterByCategory: 'cardio' },
  { label: 'Warm-Up', svg: '<path d="M12 2a5 5 0 015 5c0 5-5 11-5 11S7 12 7 7a5 5 0 015-5z"/><circle cx="12" cy="7" r="2"/>', color: '#FFA53C', filterType: 'warm-up' },
  { label: 'Cool-Down', svg: '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>', color: '#88CCFF', filterType: 'cool-down' },
  { label: 'All', svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', color: '#CCFF00', muscles: null },
];

const HOME_CATEGORIES = [
  { label: 'Upper Body', svg: '<path d="M12 5a3 3 0 100 6 3 3 0 000-6z"/><path d="M4 19c0-4 3.6-7 8-7s8 3 8 7"/>', color: '#CCFF00', categories: ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'arms'] },
  { label: 'Lower Body', svg: '<path d="M12 3v10M8 8l4-5 4 5M8 21l4-8 4 8M10 21h4"/>', color: '#5088FF', categories: ['squat', 'lunge', 'hinge'] },
  { label: 'Core', svg: '<path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>', color: '#FF6B35', categories: ['core'] },
  { label: 'Mobility', svg: '<circle cx="12" cy="4" r="1.5" fill="currentColor"/><path d="M12 6v6M9 9l3-3 3 3M9 18l3 3 3-3M12 12v6"/><path d="M7 13c0 0 2-2 5-2s5 2 5 2"/>', color: '#CCFF00', categories: ['mobility'] },
  { label: 'Cardio', svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', color: '#FFA53C', categories: ['cardio'] },
  { label: 'All Home', svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', color: '#CCFF00', categories: null },
];

const DESK_CATEGORIES = [
  { label: 'Mobility', svg: '<circle cx="12" cy="4" r="1.5" fill="currentColor"/><path d="M12 6v6M9 9l3-3 3 3M9 18l3 3 3-3M12 12v6"/><path d="M7 13c0 0 2-2 5-2s5 2 5 2"/>', color: '#CCFF00', subcategory: 'mobility' },
  { label: 'Strength', svg: '<path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/>', color: '#5088FF', subcategory: 'strength' },
  { label: 'Cardio', svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', color: '#FFA53C', subcategory: 'cardio' },
  { label: 'Recovery', svg: '<path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M12 6v6l4 2"/>', color: '#88CCFF', subcategory: 'recovery' },
  { label: 'All Desk', svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', color: '#CCFF00', subcategory: null },
];

const LEVEL_COLORS = {
  beginner: { bg: 'rgba(204,255,0,0.15)', border: 'rgba(204,255,0,0.35)', text: '#CCFF00' },
  intermediate: { bg: 'rgba(255,165,60,0.15)', border: 'rgba(255,165,60,0.35)', text: '#FFA53C' },
  advanced: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
  expert: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.35)', text: '#FF6B6B' },
};

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

function getCategoryStyle(exercise) {
  const cat = exercise.category?.toLowerCase() || '';
  const subcat = exercise.subcategory?.toLowerCase() || '';

  if (cat === 'squat' || cat === 'lunge') return {
    bg: 'rgba(80,136,255,0.12)', border: 'rgba(80,136,255,0.25)', color: '#5088FF',
    svg: '<path d="M12 3v10M8 8l4-5 4 5M8 21l4-8 4 8M10 21h4"/>'
  };
  if (cat === 'horizontal_push' || cat === 'vertical_push') return {
    bg: 'rgba(204,255,0,0.12)', border: 'rgba(204,255,0,0.25)', color: '#CCFF00',
    svg: '<path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/>'
  };
  if (cat === 'horizontal_pull' || cat === 'vertical_pull') return {
    bg: 'rgba(160,100,255,0.12)', border: 'rgba(160,100,255,0.25)', color: '#A064FF',
    svg: '<path d="M4 12h16M14 6l6 6-6 6"/><path d="M4 6v12"/>'
  };
  if (cat === 'core') return {
    bg: 'rgba(255,107,53,0.12)', border: 'rgba(255,107,53,0.25)', color: '#FF6B35',
    svg: '<path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>'
  };
  if (cat === 'hinge') return {
    bg: 'rgba(255,165,60,0.12)', border: 'rgba(255,165,60,0.25)', color: '#FFA53C',
    svg: '<path d="M12 5v14M5 12l7-7 7 7"/>'
  };
  if (cat === 'mobility') return {
    bg: 'rgba(136,204,255,0.12)', border: 'rgba(136,204,255,0.25)', color: '#88CCFF',
    svg: '<circle cx="12" cy="4" r="1.5" fill="currentColor"/><path d="M12 6v6M9 9l3-3 3 3M9 18l3 3 3-3M12 12v6"/><path d="M7 13c0 0 2-2 5-2s5 2 5 2"/>'
  };
  if (cat === 'cardio') return {
    bg: 'rgba(204,255,0,0.12)', border: 'rgba(204,255,0,0.25)', color: '#CCFF00',
    svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'
  };
  if (cat === 'arms') return {
    bg: 'rgba(204,255,0,0.12)', border: 'rgba(204,255,0,0.25)', color: '#CCFF00',
    svg: '<path d="M6 12c0-3.3 2.7-6 6-6V4l4 3-4 3V8c-2.2 0-4 1.8-4 4"/><path d="M18 12c0 3.3-2.7 6-6 6v2l-4-3 4-3v2c2.2 0 4-1.8 4-4"/>'
  };
  if (cat === 'stretching') return {
    bg: 'rgba(136,204,255,0.12)', border: 'rgba(136,204,255,0.25)', color: '#88CCFF',
    svg: '<circle cx="12" cy="4" r="1.5" fill="currentColor"/><path d="M12 6v6M9 9l3-3 3 3M9 18l3 3 3-3M12 12v6"/><path d="M7 13c0 0 2-2 5-2s5 2 5 2"/>'
  };
  if (cat === 'desk_break') {
    if (subcat === 'cardio') return {
      bg: 'rgba(204,255,0,0.12)', border: 'rgba(204,255,0,0.25)', color: '#CCFF00',
      svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'
    };
    if (subcat === 'strength') return {
      bg: 'rgba(80,136,255,0.12)', border: 'rgba(80,136,255,0.25)', color: '#5088FF',
      svg: '<path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/>'
    };
    if (subcat === 'mobility' || subcat === 'recovery') return {
      bg: 'rgba(136,204,255,0.12)', border: 'rgba(136,204,255,0.25)', color: '#88CCFF',
      svg: '<circle cx="12" cy="4" r="1.5" fill="currentColor"/><path d="M12 6v6M9 9l3-3 3 3M9 18l3 3 3-3M12 12v6"/><path d="M7 13c0 0 2-2 5-2s5 2 5 2"/>'
    };
    return {
      bg: 'rgba(160,100,255,0.12)', border: 'rgba(160,100,255,0.25)', color: '#A064FF',
      svg: '<path d="M2 6a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM8 20h8M12 18v2"/>'
    };
  }
  return {
    bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)',
    svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'
  };
}

function formatMusclesLabel(muscles, max = 2) {
  const list = Array.isArray(muscles) ? muscles.filter(Boolean) : [];
  if (!list.length) return '';
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} +${list.length - max}`;
}

function ExerciseCard({ exercise, onClick, subtitle, showLevel = true }) {
  const categoryStyle = getCategoryStyle(exercise);
  const levelStyle = LEVEL_COLORS[exercise.level] || LEVEL_COLORS.intermediate;
  const musclesText = subtitle ?? exercise.muscleGroups?.slice(0, 2).join(', ') ?? '';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '80px',
        background: '#1a1a1a',
        borderRadius: '12px',
        padding: '12px',
        marginBottom: '8px',
        width: '100%',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '12px',
          background: categoryStyle.bg,
          border: `1px solid ${categoryStyle.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={categoryStyle.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: categoryStyle.svg }} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div
          style={{
            fontWeight: 'bold',
            color: 'white',
            fontSize: '14px',
            marginBottom: '4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {exercise.name}
        </div>
        <div
          style={{
            fontSize: '11px',
            color: '#888',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {musclesText}
        </div>
        {showLevel && exercise.level && (
          <div style={{ marginTop: '4px' }}>
            <span
              style={{
                fontSize: '9px',
                padding: '4px 8px',
                borderRadius: '999px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                background: levelStyle.bg,
                border: `1px solid ${levelStyle.border}`,
                color: levelStyle.text,
              }}
            >
              {exercise.level}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

function matchesGymCategory(exercise, category) {
  if (!category || category.label === 'All') return true;
  if (category.filterType === 'warm-up') return isWarmUpExercise(exercise);
  if (category.filterType === 'cool-down') return isCoolDownExercise(exercise);
  if (category.filterType === 'legs') return isLegsExercise(exercise);
  if (category.filterByCategory) return exercise.category === category.filterByCategory;
  if (category.muscles) {
    return (exercise.primaryMuscles || []).some(m => category.muscles.includes(m));
  }
  return true;
}

function matchesHomeCategory(exercise, category) {
  if (!category || category.label === 'All Home') return true;
  if (!category.categories) return true;
  return category.categories.includes(exercise.category);
}

function matchesDeskCategory(exercise, category) {
  if (!category || category.label === 'All Desk') return true;
  if (!category.subcategory) return true;
  return exercise.subcategory === category.subcategory;
}

function categoryCountKey(label) {
  return label.toLowerCase().replace(/\s+/g, '-');
}

function CategoryGrid({ categories, counts, allLabel, onSelect, animatedItems }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {categories.map((category, i) => {
        const key = categoryCountKey(category.label);
        const count = category.label === allLabel
          ? counts.all
          : (counts[key] || 0);
        return (
          <button
            key={category.label}
            type="button"
            onClick={() => onSelect(category)}
            className="rounded-3xl border border-white/10 bg-[#141416] p-4 text-left transition-all duration-200 active:scale-[0.98] hover:border-[#CCFF00]/40"
            style={{
              opacity: animatedItems.includes(i) ? 1 : 0,
              transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
              transition: `opacity 0.3s ease ${i * 0.05}s, transform 0.3s ease ${i * 0.05}s`,
            }}
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
  );
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
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('gym');
  const [animatedItems, setAnimatedItems] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);
  const [exerciseError, setExerciseError] = useState(null);
  const [selectedHomeCategory, setSelectedHomeCategory] = useState(null);
  const [selectedHomeExercise, setSelectedHomeExercise] = useState(null);
  const [selectedDeskCategory, setSelectedDeskCategory] = useState(null);
  const [selectedDeskExercise, setSelectedDeskExercise] = useState(null);

  const homeExercises = useMemo(() => getExercisesBySetting('home'), []);
  const deskExercises = useMemo(() => getExercisesBySetting('desk'), []);

  const gymCategoryCounts = useMemo(() => {
    const counts = { all: exercises.length };
    GYM_CATEGORIES.forEach(category => {
      if (category.label === 'All') return;
      counts[categoryCountKey(category.label)] = exercises.filter(ex => matchesGymCategory(ex, category)).length;
    });
    return counts;
  }, [exercises]);

  const homeCategoryCounts = useMemo(() => {
    const counts = { all: homeExercises.length };
    HOME_CATEGORIES.forEach(category => {
      if (category.label === 'All Home') return;
      counts[categoryCountKey(category.label)] = homeExercises.filter(ex => matchesHomeCategory(ex, category)).length;
    });
    return counts;
  }, [homeExercises]);

  const deskCategoryCounts = useMemo(() => {
    const counts = { all: deskExercises.length };
    DESK_CATEGORIES.forEach(category => {
      if (category.label === 'All Desk') return;
      counts[categoryCountKey(category.label)] = deskExercises.filter(ex => matchesDeskCategory(ex, category)).length;
    });
    return counts;
  }, [deskExercises]);

  const filteredHomeExercises = useMemo(() => {
    if (!selectedHomeCategory) return [];
    return homeExercises.filter(ex => matchesHomeCategory(ex, selectedHomeCategory));
  }, [homeExercises, selectedHomeCategory]);

  const filteredDeskExercises = useMemo(() => {
    if (!selectedDeskCategory) return [];
    return deskExercises.filter(ex => matchesDeskCategory(ex, selectedDeskCategory));
  }, [deskExercises, selectedDeskCategory]);

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
    const tab = searchParams.get('tab');
    if (tab === 'home') setActiveTab('home');
    else if (tab === 'desk') setActiveTab('desk');
    else if (tab === 'gym') setActiveTab('gym');
  }, [searchParams]);

  useEffect(() => {
    setAnimatedItems([]);
    let items = [];
    if (activeTab === 'gym') items = GYM_CATEGORIES;
    else if (activeTab === 'home') {
      items = selectedHomeCategory ? filteredHomeExercises : HOME_CATEGORIES;
    } else if (activeTab === 'desk') {
      items = selectedDeskCategory ? filteredDeskExercises : DESK_CATEGORIES;
    }
    items.forEach((_, i) => {
      setTimeout(() => setAnimatedItems(prev => [...prev, i]), i * 50);
    });
  }, [activeTab, filteredHomeExercises, selectedHomeCategory, filteredDeskExercises, selectedDeskCategory]);

  useEffect(() => {
    setSelectedHomeCategory(null);
    setSelectedHomeExercise(null);
    setSelectedDeskCategory(null);
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
        <div className="flex items-center gap-3 mb-1">
          <button type="button" onClick={() => navigate(-1)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="font-['Orbitron',monospace] font-black text-[15px] tracking-[3px]">
            <span className="text-[#CCFF00]">∃</span>NDO <span className="text-white/30 text-[11px]">/ Gym</span>
          </div>
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
            <CategoryGrid
              categories={GYM_CATEGORIES}
              counts={gymCategoryCounts}
              allLabel="All"
              onSelect={openGymCategory}
              animatedItems={animatedItems}
            />
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
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <p className="text-xs text-white/50">
                {selectedHomeCategory.label} · {filteredHomeExercises.length} exercises
              </p>
            </div>
          )}

          {!selectedHomeCategory && (
            <CategoryGrid
              categories={HOME_CATEGORIES}
              counts={homeCategoryCounts}
              allLabel="All Home"
              onSelect={setSelectedHomeCategory}
              animatedItems={animatedItems}
            />
          )}

          {selectedHomeCategory && (
            <div>
              {filteredHomeExercises.map((ex, i) => (
                <ExerciseCard
                  key={ex.id || `home-${i}`}
                  exercise={ex}
                  onClick={() => setSelectedHomeExercise(ex)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'desk' && (
        <div className="px-5 space-y-4">
          {selectedDeskCategory && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setSelectedDeskCategory(null);
                  setSelectedDeskExercise(null);
                }}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                {selectedDeskCategory.label} · {filteredDeskExercises.length} exercises
              </p>
            </div>
          )}

          {!selectedDeskCategory && (
            <CategoryGrid
              categories={DESK_CATEGORIES}
              counts={deskCategoryCounts}
              allLabel="All Desk"
              onSelect={setSelectedDeskCategory}
              animatedItems={animatedItems}
            />
          )}

          {selectedDeskCategory && (
            <div>
              {filteredDeskExercises.map((item, i) => {
                const muscles = item.muscleGroups?.slice(0, 2).join(', ') || '';
                const subtitle = muscles
                  ? `${formatDeskDuration(item)} · ${muscles}`
                  : formatDeskDuration(item);
                return (
                  <ExerciseCard
                    key={item.id || `desk-${i}`}
                    exercise={item}
                    onClick={() => setSelectedDeskExercise(item)}
                    subtitle={subtitle}
                    showLevel={false}
                  />
                );
              })}
            </div>
          )}
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

function BottomSheet({ onClose, children }) {
  return (
    <>
      <button
        type="button"
        aria-label="Close modal overlay"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 49,
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '70vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          zIndex: 50,
          borderRadius: '20px 20px 0 0',
          background: '#111113',
          color: 'white',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, background: '#666' }} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 51,
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            fontSize: 22,
            fontWeight: 'bold',
            cursor: 'pointer',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
        <div style={{ padding: '8px 16px 32px', position: 'relative' }}>
          {children}
        </div>
      </div>
    </>
  );
}

function HomeExerciseModal({ exercise, onClose }) {
  const levelStyle = LEVEL_COLORS[exercise.level] || LEVEL_COLORS.intermediate;
  const regressions = resolveExerciseNames(exercise.regressions);
  const progressions = resolveExerciseNames(exercise.progressions);

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingRight: 40 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 'bold', color: '#CCFF00' }}>{exercise.name}</h2>
        <span
          style={{
            fontSize: 9,
            padding: '4px 8px',
            borderRadius: 999,
            fontWeight: 'bold',
            textTransform: 'uppercase',
            flexShrink: 0,
            background: levelStyle.bg,
            border: `1px solid ${levelStyle.border}`,
            color: levelStyle.text,
          }}
        >
          {exercise.level}
        </span>
      </div>

      <div style={{ marginTop: 16, borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', padding: 12 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#CCFF00' }}>Sets & Reps</p>
        <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 'bold', color: 'rgba(255,255,255,0.85)' }}>
          {exercise.sets} sets × {exercise.reps} · Rest {exercise.rest}
        </p>
      </div>

      <div style={{ marginTop: 16, borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', padding: 12 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#CCFF00' }}>Form Cues</p>
        <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 14, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>
          {(exercise.cues || []).map((cue, idx) => (
            <li key={`${exercise.id}-cue-${idx}`} style={{ marginBottom: 4 }}>{idx + 1}. {cue}</li>
          ))}
        </ol>
      </div>

      {(regressions.length > 0 || progressions.length > 0) && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {regressions.length > 0 && (
            <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', padding: 12 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#CCFF00' }}>Regression</p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
                {regressions.map(name => <li key={name}>↓ {name}</li>)}
              </ul>
            </div>
          )}
          {progressions.length > 0 && (
            <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', padding: 12 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#CCFF00' }}>Progression</p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
                {progressions.map(name => <li key={name}>↑ {name}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function DeskExerciseModal({ exercise, onClose }) {
  return (
    <BottomSheet onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 'bold', color: '#A064FF', paddingRight: 40 }}>{exercise.name}</h2>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'capitalize' }}>
        {formatDeskDuration(exercise)} · {exercise.muscleGroups?.join(', ')}
      </p>

      <div style={{ marginTop: 16, borderRadius: 16, border: '1px solid rgba(160,100,255,0.2)', background: 'rgba(160,100,255,0.06)', padding: 12 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#A064FF' }}>Step-by-step</p>
        <ol style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none', fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
          {(exercise.cues || []).map((cue, idx) => (
            <li key={`${exercise.id}-desk-${idx}`} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 'bold', color: '#A064FF', flexShrink: 0 }}>{idx + 1}.</span>
              <span>{cue}</span>
            </li>
          ))}
        </ol>
      </div>
    </BottomSheet>
  );
}
