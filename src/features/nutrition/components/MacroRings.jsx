const NEON = '#39FF14';

function Ring({ label, current, target }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="np-macro-item">
      <svg width="76" height="76" viewBox="0 0 76 76" style={{ display: 'block', margin: '0 auto' }}>
        <circle cx="38" cy="38" r={r} fill="none" stroke="#3f3f46" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={NEON}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 38 38)"
        />
        <text x="38" y="42" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="800">
          {pct}%
        </text>
      </svg>
      <p className="np-macro-label">{label}</p>
      <p className="np-macro-sub">
        {Math.round(current)} / {Math.round(target)} g
      </p>
    </div>
  );
}

export function MacroRings({ protein, carbs, fat, targetProtein, targetCarbs, targetFat }) {
  return (
    <div className="np-macro-row">
      <Ring label="Protein" current={protein} target={targetProtein} />
      <Ring label="Carbs" current={carbs} target={targetCarbs} />
      <Ring label="Fat" current={fat} target={targetFat} />
    </div>
  );
}
