import { useMemo, useState } from 'react';
import { useNutritionStore } from '../store/nutritionStore';
import { GlassCard } from '../components/GlassCard';
import { MacroRings } from '../components/MacroRings';
import { NutritionProgressCharts } from '../components/NutritionProgressCharts';
import { CalorieLogPanel } from '../components/CalorieLogPanel';
import { GoalOnboarding } from '../components/GoalOnboarding';

const proteinWeek = [
  { day: 'M', kcal: 142 },
  { day: 'T', kcal: 138 },
  { day: 'W', kcal: 155 },
  { day: 'T', kcal: 148 },
  { day: 'F', kcal: 160 },
  { day: 'S', kcal: 132 },
  { day: 'S', kcal: 145 },
];

export default function NutritionOverviewPage() {
  const [onboardKey, setOnboardKey] = useState(0);
  const foodLog = useNutritionStore(s => s.foodLog);
  const targetCalories = useNutritionStore(s => s.targetCalories);
  const targetProtein = useNutritionStore(s => s.targetProtein);
  const targetCarbs = useNutritionStore(s => s.targetCarbs);
  const targetFat = useNutritionStore(s => s.targetFat);
  const onboardingComplete = useNutritionStore(s => s.onboardingComplete);
  const resetOnboarding = useNutritionStore(s => s.resetOnboarding);

  const today = useMemo(() => new Date().toDateString(), []);

  const todayTotals = useMemo(() => {
    return foodLog
      .filter(e => new Date(e.at).toDateString() === today)
      .reduce(
        (a, e) => ({
          kcal: a.kcal + e.kcal,
          protein: a.protein + e.protein,
          carbs: a.carbs + e.carbs,
          fat: a.fat + e.fat,
        }),
        { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      );
  }, [foodLog, today]);

  return (
    <main className="np-main">
      {onboardingComplete && (
        <button type="button" className="np-back" onClick={() => { resetOnboarding(); setOnboardKey(k => k + 1); }}>
          Edit goal
        </button>
      )}

      {!onboardingComplete && (
        <GoalOnboarding
          key={onboardKey}
          onDone={() => {
            setOnboardKey(k => k + 1);
          }}
        />
      )}

      {onboardingComplete && (
        <>
          <GlassCard>
            <div className="np-row-between">
              <div>
                <p className="np-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  Today&apos;s calories
                </p>
                <p className="np-stat-big">
                  {Math.round(todayTotals.kcal)}
                  <span style={{ fontSize: 16, fontWeight: 600, color: '#71717a' }}> / {targetCalories}</span>
                </p>
              </div>
              <span className="np-badge">On track</span>
            </div>
            <MacroRings
              protein={todayTotals.protein}
              carbs={todayTotals.carbs}
              fat={todayTotals.fat}
              targetProtein={targetProtein}
              targetCarbs={targetCarbs}
              targetFat={targetFat}
            />
          </GlassCard>

          <GlassCard>
            <NutritionProgressCharts title="Weekly calories" />
          </GlassCard>

          <GlassCard>
            <NutritionProgressCharts title="Weekly protein (g)" series={proteinWeek} targetLine={targetProtein} />
          </GlassCard>

          <CalorieLogPanel />
        </>
      )}
    </main>
  );
}
