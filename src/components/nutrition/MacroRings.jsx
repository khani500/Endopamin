const MACROS = [
  { label: 'Protein', grams: 145, pct: 73, color: '#CCFF00' },
  { label: 'Carbs', grams: 220, pct: 55, color: '#00BFFF' },
  { label: 'Fat', grams: 65, pct: 80, color: '#CCFF00' },
];

function MacroRing({ label, grams, pct, color }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <svg width="76" height="76" viewBox="0 0 76 76" style={{ display: 'block', margin: '0 auto 6px' }}>
        <circle cx="38" cy="38" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="7"
          transform="rotate(-90 38 38)"
        />
        <text x="38" y="42" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="900">
          {pct}%
        </text>
      </svg>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 900, color }}>{label}</p>
      <p style={{ margin: '3px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>⬤ {grams}g</p>
    </div>
  );
}

export function MacroRings() {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
      {MACROS.map(macro => (
        <MacroRing key={macro.label} {...macro} />
      ))}
    </div>
  );
}

