import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkout } from '../context/WorkoutContext';
import { getCoach, resolveCoachId } from '../config/coaches';
import {
  isPlanStale,
  PLAN_VALID_DAYS,
  recommendCoachFromProfile,
  regenerateWorkoutPlan,
} from '../services/workoutPlanService';

const COACH_COLORS = {
  aria: { accent: '#CCFF00', label: 'Aria' },
  kane: { accent: '#FFA53C', label: 'Kane' },
  blaze: { accent: '#FF6B6B', label: 'Blaze' },
  nova: { accent: '#A064FF', label: 'Nova' },
  zara: { accent: '#C084FC', label: 'Zara' },
};

export default function WorkoutPlanPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { planDays, activePlan, reloadPlan } = useWorkout();
  const [generating, setGenerating] = useState(false);
  const [activeDay, setActiveDay] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const coachId = resolveCoachId(profile?.coach_persona || recommendCoachFromProfile(profile));
  const coach = getCoach(coachId);
  const { accent, label } = COACH_COLORS[coach.id] || COACH_COLORS.aria;
  const weekStart = activePlan?.week_start;
  const stale = isPlanStale(weekStart);
  const hasPlan = planDays.length > 0;

  function isRestDay(day) {
    const focus = day?.focus || '';
    return day?.type === 'rest'
      || focus.includes('Rest')
      || focus.includes('Recovery')
      || focus.includes('Mobility');
  }

  async function rebuildPlan() {
    if (!user?.id || generating) return;
    setShowConfirm(false);
    setGenerating(true);
    try {
      await regenerateWorkoutPlan(user.id, profile, coachId);
      await reloadPlan?.();
    } catch (err) {
      console.error('Rebuild plan failed:', err);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'sans-serif', paddingBottom: '100px' }}>
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '0 24px' }}>
          <div style={{ background: '#111', border: '1px solid #333', borderRadius: 20, padding: '28px 24px', maxWidth: 340, width: '100%' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>Rebuild your plan?</h3>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#888', lineHeight: 1.6 }}>
              A new plan will match your current profile — location, equipment, goal, and experience.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setShowConfirm(false)} style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', color: '#fff', borderRadius: 12, padding: '12px', fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={rebuildPlan} style={{ flex: 1, background: accent, border: 'none', color: '#000', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Rebuild
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer' }}>←</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Weekly Plan</h1>
            <p style={{ margin: 0, fontSize: 12, color: accent }}>Coach {label}</p>
          </div>
        </div>
        {hasPlan && (
          <button type="button" onClick={() => setShowConfirm(true)} disabled={generating} style={{ background: 'transparent', border: `1px solid ${accent}`, color: accent, borderRadius: 8, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>
            {generating ? '...' : '🔄 Rebuild'}
          </button>
        )}
      </div>

      <div style={{ padding: '20px 16px' }}>
        {!hasPlan ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>No active plan</h2>
            <p style={{ color: '#666', marginBottom: 32, fontSize: 14, lineHeight: 1.6 }}>
              Complete your profile or rebuild a plan matched to your current setup.
            </p>
            <button type="button" onClick={() => navigate('/profile')} style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', borderRadius: 12, padding: '12px 24px', fontSize: 14, marginRight: 8, cursor: 'pointer' }}>
              Edit Profile
            </button>
            <button type="button" onClick={rebuildPlan} disabled={generating} style={{ background: accent, color: '#000', border: 'none', borderRadius: 12, padding: '14px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              {generating ? 'Building...' : `Build with ${label}`}
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
              {weekStart ? `Week of ${weekStart}` : 'Current week'} · valid {PLAN_VALID_DAYS} days
              {stale ? ' · consider rebuilding' : ''}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {planDays.map((d, i) => {
                const isToday = d.day === new Date().toLocaleDateString('en-US', { weekday: 'long' });
                const restDay = isRestDay(d);
                return (
                  <div
                    key={d.day}
                    onClick={() => setActiveDay(activeDay === i ? null : i)}
                    style={{
                      background: isToday ? '#0d1a00' : '#111',
                      border: `1px solid ${activeDay === i ? accent : isToday ? '#3a5a00' : restDay ? '#1a1a1a' : '#222'}`,
                      borderRadius: 14,
                      padding: '14px 16px',
                      cursor: 'pointer',
                      opacity: restDay ? 0.75 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: restDay ? '#1a1a1a' : `${accent}22`, color: restDay ? '#444' : accent, fontWeight: 600 }}>
                          {restDay ? 'REST' : 'TRAIN'}
                        </span>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{d.day}{isToday ? ' · Today' : ''}</span>
                          <span style={{ color: '#555', fontSize: 12, marginLeft: 8 }}>— {d.focus}</span>
                        </div>
                      </div>
                      <span style={{ color: accent, fontSize: 14 }}>{activeDay === i ? '▲' : '▼'}</span>
                    </div>

                    {activeDay === i && d.exercises?.length > 0 && (
                      <div style={{ marginTop: 12, borderTop: '1px solid #1a1a1a', paddingTop: 12 }}>
                        {d.exercises.map((ex, j) => (
                          <div key={`${ex.name}-${j}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '4px 12px', padding: '7px 0', borderBottom: j < d.exercises.length - 1 ? '1px solid #1a1a1a' : 'none' }}>
                            <span style={{ fontSize: 13, color: '#ddd' }}>{ex.name}</span>
                            <span style={{ fontSize: 12, color: accent, fontWeight: 600 }}>{ex.sets}</span>
                            <span style={{ fontSize: 12, color: '#aaa' }}>{ex.reps}</span>
                            <span style={{ fontSize: 11, color: '#555' }}>{ex.rest}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
