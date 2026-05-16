import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { estimateDailyTargets } from '../lib/macroTargets';
import { useNutritionStore } from '../store/nutritionStore';
import { GlassCard } from './GlassCard';

const GOALS = [
  { id: 'cut', label: 'Lose fat', sub: 'Controlled calorie deficit' },
  { id: 'bulk', label: 'Build muscle', sub: 'Gradual lean bulk' },
  { id: 'maintain', label: 'Maintain weight', sub: 'Stable body composition' },
];

const ACTIVITY = [
  { id: 'sedentary', label: 'Sedentary' },
  { id: 'light', label: 'Light' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'active', label: 'Active' },
  { id: 'athlete', label: 'Athlete' },
];

/**
 * Goal questionnaire — persists targets into nutrition store (API can mirror later).
 */
export function GoalOnboarding({ onDone }) {
  const setGoalProfile = useNutritionStore(s => s.setGoalProfile);
  const completeOnboarding = useNutritionStore(s => s.completeOnboarding);
  const skipOnboardingWithDefaults = useNutritionStore(s => s.skipOnboardingWithDefaults);

  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState('maintain');
  const [activity, setActivity] = useState('moderate');
  const [currentWeightKg, setCurrentWeightKg] = useState(78);
  const [targetWeightKg, setTargetWeightKg] = useState('');
  const [mealsPerDay, setMealsPerDay] = useState(4);

  const finish = () => {
    const targets = estimateDailyTargets({ goal, activity, currentWeightKg });
    setGoalProfile({
      goal,
      activity,
      currentWeightKg,
      targetWeightKg: targetWeightKg === '' ? null : Number(targetWeightKg),
      mealsPerDay,
      ...targets,
    });
    completeOnboarding();
    onDone?.();
  };

  const handleSkip = () => {
    skipOnboardingWithDefaults({
      goal,
      activity,
      currentWeightKg,
      mealsPerDay,
      targetWeightKg: targetWeightKg === '' ? null : Number(targetWeightKg),
    });
    onDone?.();
  };

  return (
    <GlassCard className="space-y-5">
      <button type="button" className="np-skip" onClick={handleSkip}>
        Continue with defaults (skip questionnaire)
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Sparkles style={{ width: 20, height: 20, color: '#39ff14', flexShrink: 0 }} />
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#fafafa' }}>Your nutrition goal</h2>
          <p className="np-muted" style={{ marginTop: 4 }}>A few quick steps — sync with API later.</p>
        </div>
      </div>

      <div className="np-progress">
        {[0, 1, 2].map(i => (
          <div key={i} className={step >= i ? 'is-on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#d4d4d8' }}>Primary goal</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {GOALS.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGoal(g.id)}
                className={`np-btn-goal ${goal === g.id ? 'np-btn-goal--on' : ''}`}
              >
                {g.label}
                <span className="np-goal-sub">{g.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#d4d4d8' }}>Activity level</p>
          <div className="np-grid-2">
            {ACTIVITY.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => setActivity(a.id)}
                className={`np-btn-activity ${activity === a.id ? 'np-btn-activity--on' : ''}`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa' }}>
            Current weight (kg)
            <input
              type="number"
              min={30}
              max={200}
              value={currentWeightKg}
              onChange={e => setCurrentWeightKg(Number(e.target.value))}
              className="np-input"
            />
          </label>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa' }}>
            Goal weight (optional)
            <input
              type="number"
              placeholder="e.g. 72"
              value={targetWeightKg}
              onChange={e => setTargetWeightKg(e.target.value)}
              className="np-input"
            />
          </label>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#d4d4d8' }}>Meals per day</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setMealsPerDay(n)}
                className={`np-btn-activity ${mealsPerDay === n ? 'np-btn-activity--on' : ''}`}
                style={{ flex: 1 }}
              >
                {n}
              </button>
            ))}
          </div>
          <div
            style={{
              borderRadius: 12,
              border: '1px solid rgba(57,255,20,0.35)',
              background: 'rgba(57,255,20,0.1)',
              padding: 12,
              fontSize: 13,
              color: '#e4e4e7',
            }}
          >
            Target preview (estimated):{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#39ff14' }}>
              {(() => {
                const t = estimateDailyTargets({ goal, activity, currentWeightKg });
                return `${t.targetCalories} kcal · P${t.targetProtein} · C${t.targetCarbs} · F${t.targetFat}`;
              })()}
            </span>
          </div>
        </div>
      )}

      <div className="np-footer-btns">
        {step > 0 && (
          <button type="button" className="np-btn-secondary" onClick={() => setStep(s => s - 1)}>
            Back
          </button>
        )}
        {step < 2 ? (
          <button type="button" className="np-btn-primary" onClick={() => setStep(s => s + 1)}>
            Next
            <ChevronRight style={{ width: 16, height: 16 }} />
          </button>
        ) : (
          <button type="button" className="np-btn-primary" onClick={finish}>
            Save & start
            <Sparkles style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>
    </GlassCard>
  );
}
