import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DeskBreakSession } from '../components/desk/DeskBreakSession';
import { RestDayProtocol } from '../components/gym/RestDayProtocol';
import { DESK_BREAKS } from '../data/deskBreaks';
import { EXERCISES } from '../data/exercises';
import { supabase } from '../lib/supabase';

const EQUIPMENT_LIST = [
  { id: 'barbell', name: 'Barbell', emoji: '🏋️' },
  { id: 'dumbbell', name: 'Dumbbells', emoji: '💪' },
  { id: 'cables', name: 'Cable Machine', emoji: '🔗' },
  { id: 'smith', name: 'Smith Machine', emoji: '🏗️' },
  { id: 'bench', name: 'Bench', emoji: '🛋️' },
  { id: 'squat_rack', name: 'Squat Rack', emoji: '🔩' },
  { id: 'pull_up_bar', name: 'Pull-up Bar', emoji: '⬆️' },
  { id: 'resistance_bands', name: 'Resistance Bands', emoji: '🎯' },
  { id: 'kettlebell', name: 'Kettlebell', emoji: '🔔' },
  { id: 'treadmill', name: 'Treadmill', emoji: '🏃' },
  { id: 'bike', name: 'Stationary Bike', emoji: '🚴' },
  { id: 'rowing', name: 'Rowing Machine', emoji: '🚣' },
  { id: 'bodyweight', name: 'Bodyweight Only', emoji: '🧍' },
];

export default function GymPage() {
  const { user, profile, setProfile } = useAuth();
  const navigate = useNavigate();
  const { breakId } = useParams();
  const [activeDeskBreak, setActiveDeskBreak] = useState(null);
  const [showRestDay, setShowRestDay] = useState(() => new Date().getDay() === 0);
  const [availableNow, setAvailableNow] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('endopamin_available_equipment') || '[]');
    } catch {
      return [];
    }
  });
  const selectedEquipment = useMemo(
    () => (Array.isArray(profile?.equipment) ? profile.equipment : ['bodyweight']),
    [profile],
  );
  const compatibleExercises = useMemo(
    () => EXERCISES.filter(exercise => exercise.equipment.every(item => selectedEquipment.includes(item))),
    [selectedEquipment],
  );
  const currentBreakId = breakId || activeDeskBreak;

  if (currentBreakId) {
    return <DeskBreakSession breakId={currentBreakId} onComplete={() => (breakId ? navigate('/gym') : setActiveDeskBreak(null))} />;
  }

  if (showRestDay) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
        <RestDayProtocol />
        <button
          type="button"
          onClick={() => setShowRestDay(false)}
          className="mt-5 w-full rounded-2xl bg-white/[0.06] py-3 text-sm font-black text-white/70"
        >
          Show Gym Workouts
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
      <header className="mb-6">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-[#CCFF00]">Gym Mode</p>
        <h1 className="mt-2 text-2xl font-black tracking-[-0.04em]">Train smarter today</h1>
        <p className="mt-2 text-sm leading-6 text-white/45">
          Strength, mobility, and recovery tools built around your lifestyle.
        </p>
      </header>

      <section className="mb-6">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Desk Breaks</p>
        <div className="grid grid-cols-3 gap-2">
          {DESK_BREAKS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/desk-break/${item.id}`)}
              className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-3 text-center"
            >
                <p className="text-lg font-bold text-[#CCFF00]">{item.emoji} {item.duration}m</p>
              <p className="mt-1 text-xs font-medium text-white">{item.title}</p>
              <p className="mt-0.5 text-[10px] text-gray-500">{item.exercises.length} moves</p>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-white/10 bg-[#141416] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">Gym Setup</p>
            <p className="mt-2 text-sm text-white/45">{compatibleExercises.length} exercises match your equipment.</p>
          </div>
          <Link to="/exercises" className="rounded-full bg-[#CCFF00] px-3 py-2 text-xs font-black text-black no-underline">
            📚 Library →
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {EQUIPMENT_LIST.map(item => {
            const selected = selectedEquipment.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void toggleEquipment(item.id)}
                className={`rounded-2xl border p-3 text-center text-xs font-black ${
                  selected ? 'border-[#CCFF00] bg-[#CCFF00]/15 text-[#CCFF00]' : 'border-white/10 bg-white/[0.04] text-white/50'
                }`}
              >
                <span className="block text-lg">{item.emoji}</span>
                {item.name}
              </button>
            );
          })}
        </div>

        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Which machines are free right now?</p>
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT_LIST.filter(item => ['squat_rack', 'cables', 'bench'].includes(item.id)).map(item => {
              const isFree = availableNow.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleAvailableNow(item.id)}
                  className={`rounded-full border px-3 py-2 text-xs font-black ${
                    isFree ? 'border-[#CCFF00] bg-[#CCFF00]/15 text-[#CCFF00]' : 'border-white/10 bg-white/[0.04] text-white/45'
                  }`}
                >
                  {item.name} {isFree ? '✓' : ''}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#141416] p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-white/40">Today</p>
        <div className="grid grid-cols-2 gap-3">
          {(compatibleExercises.length ? compatibleExercises.slice(0, 4).map(item => [item.name, item.level]) : [
            ['Mobility', '15 min'],
            ['Recovery', '10 min'],
          ]).map(([title, duration]) => (
            <button
              key={title}
              onClick={() => title === 'Recovery' && setShowRestDay(true)}
              className="rounded-2xl bg-white/[0.04] p-4 text-left"
            >
              <p className="text-sm font-bold text-white">{title}</p>
              <p className="mt-1 text-xs text-white/40">{duration}</p>
            </button>
          ))}
        </div>
      </section>
    </main>
  );

  async function toggleEquipment(id) {
    const next = selectedEquipment.includes(id)
      ? selectedEquipment.filter(item => item !== id)
      : [...selectedEquipment, id];

    setProfile(prev => ({ ...prev, equipment: next }));
    if (supabase && user?.id) {
      const { error } = await supabase.from('profiles').update({ equipment: next }).eq('id', user.id);
      if (error) console.error('Failed to save equipment:', error);
    }
  }

  function toggleAvailableNow(id) {
    setAvailableNow(prev => {
      const next = prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id];
      localStorage.setItem('endopamin_available_equipment', JSON.stringify(next));
      return next;
    });
  }
}

