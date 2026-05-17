import { Mic2, UserRound, Volume2 } from 'lucide-react';
import { useNutritionStore } from '../store/nutritionStore';
import { GlassCard } from './GlassCard';

const TONES = [
  { id: 'motivational', label: 'Motivational', sub: 'High energy' },
  { id: 'calm', label: 'Calm', sub: 'Mindful pacing' },
  { id: 'military', label: 'Strict / drill', sub: 'Sharp commands' },
];

export function VoiceCoachSetup() {
  const coachGender = useNutritionStore(s => s.coachGender);
  const coachTone = useNutritionStore(s => s.coachTone);
  const setCoachProfile = useNutritionStore(s => s.setCoachProfile);

  return (
    <GlassCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div className="np-hub-icon np-hub-icon--coach">
          <Mic2 size={20} />
        </div>
        <div>
          <h3 style={{ margin: 0 }}>AI voice coach</h3>
          <p className="np-muted">Voice & tone for TTS / Realtime API</p>
        </div>
      </div>

      <p className="np-muted" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <UserRound size={14} /> Coach gender
      </p>
      <div className="np-grid-2" style={{ marginBottom: 14 }}>
        {['male', 'female'].map(g => (
          <button
            key={g}
            type="button"
            onClick={() => setCoachProfile({ gender: g })}
            className={`np-btn-activity ${coachGender === g ? 'np-btn-activity--on' : ''}`}
          >
            {g === 'male' ? 'Male' : 'Female'}
          </button>
        ))}
      </div>

      <p className="np-muted" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Volume2 size={14} /> Tone
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TONES.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCoachProfile({ tone: t.id })}
            className={`np-btn-goal ${coachTone === t.id ? 'np-btn-goal--on' : ''}`}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>{t.label}</span>
            <span className="np-goal-sub" style={{ margin: 0 }}>{t.sub}</span>
          </button>
        ))}
      </div>
    </GlassCard>
  );
}
