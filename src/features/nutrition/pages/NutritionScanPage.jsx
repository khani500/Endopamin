import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import {
  foodResultToLogEntry,
  saveNutritionLog,
} from '../../../lib/foodScanner';
import { useNutritionStore } from '../store/nutritionStore';
import { FoodScanner } from '../components/FoodScanner';
import { MacroRings } from '../components/MacroRings';

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    'Z',
  ].join(' ');
}

function buildMacroSegments(protein, carbs, fat) {
  const total = protein + carbs + fat;
  if (total <= 0) {
    return [
      { key: 'protein', label: 'Protein', grams: 0, percent: 33, color: '#FFCC00' },
      { key: 'carbs', label: 'Carbs', grams: 0, percent: 34, color: '#FF9500' },
      { key: 'fat', label: 'Fat', grams: 0, percent: 33, color: '#FF3B30' },
    ];
  }

  const items = [
    { key: 'protein', label: 'Protein', grams: protein, color: '#FFCC00' },
    { key: 'carbs', label: 'Carbs', grams: carbs, color: '#FF9500' },
    { key: 'fat', label: 'Fat', grams: fat, color: '#FF3B30' },
  ].map(m => ({ ...m, percent: Math.round((m.grams / total) * 100) }));

  let angle = 0;
  return items.map(m => {
    const sweep = m.percent * 3.6;
    const seg = { ...m, startAngle: angle, endAngle: angle + sweep };
    angle += sweep;
    return seg;
  });
}

function SmartMacroPieChart({ protein, carbs, fat }) {
  const segments = buildMacroSegments(protein, carbs, fat);
  const total = Math.round(protein + carbs + fat);

  return (
    <section className="np-card">
      <div className="np-chart-title-row">
        <div>
          <p className="np-brand" style={{ marginBottom: 4 }}>Smart Macros</p>
          <h3 style={{ margin: 0 }}>Today&apos;s macro distribution</h3>
        </div>
        <span className="np-badge">Today</span>
      </div>

      <div className="np-pie-wrap">
        <svg width="168" height="168" viewBox="0 0 168 168" aria-label="Macro nutrient pie chart">
          <circle cx="84" cy="84" r="72" fill="#0A0A0A" />
          {segments.map(macro => (
            <path
              key={macro.key}
              d={describeArc(84, 84, 72, macro.startAngle, macro.endAngle)}
              fill={macro.color}
            />
          ))}
          <circle cx="84" cy="84" r="36" fill="#111113" />
          <text x="84" y="80" textAnchor="middle" fill="#ffffff" fontSize="18" fontWeight="900">
            {total}g
          </text>
          <text x="84" y="99" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="10" fontWeight="700">
            LOGGED
          </text>
        </svg>

        <div className="np-pie-legend">
          {segments.map(macro => (
            <div key={macro.key} className="np-pie-legend-row">
              <span className="np-pie-dot" style={{ background: macro.color }} />
              <span>{macro.label}</span>
              <strong>{macro.grams}g</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MacroMatrixGrid({ protein, carbs, fat, targetProtein, targetCarbs, targetFat }) {
  const macros = [
    { key: 'protein', label: 'Protein', grams: protein, target: targetProtein, color: '#FFCC00' },
    { key: 'carbs', label: 'Carbs', grams: carbs, target: targetCarbs, color: '#FF9500' },
    { key: 'fat', label: 'Fat', grams: fat, target: targetFat, color: '#FF3B30' },
  ];

  return (
    <section className="np-matrix-grid">
      {macros.map(macro => {
        const pct = macro.target > 0 ? Math.min(100, Math.round((macro.grams / macro.target) * 100)) : 0;
        return (
          <div key={macro.key} className="np-matrix-card" style={{ borderColor: `${macro.color}66` }}>
            <p style={{ color: macro.color }}>{macro.label.toUpperCase()}</p>
            <strong>{macro.grams}g</strong>
            <span>{pct}% of {macro.target}g goal</span>
          </div>
        );
      })}
    </section>
  );
}

export default function NutritionScanPage() {
  const { user } = useAuth();
  const foodLog = useNutritionStore(s => s.foodLog);
  const addFoodEntry = useNutritionStore(s => s.addFoodEntry);
  const targetProtein = useNutritionStore(s => s.targetProtein);
  const targetCarbs = useNutritionStore(s => s.targetCarbs);
  const targetFat = useNutritionStore(s => s.targetFat);
  const targetCalories = useNutritionStore(s => s.targetCalories);

  const [lastLogged, setLastLogged] = useState(null);
  const [syncNote, setSyncNote] = useState('');

  const today = useMemo(() => new Date().toDateString(), []);

  const todayTotals = useMemo(
    () =>
      foodLog
        .filter(e => new Date(e.at).toDateString() === today)
        .reduce(
          (a, e) => ({
            kcal: a.kcal + e.kcal,
            protein: a.protein + e.protein,
            carbs: a.carbs + e.carbs,
            fat: a.fat + e.fat,
          }),
          { kcal: 0, protein: 0, carbs: 0, fat: 0 },
        ),
    [foodLog, today],
  );

  const handleConfirm = useCallback(
    async result => {
      const entry = foodResultToLogEntry(result);

      addFoodEntry(entry);
      setLastLogged({ ...entry, at: Date.now() });
      setSyncNote('');

      if (!user?.id) {
        setSyncNote('Logged on this device. Sign in to sync with cloud.');
        return;
      }

      const { error, skipped } = await saveNutritionLog(supabase, {
        userId: user.id,
        foodName: entry.name,
        calories: entry.kcal,
        protein: entry.protein,
        carbs: entry.carbs,
        fat: entry.fat,
      });

      if (skipped) {
        setSyncNote('Logged on this device.');
      } else if (error) {
        console.error('Supabase nutrition_logs insert failed:', error);
        setSyncNote('Saved on device. Cloud sync will retry later.');
      } else {
        setSyncNote('Synced to your nutrition log.');
      }
    },
    [addFoodEntry, user?.id],
  );

  return (
    <main className="np-main">
      <FoodScanner onConfirm={handleConfirm} />

      {lastLogged && (
        <section
          className="np-card"
          style={{ borderColor: 'rgba(204,255,0,0.35)', background: 'rgba(204,255,0,0.06)' }}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#CCFF00]">Logged</p>
          <p className="mt-1 text-sm font-black text-white">{lastLogged.name}</p>
          <p className="mt-1 text-xs text-white/50">
            {lastLogged.kcal} kcal · P {lastLogged.protein}g · C {lastLogged.carbs}g · F {lastLogged.fat}g
          </p>
          {syncNote && <p className="mt-2 text-xs font-bold text-white/45">{syncNote}</p>}
        </section>
      )}

      <section className="np-card">
        <p className="np-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Today&apos;s calories
        </p>
        <p className="np-stat-big">
          {Math.round(todayTotals.kcal)}
          <span style={{ fontSize: 16, fontWeight: 600, color: '#71717a' }}> / {targetCalories}</span>
        </p>
        <MacroRings
          protein={todayTotals.protein}
          carbs={todayTotals.carbs}
          fat={todayTotals.fat}
          targetProtein={targetProtein}
          targetCarbs={targetCarbs}
          targetFat={targetFat}
        />
      </section>

      <SmartMacroPieChart
        protein={todayTotals.protein}
        carbs={todayTotals.carbs}
        fat={todayTotals.fat}
      />
      <MacroMatrixGrid
        protein={todayTotals.protein}
        carbs={todayTotals.carbs}
        fat={todayTotals.fat}
        targetProtein={targetProtein}
        targetCarbs={targetCarbs}
        targetFat={targetFat}
      />
    </main>
  );
}
