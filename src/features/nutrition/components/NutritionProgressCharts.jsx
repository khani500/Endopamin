const NEON = '#39FF14';

export function NutritionProgressCharts({
  title = 'Weekly calories',
  series = [
    { day: 'M', kcal: 2100 },
    { day: 'T', kcal: 1950 },
    { day: 'W', kcal: 2300 },
    { day: 'T', kcal: 2050 },
    { day: 'F', kcal: 2180 },
    { day: 'S', kcal: 2400 },
    { day: 'S', kcal: 1980 },
  ],
  targetLine = 2200,
}) {
  const max = Math.max(...series.map(s => s.kcal), targetLine, 1);

  return (
    <div>
      <div className="np-chart-title-row">
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#fff' }}>{title}</h3>
        <span className="np-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>7-day</span>
      </div>
      <div className="np-chart-bars">
        {series.map((s, i) => {
          const h = Math.max(8, Math.round((s.kcal / max) * 100));
          return (
            <div key={i} className="np-chart-col">
              <div className="np-chart-bar-wrap">
                <div
                  className="np-chart-bar"
                  style={{ height: `${h}%`, boxShadow: `0 0 10px ${NEON}44` }}
                  title={`${s.kcal} kcal`}
                />
              </div>
              <span className="np-chart-day">{s.day}</span>
            </div>
          );
        })}
      </div>
      <p className="np-muted" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>Goal: {targetLine} kcal</span>
        <span style={{ color: NEON }}>API ready</span>
      </p>
    </div>
  );
}
