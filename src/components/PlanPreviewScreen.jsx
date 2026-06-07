import { useNavigate } from 'react-router-dom';
import { getCoach } from '../config/coaches';

const PLAN_PREVIEW_SEEN_KEY = 'plan_preview_seen';

export function hasSeenPlanPreview() {
  return typeof window !== 'undefined'
    && localStorage.getItem(PLAN_PREVIEW_SEEN_KEY) === 'true';
}

export function markPlanPreviewSeen() {
  localStorage.setItem(PLAN_PREVIEW_SEEN_KEY, 'true');
}

function formatDayLine(day) {
  const name = day?.day || day?.name || 'Day';
  const focus = day?.focus || (day?.type === 'rest' ? 'Rest' : 'Training');
  const label = day?.type === 'rest' ? 'Rest' : focus;
  return `${name} — ${label}`;
}

export default function PlanPreviewScreen({
  coachId,
  workoutPlan,
  nutritionPlan,
  onComplete,
}) {
  const navigate = useNavigate();
  const coach = getCoach(coachId);
  const days = (workoutPlan?.days || []).slice(0, 3);
  const calories = nutritionPlan?.daily_calories ?? null;
  const protein = nutritionPlan?.protein_g ?? null;
  const carbs = nutritionPlan?.carbs_g ?? null;
  const fat = nutritionPlan?.fat_g ?? null;

  const handleLetsGo = () => {
    markPlanPreviewSeen();
    if (onComplete) onComplete();
    navigate('/workout-plan', { replace: true });
  };

  const handleViewWorkout = () => {
    markPlanPreviewSeen();
    if (onComplete) onComplete();
    navigate('/workout-plan', { replace: true });
  };

  const handleViewNutrition = () => {
    markPlanPreviewSeen();
    if (onComplete) onComplete();
    navigate('/log/plan', { replace: true });
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: '#0A0A0A',
      color: '#fff',
      overflowY: 'auto',
      padding: '48px 24px 32px',
    }}
    >
      <div style={{ maxWidth: 400, margin: '0 auto' }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: '2px solid #CCFF00',
          margin: '0 auto 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#111',
        }}
        >
          <svg width="36" height="36" viewBox="0 0 44 44" fill="none">
            <path d="M12 22l7 7 13-14" stroke="#CCFF00" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <h1 style={{
          margin: '0 0 28px',
          textAlign: 'center',
          fontSize: 26,
          fontWeight: 900,
          letterSpacing: '-0.03em',
        }}
        >
          Your Plan is Ready!
        </h1>

        <div style={{
          background: '#111',
          border: '0.5px solid #2a2a2a',
          borderRadius: 16,
          padding: '16px',
          marginBottom: 12,
        }}
        >
          <div style={{ fontSize: 11, color: '#CCFF00', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Workout Plan
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
            {coach.name}
          </div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 14 }}>
            {coach.title} · {coach.description}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {days.length > 0 ? days.map((day, i) => (
              <div key={i} style={{ fontSize: 13, color: '#ccc' }}>
                {formatDayLine(day)}
              </div>
            )) : (
              <div style={{ fontSize: 13, color: '#888' }}>7-day personalized program</div>
            )}
          </div>
          <button
            type="button"
            onClick={handleViewWorkout}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              color: '#CCFF00',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
              fontFamily: 'inherit',
            }}
          >
            View Full Plan →
          </button>
        </div>

        <div style={{
          background: '#111',
          border: '0.5px solid #2a2a2a',
          borderRadius: 16,
          padding: '16px',
          marginBottom: 28,
        }}
        >
          <div style={{ fontSize: 11, color: '#CCFF00', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Nutrition Plan
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>
            {calories ? `${calories} kcal / day` : 'Personalized daily target'}
          </div>
          {(protein != null || carbs != null || fat != null) && (
            <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#888', marginBottom: 14 }}>
              {protein != null && <span>P {protein}g</span>}
              {carbs != null && <span>C {carbs}g</span>}
              {fat != null && <span>F {fat}g</span>}
            </div>
          )}
          <button
            type="button"
            onClick={handleViewNutrition}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              color: '#CCFF00',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
              fontFamily: 'inherit',
            }}
          >
            View Nutrition →
          </button>
        </div>

        <button
          type="button"
          onClick={handleLetsGo}
          style={{
            width: '100%',
            background: '#CCFF00',
            color: '#0A0A0A',
            border: 'none',
            borderRadius: 14,
            padding: '16px',
            fontSize: 15,
            fontWeight: 900,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          LET&apos;S GO! →
        </button>
      </div>
    </div>
  );
}
