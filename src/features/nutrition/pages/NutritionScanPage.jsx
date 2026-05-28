import { useNutritionStore } from '../store/nutritionStore';
import { FoodScanner } from '../components/FoodScanner';

const MACROS = [
  { key: 'protein', label: 'Protein', grams: 160, percent: 40, color: '#FFCC00' },
  { key: 'carbs', label: 'Carbs', grams: 110, percent: 28, color: '#FF9500' },
  { key: 'fat', label: 'Fat', grams: 65, percent: 32, color: '#FF3B30' },
];

const PIE_SEGMENTS = MACROS.reduce((segments, macro) => {
  const startAngle = segments.length ? segments[segments.length - 1].endAngle : 0;
  const endAngle = startAngle + macro.percent * 3.6;
  return [...segments, { ...macro, startAngle, endAngle }];
}, []);

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

export function SmartMacroPieChart() {
  return (
    <section className="np-card">
      <div className="np-chart-title-row">
        <div>
          <p className="np-brand" style={{ marginBottom: 4 }}>Smart Macros</p>
          <h3 style={{ margin: 0 }}>Macro distribution</h3>
        </div>
        <span className="np-badge">Today</span>
      </div>

      <div className="np-pie-wrap">
        <svg width="168" height="168" viewBox="0 0 168 168" aria-label="Macro nutrient pie chart">
          <circle cx="84" cy="84" r="72" fill="#0A0A0A" />
          {PIE_SEGMENTS.map(macro => {
            const path = describeArc(84, 84, 72, macro.startAngle, macro.endAngle);
            return <path key={macro.key} d={path} fill={macro.color} />;
          })}
          <circle cx="84" cy="84" r="36" fill="#111113" />
          <text x="84" y="80" textAnchor="middle" fill="#ffffff" fontSize="18" fontWeight="900">335g</text>
          <text x="84" y="99" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="10" fontWeight="700">TOTAL</text>
        </svg>

        <div className="np-pie-legend">
          {MACROS.map(macro => (
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

export function MacroMatrixGrid() {
  return (
    <section className="np-matrix-grid">
      {MACROS.map(macro => (
        <div key={macro.key} className="np-matrix-card" style={{ borderColor: `${macro.color}66` }}>
          <p style={{ color: macro.color }}>{macro.label.toUpperCase()}</p>
          <strong>{macro.grams}g</strong>
          <span>{macro.percent}%</span>
        </div>
      ))}
    </section>
  );
}

export default function NutritionScanPage() {
  const addFoodEntry = useNutritionStore(s => s.addFoodEntry);

  return (
    <main className="np-main">
      <FoodScanner
        onAnalyzed={r =>
          addFoodEntry({
            name: r?.name || r?.food_name || r?.label || 'Scanned meal',
            kcal: Number(r?.kcal ?? r?.calories) || 0,
            protein: Number(r?.protein ?? r?.protein_g) || 0,
            carbs: Number(r?.carbs ?? r?.carbs_g) || 0,
            fat: Number(r?.fat ?? r?.fat_g) || 0,
          })
        }
      />
      <SmartMacroPieChart />
      <MacroMatrixGrid />
    </main>
  );
}
