import { useState } from 'react';

const LABELS = {
  sleep: 'Sleep',
  nutrition: 'Nutrition',
  workout: 'Workout',
  checkIn: 'Check-in',
};

const IMPROVEMENT_TIPS = {
  sleep: 'Log sleep quality during daily check-in. Better recovery raises this category.',
  nutrition: 'Log calories and macros in Nutrition so the score can credit your fueling.',
  workout: 'Complete a workout or mobility session today to add workout points.',
  checkIn: 'Submit the daily check-in. It takes 30 seconds and unlocks coach guidance.',
};

export function DopaScore({ score, color, breakdown = {} }) {
  const [open, setOpen] = useState(false);
  const pct = Math.max(0, Math.min(100, Number(score) || 0));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          margin: '0 20px 16px',
          width: 'calc(100% - 40px)',
          padding: 18,
          borderRadius: 22,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.04)',
          color: '#fff',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)' }}>Dopa Score</p>
        <div style={{ textAlign: 'center', fontSize: 64, lineHeight: 1, fontWeight: 900, color }}>{pct}</div>
        <div style={{ height: 8, marginTop: 14, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: color }} />
        </div>
        <p style={{ margin: '8px 0 14px', textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{pct}/100</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {Object.keys(LABELS).map(key => (
            <span key={key} style={{ fontSize: 12, color: breakdown[key] ? '#fff' : 'rgba(255,255,255,0.35)' }}>
              {LABELS[key]} {breakdown[key] ? '✓' : '—'}
            </span>
          ))}
        </div>
      </button>

      {open ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.62)', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 340, borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', background: '#111113', padding: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 900 }}>Dopa Score breakdown</h3>
            {Object.entries(LABELS).map(([key, label]) => (
              <div key={key} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'rgba(255,255,255,0.72)' }}>{label}</span>
                  <strong style={{ color }}>{breakdown[key] || 0} pts</strong>
                </div>
                <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.42)', fontSize: 12, lineHeight: 1.45 }}>
                  {IMPROVEMENT_TIPS[key]}
                </p>
              </div>
            ))}
            <button type="button" onClick={() => setOpen(false)} style={{ marginTop: 16, width: '100%', padding: 13, borderRadius: 14, border: 'none', background: color, color: '#0A0A0A', fontWeight: 900 }}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

