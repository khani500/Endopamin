import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNutritionStore } from '../store/nutritionStore';
import { GoalOnboarding } from '../components/GoalOnboarding';
import { MealPlanSuggestions } from '../components/MealPlanSuggestions';

export default function NutritionPlanPage() {
  const [onboardKey, setOnboardKey] = useState(0);
  const onboardingComplete = useNutritionStore(s => s.onboardingComplete);

  return (
    <main className="np-main">
      {!onboardingComplete && (
        <>
          <div className="np-card">
            <p style={{ margin: 0, fontSize: 13, color: '#e4e4e7' }}>Complete your goal setup to unlock meal plans.</p>
          </div>
          <GoalOnboarding key={onboardKey} onDone={() => setOnboardKey(k => k + 1)} />
        </>
      )}
      {onboardingComplete && <MealPlanSuggestions />}
      {!onboardingComplete && (
        <Link to="/log/overview" className="np-btn-primary" style={{ textDecoration: 'none', textAlign: 'center' }}>
          Go to Daily Overview
        </Link>
      )}
    </main>
  );
}
