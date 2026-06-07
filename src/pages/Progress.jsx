import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const RANGES = ['1W', '1M', '3M', '6M', '1Y', 'All'];

const DATA = [
  {
    streak: 14, workouts: 5, time: '8h',
    chartTitle: 'Weekly Activity', chartVal: '5 / 7 days',
    segs: 14, xp: 340, lv: 4, rings: [75, 70, 80], chainCount: '14 days strong',
    bars: [
      { h: 65, t: 'done', d: 'Mo' }, { h: 80, t: 'done', d: 'Tu' },
      { h: 15, t: 'rest', d: 'We' }, { h: 70, t: 'done', d: 'Th' },
      { h: 90, t: 'done', d: 'Fr' }, { h: 55, t: 'today', d: 'Sa', act: true },
      { h: 10, t: 'rest', d: 'Su' },
    ],
  },
  {
    streak: 21, workouts: 18, time: '24h',
    chartTitle: 'This Month', chartVal: '18 / 30 days',
    segs: 16, xp: 380, lv: 4, rings: [68, 72, 75], chainCount: '21 days best',
    bars: [
      { h: 60, t: 'done', d: 'W1' }, { h: 75, t: 'done', d: 'W2' },
      { h: 40, t: 'miss', d: 'W3' }, { h: 85, t: 'today', d: 'W4', act: true },
      { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' },
    ],
  },
  {
    streak: 21, workouts: 52, time: '68h',
    chartTitle: 'Last 3 Months', chartVal: '52 workouts',
    segs: 17, xp: 420, lv: 4, rings: [72, 65, 78], chainCount: '21 days best',
    bars: [
      { h: 50, t: 'done', d: 'Feb' }, { h: 70, t: 'done', d: 'Mar' },
      { h: 85, t: 'today', d: 'Apr', act: true }, { h: 55, t: 'done', d: 'May' },
      { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' },
    ],
  },
  {
    streak: 21, workouts: 98, time: '124h',
    chartTitle: 'Last 6 Months', chartVal: '98 workouts',
    segs: 18, xp: 450, lv: 4, rings: [80, 68, 82], chainCount: '21 days best',
    bars: [
      { h: 30, t: 'done', d: 'Nov' }, { h: 45, t: 'done', d: 'Dec' },
      { h: 60, t: 'done', d: 'Jan' }, { h: 50, t: 'done', d: 'Feb' },
      { h: 70, t: 'done', d: 'Mar' }, { h: 85, t: 'done', d: 'Apr' },
      { h: 90, t: 'today', d: 'May', act: true },
    ],
  },
  {
    streak: 21, workouts: 180, time: '230h',
    chartTitle: 'This Year', chartVal: '180 workouts',
    segs: 19, xp: 480, lv: 4, rings: [85, 72, 88], chainCount: '21 days best',
    bars: [
      { h: 20, t: 'done', d: 'Q1' }, { h: 45, t: 'done', d: 'Q2' },
      { h: 60, t: 'done', d: 'Q3' }, { h: 90, t: 'today', d: 'Q4', act: true },
      { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' },
    ],
  },
  {
    streak: 21, workouts: 340, time: '440h',
    chartTitle: 'All Time', chartVal: '340 workouts',
    segs: 20, xp: 500, lv: 5, rings: [90, 80, 92], chainCount: '21 days best',
    bars: [
      { h: 15, t: 'done', d: 'Y1' }, { h: 40, t: 'done', d: 'Y2' },
      { h: 75, t: 'today', d: 'Y3', act: true }, { h: 0, t: 'rest', d: '' },
      { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' }, { h: 0, t: 'rest', d: '' },
    ],
  },
];

const BAR_COLORS = {
  done: 'bg-[#CCFF00]',
  today: 'bg-[#CCFF00]',
  rest: 'bg-white/[0.07]',
  miss: 'bg-[#FF6B6B]/25',
};

const RING_CIRCS = [233, 163, 94];

function RingSvg({ rings }) {
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      {[
        { r: 37, color: '#CCFF00', idx: 0 },
        { r: 26, color: '#5088FF', idx: 1 },
        { r: 15, color: '#A064FF', idx: 2 },
      ].map(ring => (
        <g key={ring.r}>
          <circle cx="45" cy="45" r={ring.r} fill="none" stroke={`${ring.color}12`} strokeWidth="6" />
          <circle cx="45" cy="45" r={ring.r} fill="none" stroke={ring.color} strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCS[ring.idx]}
            strokeDashoffset={RING_CIRCS[ring.idx] * (1 - rings[ring.idx] / 100)}
            transform="rotate(-90 45 45)"
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
        </g>
      ))}
    </svg>
  );
}

const PR_ICON_PALETTE = [
  { iconColor: '#CCFF00', iconBg: 'rgba(204,255,0,0.1)' },
  { iconColor: '#5088FF', iconBg: 'rgba(80,136,255,0.1)' },
  { iconColor: '#FF6B6B', iconBg: 'rgba(255,107,107,0.1)' },
];

function formatPrDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatWeightDiff(current, previous) {
  const diff = Number(current) - Number(previous);
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const label = Number.isInteger(diff) ? diff : diff.toFixed(1);
  return `↑ +${label} kg`;
}

function getRangeStartDate(rangeIdx) {
  if (rangeIdx === 5) return null;

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  switch (rangeIdx) {
    case 0:
      start.setDate(start.getDate() - 7);
      break;
    case 1:
      start.setMonth(start.getMonth() - 1);
      break;
    case 2:
      start.setMonth(start.getMonth() - 3);
      break;
    case 3:
      start.setMonth(start.getMonth() - 6);
      break;
    case 4:
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return null;
  }

  return start;
}

function formatTotalTime(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function getCurrentMonthMeta() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStart = new Date(year, month, 1);
  monthStart.setHours(0, 0, 0, 0);

  return {
    today: now.getDate(),
    daysInMonth: new Date(year, month + 1, 0).getDate(),
    monthName: now.toLocaleString(undefined, { month: 'long' }),
    monthStart,
  };
}

async function fetchWeeklyWorkoutLogs(userId, weekStart, weekEnd) {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('logged_at')
    .eq('user_id', userId)
    .gte('logged_at', weekStart.toISOString())
    .lte('logged_at', weekEnd.toISOString());

  if (error) {
    console.error('Failed to load weekly workout logs:', error);
    return [];
  }

  return data ?? [];
}

function buildActiveDays(logs) {
  const days = new Set();
  for (const log of logs) {
    if (!log.logged_at) continue;
    days.add(new Date(log.logged_at).getDate());
  }
  return days;
}

function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() + mondayOffset);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function emptyWeeklyChart() {
  return {
    chartTitle: 'Weekly Activity',
    chartVal: '0 / 7 days',
    bars: WEEKDAY_LABELS.map(d => ({ h: 10, t: 'rest', d, act: false })),
  };
}

function buildWeeklyChart(logs) {
  const { weekStart } = getCurrentWeekRange();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const workoutDays = new Set();
  for (const log of logs) {
    if (!log.logged_at) continue;
    const date = new Date(log.logged_at);
    date.setHours(0, 0, 0, 0);
    workoutDays.add(date.getTime());
  }

  let activeDayCount = 0;
  const bars = WEEKDAY_LABELS.map((label, index) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + index);
    dayDate.setHours(0, 0, 0, 0);

    const hasWorkout = workoutDays.has(dayDate.getTime());
    const isToday = dayDate.getTime() === today.getTime();

    if (hasWorkout) activeDayCount += 1;

    return {
      h: hasWorkout ? 90 : 10,
      t: hasWorkout ? (isToday ? 'today' : 'done') : 'rest',
      d: label,
      act: isToday,
    };
  });

  return {
    chartTitle: 'Weekly Activity',
    chartVal: `${activeDayCount} / 7 days`,
    bars,
  };
}

function countDistinctLogDays(logs, getTimestamp = log => log.logged_at) {
  const days = new Set();
  for (const log of logs) {
    const value = getTimestamp(log);
    if (!value) continue;
    const date = new Date(value);
    days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }
  return days.size;
}

function calculateActivityRings(workoutLogs, nutritionLogs, goalDays) {
  const workoutDayCount = countDistinctLogDays(workoutLogs);
  const nutritionDayCount = countDistinctLogDays(nutritionLogs);
  const safeGoalDays = goalDays > 0 ? goalDays : 4;

  const workoutRing = workoutDayCount > 0
    ? Math.min(100, Math.round((workoutDayCount / safeGoalDays) * 100))
    : 0;

  const nutritionRing = nutritionDayCount > 0
    ? Math.min(100, Math.round((nutritionDayCount / 7) * 100))
    : 0;

  let recoveryRing = 0;
  if (workoutDayCount > 0) {
    recoveryRing = workoutDayCount <= safeGoalDays
      ? 100
      : Math.min(100, Math.round((safeGoalDays / workoutDayCount) * 100));
  }

  return [workoutRing, nutritionRing, recoveryRing];
}

function getStreakDayClass(day, today, activeDays) {
  if (day === today) return 'today';
  if (day > today) return 'empty';
  if (activeDays.has(day)) return 'done';
  return 'miss';
}

const STREAK_DAY_STYLES = {
  done: { bg: 'rgba(204,255,0,0.15)', border: 'rgba(204,255,0,0.3)', color: '#CCFF00' },
  today: { bg: '#CCFF00', border: '#CCFF00', color: '#000' },
  miss: { bg: 'rgba(255,107,107,0.1)', border: 'rgba(255,107,107,0.2)', color: 'rgba(255,107,107,0.6)' },
  empty: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.15)' },
};

function buildPrRows(records) {
  const byExercise = new Map();

  for (const record of records) {
    const key = record.exercise_name?.trim().toLowerCase();
    if (!key) continue;
    if (!byExercise.has(key)) byExercise.set(key, []);
    byExercise.get(key).push(record);
  }

  const rows = [];

  for (const exerciseRecords of byExercise.values()) {
    const current = exerciseRecords[0];
    const previous = exerciseRecords[1];
    const increasedBadge = previous ? formatWeightDiff(current.weight_kg, previous.weight_kg) : null;

    rows.push({
      name: current.exercise_name,
      date: formatPrDate(current.recorded_at),
      recordedAt: current.recorded_at,
      kg: Number(current.weight_kg),
      badge: increasedBadge ?? (previous ? null : '↑ NEW PR'),
      badgeColor: increasedBadge ? '#5088FF' : '#FFA53C',
    });
  }

  return rows.sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
}

export default function Progress() {
  const { profile, user } = useAuth() || {};
  const [rangeIdx, setRangeIdx] = useState(0);
  const [prRecords, setPrRecords] = useState([]);
  const [prLoading, setPrLoading] = useState(true);
  const [workoutStats, setWorkoutStats] = useState({ workouts: 0, time: '0h' });
  const [workoutStatsLoading, setWorkoutStatsLoading] = useState(true);
  const [activeDays, setActiveDays] = useState(() => new Set());
  const [activityRings, setActivityRings] = useState([0, 0, 0]);
  const [weeklyChart, setWeeklyChart] = useState(emptyWeeklyChart);
  const d = DATA[rangeIdx];
  const pct = Math.round((rangeIdx / 5) * 100);
  const monthMeta = useMemo(() => getCurrentMonthMeta(), []);

  const streak = profile?.streak_count ?? d.streak;
  const xp = profile?.dopa_xp ?? d.xp;
  const lv = profile?.dopa_level ?? d.lv;

  useEffect(() => {
    let cancelled = false;

    async function fetchPersonalRecords() {
      if (!user?.id || !supabase) {
        if (!cancelled) {
          setPrRecords([]);
          setPrLoading(false);
        }
        return;
      }

      setPrLoading(true);

      const { data, error } = await supabase
        .from('personal_records')
        .select('exercise_name, weight_kg, reps, recorded_at')
        .eq('user_id', user.id)
        .order('recorded_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error('Failed to load personal records:', error);
        setPrRecords([]);
      } else {
        setPrRecords(data ?? []);
      }

      setPrLoading(false);
    }

    void fetchPersonalRecords();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;

    async function fetchWorkoutStats() {
      if (!user?.id || !supabase) {
        if (!cancelled) {
          setWorkoutStats({ workouts: 0, time: '0h' });
          setWorkoutStatsLoading(false);
        }
        return;
      }

      setWorkoutStatsLoading(true);

      const startDate = getRangeStartDate(rangeIdx);
      let query = supabase
        .from('workout_logs')
        .select('duration_minutes, logged_at')
        .eq('user_id', user.id);

      if (startDate) {
        query = query.gte('logged_at', startDate.toISOString());
      }

      const { data, error } = await query;

      if (cancelled) return;

      if (error) {
        console.error('Failed to load workout stats:', error);
        setWorkoutStats({ workouts: 0, time: '0h' });
      } else {
        const logs = data ?? [];
        const totalMinutes = logs.reduce(
          (sum, log) => sum + (Number(log.duration_minutes) || 0),
          0,
        );
        setWorkoutStats({
          workouts: logs.length,
          time: formatTotalTime(totalMinutes),
        });
      }

      setWorkoutStatsLoading(false);
    }

    void fetchWorkoutStats();

    return () => {
      cancelled = true;
    };
  }, [user?.id, rangeIdx]);

  useEffect(() => {
    let cancelled = false;

    async function fetchMonthWorkouts() {
      if (!user?.id || !supabase) {
        if (!cancelled) setActiveDays(new Set());
        return;
      }

      const { data, error } = await supabase
        .from('workout_logs')
        .select('logged_at')
        .eq('user_id', user.id)
        .gte('logged_at', monthMeta.monthStart.toISOString());

      if (cancelled) return;

      if (error) {
        console.error('Failed to load streak calendar:', error);
        setActiveDays(new Set());
      } else {
        setActiveDays(buildActiveDays(data ?? []));
      }
    }

    void fetchMonthWorkouts();

    return () => {
      cancelled = true;
    };
  }, [user?.id, monthMeta.monthStart]);

  useEffect(() => {
    let cancelled = false;

    async function fetchActivityRings() {
      if (!user?.id || !supabase) {
        if (!cancelled) {
          setActivityRings([0, 0, 0]);
          setWeeklyChart(emptyWeeklyChart());
        }
        return;
      }

      const { weekStart, weekEnd } = getCurrentWeekRange();
      const goalDays = profile?.days_per_week || 4;

      const [workoutLogs, nutritionResult] = await Promise.all([
        fetchWeeklyWorkoutLogs(user.id, weekStart, weekEnd),
        supabase
          .from('nutrition_logs')
          .select('logged_at')
          .eq('user_id', user.id)
          .gte('logged_at', weekStart.toISOString())
          .lte('logged_at', weekEnd.toISOString()),
      ]);

      if (cancelled) return;

      if (nutritionResult.error) {
        console.error('Failed to load nutrition ring data:', nutritionResult.error);
      }

      setActivityRings(
        calculateActivityRings(
          workoutLogs,
          nutritionResult.error ? [] : nutritionResult.data ?? [],
          goalDays,
        ),
      );
      setWeeklyChart(buildWeeklyChart(workoutLogs));
    }

    void fetchActivityRings();

    return () => {
      cancelled = true;
    };
  }, [user?.id, profile?.days_per_week]);

  const prRows = useMemo(() => buildPrRows(prRecords), [prRecords]);
  const chartData = rangeIdx === 0
    ? weeklyChart
    : { chartTitle: d.chartTitle, chartVal: d.chartVal, bars: d.bars };

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-28 overflow-x-hidden">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-[#CCFF00] opacity-[0.03] blur-3xl" />

      {/* Header */}
      <div className="px-5 pt-14 pb-4 flex justify-between items-end">
        <div>
          <div className="font-['Orbitron',monospace] font-black text-[14px] tracking-[3px] mb-1">
            <span className="text-[#CCFF00]">∃</span>NDO <span className="text-white/30 text-[11px]">/ Progress</span>
          </div>
          <h1 className="text-[24px] font-bold tracking-tight">Your Progress</h1>
          <p className="text-[11px] text-white/35 mt-0.5 italic">Every rep counts. Every day matters.</p>
        </div>
        <button type="button" className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
          </svg>
        </button>
      </div>

      {/* Timeline */}
      <div className="px-5 mb-5">
        <div className="flex gap-1.5 mb-3">
          {RANGES.map((r, i) => (
            <button key={r} type="button" onClick={() => setRangeIdx(i)}
              className="flex-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider rounded-[8px] border transition-all active:scale-95"
              style={{
                background: rangeIdx === i ? 'rgba(204,255,0,0.1)' : 'rgba(255,255,255,0.03)',
                borderColor: rangeIdx === i ? 'rgba(204,255,0,0.3)' : 'rgba(255,255,255,0.08)',
                color: rangeIdx === i ? '#CCFF00' : 'rgba(255,255,255,0.3)',
              }}>
              {r}
            </button>
          ))}
        </div>
        <div className="relative h-[3px] bg-white/[0.07] rounded-full">
          <div className="h-full bg-[#CCFF00] rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, boxShadow: '0 0 8px rgba(204,255,0,0.4)' }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#CCFF00] border-2 border-[#080808] transition-all duration-500"
            style={{ left: `${pct}%`, transform: 'translate(-50%,-50%)', boxShadow: '0 0 10px rgba(204,255,0,0.6)' }} />
          <input type="range" min="0" max="5" step="1" value={rangeIdx}
            onChange={e => setRangeIdx(parseInt(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer" style={{ height: '100%' }} />
        </div>
      </div>

      {/* Endopamin Charge */}
      <div className="mx-5 mb-4 rounded-[22px] border p-4 relative overflow-hidden"
        style={{ borderColor: 'rgba(204,255,0,0.22)', background: 'linear-gradient(135deg,rgba(204,255,0,0.08),rgba(204,255,0,0.02))', boxShadow: '0 0 30px rgba(204,255,0,0.06),0 8px 28px rgba(0,0,0,0.5)' }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#CCFF00]/40 to-transparent" />
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-1.5 text-[9px] tracking-[2px] uppercase text-white/40 font-bold">
            <svg viewBox="0 0 24 24" fill="none" stroke="#CCFF00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Endopamin Charge
          </div>
          <span className="text-[9px] text-[#CCFF00] font-bold bg-[#CCFF00]/12 border border-[#CCFF00]/25 px-2 py-0.5 rounded-full">
            Level {lv} · {Math.round(d.segs / 20 * 100)}%
          </span>
        </div>
        <div className="flex gap-[3px] mb-2">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="flex-1 h-[8px] rounded-[3px] transition-all duration-500"
              style={{ background: i < d.segs ? '#CCFF00' : 'rgba(255,255,255,0.06)', boxShadow: i < d.segs ? '0 0 6px rgba(204,255,0,0.4)' : 'none' }} />
          ))}
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-white/30">{xp} XP · {lv < 5 ? `${500 - xp} to Level ${lv + 1}` : 'Max level!'}</span>
          <span className="text-[#CCFF00] font-bold">Lv.{lv + 1} →</span>
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 grid grid-cols-3 gap-2.5 mb-4">
        {[
          { icon: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>, val: streak, lbl: 'Day Streak', color: '#CCFF00' },
          { icon: <><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/></>, val: workoutStatsLoading ? '...' : workoutStats.workouts, lbl: 'Workouts', color: '#5088FF' },
          { icon: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, val: workoutStatsLoading ? '...' : workoutStats.time, lbl: 'Total Time', color: '#FFA53C' },
        ].map((s, i) => (
          <div key={i} className="rounded-[18px] border border-white/[0.06] p-3 bg-white/[0.025] text-center"
            style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <div className="flex justify-center mb-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                {s.icon}
              </svg>
            </div>
            <div className="text-[18px] font-bold transition-all duration-500" style={{ color: s.color }}>{s.val}</div>
            <div className="text-[8px] uppercase tracking-[1.5px] text-white/30 mt-0.5 font-bold">{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* Weekly Chart */}
      <div className="mx-5 mb-4 rounded-[22px] border border-white/[0.07] p-4"
        style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
        <div className="flex justify-between items-center mb-3">
          <span className="text-[9px] tracking-[2px] uppercase text-white/40 font-bold">{chartData.chartTitle}</span>
          <span className="text-[10px] text-[#CCFF00] font-bold">{chartData.chartVal}</span>
        </div>
        <div className="flex items-end gap-1.5 h-[70px]">
          {chartData.bars.filter(b => b.d || b.h > 0).map((b, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              <div className={`w-full rounded-t-[4px] transition-all duration-500 ${BAR_COLORS[b.t]}`}
                style={{ height: `${b.h}%`, boxShadow: (b.t === 'done' || b.t === 'today') ? '0 0 8px rgba(204,255,0,0.3)' : 'none' }} />
              <span className={`text-[8px] font-bold ${b.act ? 'text-[#CCFF00]' : 'text-white/30'}`}>{b.d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Streak Chain */}
      <div className="mx-5 mb-4 rounded-[22px] border border-white/[0.07] p-4"
        style={{ background: 'rgba(255,255,255,0.025)' }}>
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-1.5 text-[9px] tracking-[2px] uppercase text-white/40 font-bold">
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFA53C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M12 2c0 0-5 4-5 9a5 5 0 0010 0c0-5-5-9-5-9z"/>
            </svg>
            Streak Chain — {monthMeta.monthName}
          </div>
          <span className="text-[10px] text-[#FFA53C] font-bold">{streak} days strong</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: monthMeta.daysInMonth }).map((_, i) => {
            const day = i + 1;
            const cls = getStreakDayClass(day, monthMeta.today, activeDays);
            const styles = STREAK_DAY_STYLES[cls];
            return (
              <div key={i} className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-[8px] font-bold border"
                style={{ background: styles.bg, borderColor: styles.border, color: styles.color, boxShadow: cls === 'today' ? '0 0 10px rgba(204,255,0,0.5)' : 'none' }}>
                {day}
              </div>
            );
          })}
        </div>
      </div>

      {/* Activity Rings */}
      <div className="mx-5 mb-4 rounded-[22px] border border-white/[0.07] p-4 flex items-center gap-4"
        style={{ background: 'rgba(255,255,255,0.025)' }}>
        <div className="relative flex-shrink-0 w-[90px] h-[90px]">
          <RingSvg rings={activityRings} />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
        </div>
        <div className="flex-1 space-y-2.5">
          {[
            { label: 'Workout', color: '#CCFF00', idx: 0 },
            { label: 'Nutrition', color: '#5088FF', idx: 1 },
            { label: 'Recovery', color: '#A064FF', idx: 2 },
          ].map(ring => (
            <div key={ring.label} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ring.color, boxShadow: `0 0 5px ${ring.color}` }} />
              <span className="text-[10px] text-white/40 flex-1">{ring.label}</span>
              <span className="text-[12px] font-bold transition-all duration-500" style={{ color: ring.color }}>
                {activityRings[ring.idx]}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* PR Tracker */}
      <div className="mx-5 mb-4 rounded-[22px] border border-white/[0.07] p-4"
        style={{ background: 'rgba(255,255,255,0.025)' }}>
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-1.5 text-[9px] tracking-[2px] uppercase text-white/40 font-bold">
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M8 21H5a2 2 0 01-2-2v-2a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 01-2 2h-3"/><path d="M12 3v13M8 7l4-4 4 4"/>
            </svg>
            Personal Records
          </div>
          <span className="text-[10px] text-[#CCFF00] font-bold cursor-pointer">+ Add</span>
        </div>
        {prLoading ? (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#CCFF00]/30 border-t-[#CCFF00]" />
          </div>
        ) : prRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-white/30">No records yet</p>
        ) : (
          prRows.map((pr, i) => {
            const palette = PR_ICON_PALETTE[i % PR_ICON_PALETTE.length];
            return (
              <div key={`${pr.name}-${pr.date}`} className="flex items-center justify-between border-b border-white/[0.05] py-2.5 last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border"
                    style={{ background: palette.iconBg, borderColor: palette.iconBg }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke={palette.iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-white">{pr.name}</p>
                    <p className="mt-0.5 text-[9px] text-white/30">{pr.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-bold text-[#CCFF00]">{pr.kg} kg</p>
                  {pr.badge ? (
                    <p className="text-[9px] font-bold" style={{ color: pr.badgeColor }}>{pr.badge}</p>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

    </main>
  );
}
