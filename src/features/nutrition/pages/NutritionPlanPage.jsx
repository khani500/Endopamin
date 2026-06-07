import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import { getNutritionPlanSubtitle, normalizeNutritionGoal } from '../lib/nutritionPlanSubtitle';
import '../nutritionShell.css';

const MEAL_COLORS = ['#FFB800', '#22C55E', '#818CF8', '#FF6B00', '#CCFF00', '#5088FF'];
const PLAN_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'meals', label: 'Meals' },
];

function formatFoods(foods) {
  if (!Array.isArray(foods) || foods.length === 0) return null;
  return foods.filter(Boolean).join(' · ');
}

const GOAL_COACH_NOTES = {
  muscle_gain: [
    'Consume 1.6-2.2g protein/kg bodyweight (ISSN 2017)',
    'Caloric surplus of 300-500 kcal supports lean mass gain',
    'Distribute protein across 4+ meals for optimal MPS',
    'Post-workout: 20-40g protein within 2 hours (ACSM)',
  ],
  fat_loss: [
    'Moderate deficit of 500 kcal/day for 0.5kg/week loss',
    'High protein (1.8-2.0g/kg) preserves muscle during deficit',
    'Prioritize whole foods and fiber for satiety',
    'Hydrate 2.5-3L daily, especially around training',
  ],
  maintain: [
    'Carb timing around training improves performance',
    '1.2-1.6g protein/kg for endurance athletes (ACSM)',
    'Replenish glycogen within 30min post-workout',
    'Consistent hydration: 500ml pre-workout minimum',
  ],
};

function getCoachNoteBullets(profile) {
  const goal = normalizeNutritionGoal(profile?.goal);
  if (goal === 'fat_loss') return GOAL_COACH_NOTES.fat_loss;
  if (goal === 'muscle_gain') return GOAL_COACH_NOTES.muscle_gain;
  return GOAL_COACH_NOTES.maintain;
}

function MealCard({ meal, index }) {
  const color = MEAL_COLORS[index % MEAL_COLORS.length];
  const foods = formatFoods(meal.foods);

  return (
    <div
      className="np-card"
      style={{ borderColor: `${color}33` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: foods ? 10 : 8 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {meal.name || `Meal ${index + 1}`}
          </p>
          {meal.time && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>{meal.time}</p>
          )}
        </div>
        {meal.calories != null && (
          <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#CCFF00', flexShrink: 0 }}>
            {meal.calories} kcal
          </p>
        )}
      </div>

      {foods && (
        <p style={{ margin: '0 0 10px', fontSize: 14, color: '#e4e4e7', lineHeight: 1.5, fontWeight: 500 }}>
          {foods}
        </p>
      )}

      {(meal.protein_g != null || meal.carbs_g != null || meal.fat_g != null) && (
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#888', flexWrap: 'wrap' }}>
          {meal.protein_g != null && (
            <span><span style={{ color: '#aaa', fontWeight: 600 }}>P</span> {meal.protein_g}g</span>
          )}
          {meal.carbs_g != null && (
            <span><span style={{ color: '#aaa', fontWeight: 600 }}>C</span> {meal.carbs_g}g</span>
          )}
          {meal.fat_g != null && (
            <span><span style={{ color: '#aaa', fontWeight: 600 }}>F</span> {meal.fat_g}g</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function NutritionPlanPage() {
  const { user, profile } = useAuth();
  const [planData, setPlanData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    let cancelled = false;

    async function loadPlan() {
      if (!user?.id || !supabase) {
        if (!cancelled) {
          setLoading(false);
          setError('Sign in to view your nutrition plan.');
        }
        return;
      }

      setLoading(true);
      setError('');

      const { data, error: queryError } = await supabase
        .from('nutrition_plans')
        .select('plan_data')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (queryError) {
        console.error('Failed to load nutrition plan:', queryError);
        setError('Could not load your nutrition plan. Try again later.');
        setPlanData(null);
      } else {
        setPlanData(data?.plan_data ?? null);
      }

      setLoading(false);
    }

    void loadPlan();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const calories = planData?.daily_calories ?? null;
  const protein = planData?.protein_g ?? null;
  const carbs = planData?.carbs_g ?? null;
  const fat = planData?.fat_g ?? null;
  const meals = Array.isArray(planData?.meals) ? planData.meals : [];
  const waterGlasses = planData?.water_glasses ?? null;
  const planSubtitle = getNutritionPlanSubtitle(profile?.goal, meals.length);
  const coachNotes = useMemo(
    () => getCoachNoteBullets(profile),
    [profile],
  );

  return (
    <main className="np-main" style={{ minHeight: '100vh', background: '#080808', color: '#fff', paddingTop: 56 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: '#CCFF00', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
            Nutrition Plan
          </p>
          <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em' }}>
            Your Daily Targets
          </h1>
        </div>
        <Link
          to="/"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px solid #333',
            background: '#111',
            color: '#888',
            fontSize: 18,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textDecoration: 'none',
          }}
          aria-label="Back to home"
        >
          ×
        </Link>
      </div>

      {loading && (
        <div className="np-card" style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#888' }}>Loading your nutrition plan...</p>
        </div>
      )}

      {!loading && error && (
        <div className="np-card" style={{ borderColor: 'rgba(255,100,100,0.3)', background: 'rgba(255,100,100,0.06)' }}>
          <p style={{ margin: 0, fontSize: 14, color: '#fca5a5' }}>{error}</p>
        </div>
      )}

      {!loading && !error && !planData && (
        <div className="np-card">
          <p style={{ margin: '0 0 12px', fontSize: 14, color: '#e4e4e7' }}>
            No active nutrition plan yet. Complete onboarding or update your profile to generate one.
          </p>
          <Link to="/profile" className="np-btn-primary" style={{ textDecoration: 'none', textAlign: 'center', display: 'block' }}>
            Update Profile
          </Link>
        </div>
      )}

      {!loading && !error && planData && (
        <>
          <div style={{
            display: 'flex',
            gap: 6,
            padding: 4,
            borderRadius: 16,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 4,
          }}
          >
            {PLAN_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: activeTab === tab.id ? '1px solid rgba(204,255,0,0.25)' : '1px solid transparent',
                  background: activeTab === tab.id ? 'rgba(204,255,0,0.1)' : 'transparent',
                  color: activeTab === tab.id ? '#CCFF00' : 'rgba(255,255,255,0.3)',
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <>
              <div className="np-card">
                <p style={{ margin: '0 0 8px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                  Daily Macros
                </p>
                <p style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 900, color: '#CCFF00' }}>
                  {calories ? `${calories} kcal` : '—'}
                </p>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: '#888' }}>
                  {planSubtitle}
                </p>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {protein != null && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Protein</p>
                      <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800 }}>{protein}g</p>
                    </div>
                  )}
                  {carbs != null && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Carbs</p>
                      <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800 }}>{carbs}g</p>
                    </div>
                  )}
                  {fat != null && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Fat</p>
                      <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800 }}>{fat}g</p>
                    </div>
                  )}
                  {waterGlasses != null && (
                    <div>
                      <p style={{ margin: 0, fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Water</p>
                      <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800 }}>{waterGlasses} glasses</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="np-card">
                <p style={{ margin: '0 0 12px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                  Coach Notes
                </p>
                <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {coachNotes.map((note, index) => (
                    <li key={index} style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
                      {note}
                    </li>
                  ))}
                </ul>
              </div>

              {meals.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 10px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                    Planned Meals
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {meals.map((meal, index) => (
                      <MealCard key={`${meal.name || 'meal'}-${index}`} meal={meal} index={index} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'meals' && (
            <div>
              {meals.length === 0 ? (
                <div className="np-card">
                  <p style={{ margin: 0, fontSize: 13, color: '#888' }}>No meals in this plan yet.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {meals.map((meal, index) => (
                    <MealCard key={`${meal.name || 'meal'}-${index}`} meal={meal} index={index} />
                  ))}
                </div>
              )}
            </div>
          )}

          <Link to="/log" className="np-btn-primary" style={{ textDecoration: 'none', textAlign: 'center' }}>
            Track Daily Nutrition
          </Link>
        </>
      )}
    </main>
  );
}
