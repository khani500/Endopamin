import { UtensilsCrossed } from 'lucide-react';
import { useMemo } from 'react';
import { useNutritionStore } from '../store/nutritionStore';
import { GlassCard } from './GlassCard';

function buildLocalPlan({ goal, kcal, protein, carbs, fat, mealsPerDay }) {
  const slots =
    mealsPerDay >= 5
      ? ['Breakfast', 'Snack 1', 'Lunch', 'Snack 2', 'Dinner']
      : mealsPerDay === 4
        ? ['Breakfast', 'Lunch', 'Snack', 'Dinner']
        : ['Breakfast', 'Lunch', 'Dinner'];

  const pShare = protein / mealsPerDay;
  const cShare = carbs / mealsPerDay;
  const fShare = fat / mealsPerDay;
  const kShare = kcal / mealsPerDay;

  const bias =
    goal === 'cut'
      ? 'Lower carbs, higher fiber'
      : goal === 'bulk'
        ? 'More carbs & protein post-workout'
        : 'Stable energy balance';

  return slots.slice(0, mealsPerDay).map((slot, i) => ({
    slot,
    title:
      i === 0
        ? 'High-protein breakfast + complex carbs'
        : i === slots.length - 1
          ? 'Light dinner with omega-3s'
          : 'Balanced plate + vegetables',
    kcal: Math.round(kShare + (i % 2) * 40 - 20),
    protein: Math.round(pShare),
    carbs: Math.round(cShare + (goal === 'bulk' ? 15 : 0)),
    fat: Math.round(fShare),
    notes: i === 1 ? bias : undefined,
  }));
}

export function MealPlanSuggestions() {
  const goal = useNutritionStore(s => s.goal);
  const mealsPerDay = useNutritionStore(s => s.mealsPerDay);
  const targetCalories = useNutritionStore(s => s.targetCalories);
  const targetProtein = useNutritionStore(s => s.targetProtein);
  const targetCarbs = useNutritionStore(s => s.targetCarbs);
  const targetFat = useNutritionStore(s => s.targetFat);

  const meals = useMemo(
    () =>
      buildLocalPlan({
        goal,
        kcal: targetCalories,
        protein: targetProtein,
        carbs: targetCarbs,
        fat: targetFat,
        mealsPerDay,
      }),
    [goal, mealsPerDay, targetCalories, targetProtein, targetCarbs, targetFat],
  );

  return (
    <GlassCard>
      <div className="np-row-between" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UtensilsCrossed size={20} color="#a78bfa" />
          <h3 style={{ margin: 0 }}>Today&apos;s suggestions</h3>
        </div>
        <span className="np-muted" style={{ textTransform: 'uppercase' }}>Goal: {goal}</span>
      </div>
      <ul className="np-list" style={{ maxHeight: 'none' }}>
        {meals.map((m, idx) => (
          <li key={idx} className="np-list-item">
            <div>
              <p style={{ color: '#39ff14', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px' }}>
                {m.slot}
              </p>
              <p style={{ margin: 0, fontSize: 14 }}>{m.title}</p>
              {m.notes && <small style={{ display: 'block', marginTop: 4 }}>{m.notes}</small>}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#fff' }}>{m.kcal} kcal</p>
              <small>
                P{m.protein} · C{m.carbs} · F{m.fat}
              </small>
            </div>
          </li>
        ))}
      </ul>
      <p className="np-hint" style={{ marginTop: 10 }}>
        API: fetchMealPlan in nutritionApi.js
      </p>
    </GlassCard>
  );
}
