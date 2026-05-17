import { Link } from 'react-router-dom';
import { ShareCard } from '../components/progress/ShareCard';
import { PRTracker } from '../components/progress/PRTracker';
import { WorkoutHistory } from '../components/progress/WorkoutHistory';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function WeightChart() {
  const points = [82.8, 82.6, 82.2, 82.1, 81.9, 81.6, 81.5];
  const labels = ['May 9', 'May 10', 'May 11', 'May 12', 'May 13', 'May 14', 'May 15'];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const width = 330;
  const height = 160;
  const padX = 18;
  const padY = 18;
  const coords = points.map((kg, index) => {
    const x = padX + (index / (points.length - 1)) * (width - padX * 2);
    const y = height - padY - ((kg - min) / (max - min || 1)) * (height - padY * 2);
    return { x, y, kg };
  });
  const linePath = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Weekly Weight Trend</p>
          <p className="mt-1 text-xs font-bold text-white/45">kg · last 7 logs</p>
        </div>
        <p className="m-0 text-2xl font-black text-[#007AFF]">{points.at(-1)}kg</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/35 p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" role="img" aria-label="Weekly weight trend graph">
          {[0, 1, 2, 3].map(row => {
            const y = padY + row * ((height - padY * 2) / 3);
            return <line key={row} x1="0" x2={width} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
          })}
          {coords.map(point => (
            <line key={`v-${point.x}`} x1={point.x} x2={point.x} y1={padY} y2={height - padY} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          ))}
          <path d={linePath} fill="none" stroke="#007AFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {coords.map((point, index) => (
            <g key={`${point.kg}-${index}`}>
              <circle cx={point.x} cy={point.y} r="5.5" fill="#007AFF" />
              <circle cx={point.x} cy={point.y} r="9" fill="rgba(0,122,255,0.14)" />
            </g>
          ))}
        </svg>
        <div className="grid grid-cols-7 gap-1 px-1 pb-1">
          {labels.map(label => (
            <span key={label} className="text-center text-[9px] font-bold text-white/30">{label.replace('May ', '')}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkoutStreakCalendar() {
  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Workout Streak</p>
      <div className="flex justify-between gap-2">
        {DAYS.map((day, index) => {
          const done = index < 5;
          return (
            <div key={`${day}-${index}`} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-[10px] font-bold text-white/35">{day}</span>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border ${done ? 'border-[#CCFF00]/45 bg-[#CCFF00] text-black' : 'border-white/10 bg-black/30 text-white/25'}`}>
                {done ? '✓' : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BodyProgressPhotos() {
  const { user } = useAuth();
  const [photos, setPhotos] = useState([
    { label: 'Before', date: 'May 1', icon: '📷' },
    { label: 'Week 4', date: 'May 22', icon: '📷' },
    { label: 'Now', date: 'Today', icon: '📷' },
  ]);

  const handlePhotoUpload = async file => {
    if (!file || !user?.id || !supabase) return;
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    const { data, error } = await supabase.storage.from('progress-photos').upload(fileName, file);

    if (!error) {
      await supabase.from('body_metrics').insert({
        user_id: user.id,
        photo_url: data.path,
        recorded_at: new Date().toISOString(),
      });
      setPhotos(prev => prev.map((item, index) => (index === 2 ? { ...item, icon: '✅' } : item)));
    }
  };

  return (
    <section className="rounded-[22px] border border-white/10 bg-[#141416] p-4 text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="m-0 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">Body Progress Photos</p>
          <p className="mt-1 text-xs text-white/40">Swipe to compare your visual progress.</p>
        </div>
        <label className="rounded-2xl bg-[#CCFF00] px-3 py-2 text-xs font-black text-black">
          + Add Photo Today
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => void handlePhotoUpload(event.target.files?.[0])}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {photos.map(photo => (
          <div key={photo.label} className="rounded-2xl border border-white/[0.07] bg-[#101012] p-3 text-center">
            <p className="text-xs font-black text-white/60">{photo.label}</p>
            <div className="my-3 grid aspect-square place-items-center rounded-xl bg-black/40 text-3xl">{photo.icon}</div>
            <p className="text-[10px] font-bold text-white/35">{photo.date}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-white/35">← swipe to compare →</p>
    </section>
  );
}

export default function Progress() {
  return (
    <main className="mx-auto min-h-screen max-w-[390px] bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-[26px] font-black tracking-tight">Progress</h1>
          <p className="mt-1 text-sm text-white/45">Streaks, PRs, and workout history.</p>
        </div>
        <ShareCard />
      </header>

      <div className="space-y-4">
        <WeightChart />
        <PRTracker />
        <BodyProgressPhotos />
        <WorkoutStreakCalendar />
        <WorkoutHistory />
      </div>

      <Link to="/" className="mt-6 block rounded-2xl bg-[#CCFF00] py-3 text-center text-sm font-black text-black no-underline">
        Back to Home
      </Link>
    </main>
  );
}

