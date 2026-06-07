import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import '../nutritionShell.css';

const MEAL_COLORS = ['#FFB800', '#22C55E', '#818CF8', '#FF6B00', '#CCFF00', '#5088FF'];

function formatFoods(foods) {
  if (!Array.isArray(foods) || foods.length === 0) return null;
  return foods.join(' · ');
}

export default function NutritionPlanPage() {
  const { user } = useAuth();
  const [planData, setPlanData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
  const notes = planData?.notes ?? '';

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
          <div className="np-card">
            <p style={{ margin: '0 0 8px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
              Daily Macros
            </p>
            <p style={{ margin: '0 0 14px', fontSize: 28, fontWeight: 900, color: '#CCFF00' }}>
              {calories ? `${calories} kcal` : '—'}
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

          <div>
            <p style={{ margin: '0 0 10px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
              Meals
            </p>
            {meals.length === 0 ? (
              <div className="np-card">
                <p style={{ margin: 0, fontSize: 13, color: '#888' }}>No meals in this plan yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {meals.map((meal, index) => {
                  const color = MEAL_COLORS[index % MEAL_COLORS.length];
                  const foods = formatFoods(meal.foods);
                  return (
                    <div
                      key={`${meal.name || 'meal'}-${index}`}
                      className="np-card"
                      style={{ borderColor: `${color}33` }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: foods ? 8 : 0 }}>
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
                        <p style={{ margin: '0 0 10px', fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{foods}</p>
                      )}

                      {(meal.protein_g != null || meal.carbs_g != null || meal.fat_g != null) && (
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#888' }}>
                          {meal.protein_g != null && <span>P {meal.protein_g}g</span>}
                          {meal.carbs_g != null && <span>C {meal.carbs_g}g</span>}
                          {meal.fat_g != null && <span>F {meal.fat_g}g</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {notes && (
            <div className="np-card">
              <p style={{ margin: '0 0 6px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                Coach Notes
              </p>
              <p style={{ margin: 0, fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>{notes}</p>
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
