import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lastCheckIn';
const ENERGY = [
  { value: 1, emoji: '😴' },
  { value: 2, emoji: '😕' },
  { value: 3, emoji: '😐' },
  { value: 4, emoji: '💪' },
  { value: 5, emoji: '🔥' },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function DailyCheckIn({ onSubmit }) {
  const [open, setOpen] = useState(false);
  const [energy, setEnergy] = useState(3);
  const [sleep, setSleep] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const today = todayKey();
      try {
        if (localStorage.getItem(STORAGE_KEY) !== today) setOpen(true);
      } catch {
        setOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!open) return null;

  const submit = () => {
    const today = todayKey();
    const coachMessage =
      energy >= 4 && sleep
        ? "You're primed. Let's chase a PR today."
        : energy <= 2
          ? 'Rest is training too. Mobility session today?'
          : 'Solid baseline. Build momentum with one clean session today.';
    const payload = { energy, sleep, date: today, submitted: true, coachMessage };
    try {
      localStorage.setItem(STORAGE_KEY, today);
    } catch {
      /* localStorage can fail in private mode */
    }
    onSubmit?.(payload);
    setOpen(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', background: 'rgba(0,0,0,0.58)' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 390,
          margin: '0 auto',
          borderRadius: '28px 28px 0 0',
          border: '1px solid rgba(204,255,0,0.22)',
          background: '#111113',
          padding: '22px 20px max(24px, env(safe-area-inset-bottom))',
          boxShadow: '0 -24px 80px rgba(0,0,0,0.75)',
          animation: 'checkInSlideUp 220ms ease-out',
        }}
      >
        <style>{`
          @keyframes checkInSlideUp {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
        <h2 style={{ margin: '0 0 18px', textAlign: 'center', fontSize: 20, fontWeight: 900 }}>How&apos;s your energy today?</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 22 }}>
          {ENERGY.map(item => (
            <button
              key={item.value}
              type="button"
              onClick={() => setEnergy(item.value)}
              style={{
                height: 54,
                borderRadius: 16,
                border: `2px solid ${energy === item.value ? '#CCFF00' : 'rgba(255,255,255,0.08)'}`,
                background: energy === item.value ? 'rgba(204,255,0,0.12)' : 'rgba(255,255,255,0.04)',
                fontSize: 26,
                cursor: 'pointer',
              }}
            >
              {item.emoji}
            </button>
          ))}
        </div>

        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.68)' }}>Did you sleep well?</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          {[true, false].map(value => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setSleep(value)}
              style={{
                padding: '13px 12px',
                borderRadius: 14,
                border: `1px solid ${sleep === value ? 'rgba(204,255,0,0.55)' : 'rgba(255,255,255,0.1)'}`,
                background: sleep === value ? '#CCFF00' : 'rgba(255,255,255,0.04)',
                color: sleep === value ? '#0A0A0A' : '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {value ? 'Yes' : 'No'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={submit}
          style={{
            width: '100%',
            padding: 16,
            borderRadius: 16,
            border: 'none',
            background: '#CCFF00',
            color: '#0A0A0A',
            fontSize: 15,
            fontWeight: 900,
            cursor: 'pointer',
          }}
        >
          Let&apos;s Go
        </button>
      </div>
    </div>
  );
}

