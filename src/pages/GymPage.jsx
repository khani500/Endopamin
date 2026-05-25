import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DeskBreakSession } from '../components/desk/DeskBreakSession';
import { RestDayProtocol } from '../components/gym/RestDayProtocol';
import { DESK_BREAKS } from '../data/deskBreaks';
import { EXERCISES } from '../data/exercises';
import { supabase } from '../lib/supabase';

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

const DIFF_COLOR = { beginner: '#CCFF00', intermediate: '#FFA53C', advanced: '#FF6B6B' };

export default function GymPage() {
  const { user, profile, setProfile } = useAuth();
  const navigate = useNavigate();
  const { breakId } = useParams();
  const [activeDeskBreak, setActiveDeskBreak] = useState(null);
  const [showRestDay, setShowRestDay] = useState(() => new Date().getDay() === 0);
  const [selectedEquipment, setSelectedEquipment] = useState(() => {
    try { return JSON.parse(localStorage.getItem('endopamin_equipment') || '["bodyweight"]'); }
    catch { return ['bodyweight']; }
  });
  const [availableNow, setAvailableNow] = useState(() => {
    try { return JSON.parse(localStorage.getItem('endopamin_available_equipment') || '[]'); }
    catch { return []; }
  });
  const [activeTab, setActiveTab] = useState('exercises');
  const [animatedItems, setAnimatedItems] = useState([]);

  const compatibleExercises = useMemo(
    () => EXERCISES.filter(ex => ex.equipment.every(item => selectedEquipment.includes(item))),
    [selectedEquipment],
  );

  const currentBreakId = breakId || activeDeskBreak;

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
    setAnimatedItems([]);
    const items = activeTab === 'exercises' ? compatibleExercises : DESK_BREAKS;
    items.forEach((_, i) => {
      setTimeout(() => setAnimatedItems(prev => [...prev, i]), i * 50);
    });
  }, [activeTab, compatibleExercises]);

  if (currentBreakId) {
    return <DeskBreakSession breakId={currentBreakId}
      onComplete={() => breakId ? navigate('/gym') : setActiveDeskBreak(null)} />;
  }

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
            { id: 'exercises', label: 'Exercises', count: compatibleExercises.length, icon: <><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/></> },
            { id: 'desk', label: 'Desk Breaks', count: DESK_BREAKS.length, icon: <><rect x="2" y="14" width="20" height="3" rx="1"/><path d="M6 17v3M18 17v3M12 14V9"/><circle cx="12" cy="7" r="2"/></> },
          ].map(tab => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[12px] transition-all font-bold text-[11px]"
              style={{
                background: activeTab === tab.id ? 'rgba(204,255,0,0.12)' : 'transparent',
                border: `1px solid ${activeTab === tab.id ? 'rgba(204,255,0,0.3)' : 'transparent'}`,
                color: activeTab === tab.id ? '#CCFF00' : 'rgba(255,255,255,0.35)',
              }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                {tab.icon}
              </svg>
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

      {/* Exercises Tab */}
      {activeTab === 'exercises' && (
        <div className="px-5 space-y-2">
          {compatibleExercises.length === 0 ? (
            <div className="rounded-[20px] border border-white/[0.07] p-8 text-center"
              style={{ background: 'rgba(255,255,255,0.02)' }}>
              <p className="text-[32px] mb-3">🏋️</p>
              <p className="text-[14px] font-bold text-white mb-1">No exercises match</p>
              <p className="text-[12px] text-white/35">Select equipment above to see matching exercises</p>
            </div>
          ) : (
            compatibleExercises.map((ex, i) => (
              <div key={ex.id || i}
                className="rounded-[18px] border p-4 flex items-center justify-between transition-all duration-200 active:scale-[0.98] cursor-pointer"
                style={{
                  background: 'rgba(255,255,255,0.025)',
                  borderColor: 'rgba(255,255,255,0.07)',
                  opacity: animatedItems.includes(i) ? 1 : 0,
                  transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                  transition: `opacity 0.3s ease ${i * 0.04}s, transform 0.3s ease ${i * 0.04}s`,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}
                onClick={() => navigate(`/exercises/${ex.id}`)}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0 text-[20px]"
                    style={{
                      background: `${DIFF_COLOR[ex.level] || '#CCFF00'}15`,
                      border: `1px solid ${DIFF_COLOR[ex.level] || '#CCFF00'}25`,
                    }}>
                    {ex.category === 'strength' ? '💪' :
                     ex.category === 'cardio' ? '🏃' :
                     ex.category === 'mobility' ? '🧘' : '⚡'}
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-white">{ex.name}</p>
                    <p className="text-[10px] text-white/35 mt-0.5">
                      {ex.muscle_group || ex.category} · {ex.equipment?.join(', ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[9px] px-2 py-1 rounded-full font-bold"
                    style={{
                      background: `${DIFF_COLOR[ex.level] || '#CCFF00'}15`,
                      color: DIFF_COLOR[ex.level] || '#CCFF00',
                      border: `1px solid ${DIFF_COLOR[ex.level] || '#CCFF00'}25`,
                    }}>
                    {ex.level}
                  </span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </div>
            ))
          )}

          {/* Start Workout CTA */}
          {compatibleExercises.length > 0 && (
            <button type="button"
              onClick={() => navigate('/workout/strength')}
              className="w-full py-4 rounded-[18px] font-black text-[14px] text-black mt-3 transition-all active:scale-95"
              style={{ background: '#CCFF00', boxShadow: '0 8px 24px rgba(204,255,0,0.35)' }}>
              Start Workout with {compatibleExercises.length} Exercises
            </button>
          )}
        </div>
      )}

      {/* Desk Breaks Tab */}
      {activeTab === 'desk' && (
        <div className="px-5 space-y-3">
          <div className="rounded-[20px] border border-[#A064FF]/20 p-4 mb-4"
            style={{ background: 'rgba(160,100,255,0.06)' }}>
            <p className="text-[11px] text-[#A064FF] font-bold mb-1">🪑 Office Mode</p>
            <p className="text-[12px] text-white/40">Quick breaks designed for desk workers. No equipment needed.</p>
          </div>
          {DESK_BREAKS.map((item, i) => (
            <button key={item.id} type="button"
              onClick={() => navigate(`/desk-break/${item.id}`)}
              className="w-full rounded-[18px] border p-4 flex items-center justify-between transition-all duration-200 active:scale-[0.98]"
              style={{
                background: 'rgba(255,255,255,0.025)',
                borderColor: 'rgba(160,100,255,0.15)',
                opacity: animatedItems.includes(i) ? 1 : 0,
                transform: animatedItems.includes(i) ? 'translateY(0)' : 'translateY(12px)',
                transition: `opacity 0.3s ease ${i * 0.06}s, transform 0.3s ease ${i * 0.06}s`,
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              }}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-[14px] flex flex-col items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(160,100,255,0.12)', border: '1px solid rgba(160,100,255,0.2)' }}>
                  <span className="text-[18px]">{item.emoji}</span>
                  <span className="text-[9px] font-black text-[#A064FF]">{item.duration}m</span>
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-bold text-white">{item.title}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">{item.exercises?.length || 0} moves</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-[#A064FF] bg-[#A064FF]/10 px-2 py-1 rounded-full border border-[#A064FF]/20">
                  Start
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            </button>
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

  function toggleAvailableNow(id) {
    setAvailableNow(prev => {
      const next = prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id];
      localStorage.setItem('endopamin_available_equipment', JSON.stringify(next));
      return next;
    });
  }
}
