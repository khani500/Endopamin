import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Utensils, ChevronRight } from 'lucide-react';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { MacroRings } from '../../../components/nutrition/MacroRings';
import { SupplementAdvisor } from '../../../components/nutrition/SupplementAdvisor';
import { useAuth } from '../../../context/AuthContext';
import { askGemini } from '../../../lib/gemini';
import { useNutritionStore } from '../store/nutritionStore';
import { FoodScanner } from '../components/FoodScanner';
import { MacroMatrixGrid, SmartMacroPieChart } from './NutritionScanPage';
import '../nutritionShell.css';

const MENU = [
  {
    to: '/log/overview',
    label: 'Daily Overview',
    desc: 'Calories, macros & weekly charts',
    Icon: Activity,
    iconClass: 'np-hub-icon--green',
    wide: true,
  },
  {
    to: '/log/plan',
    label: 'Meal Plan',
    desc: 'Goal-based daily meals',
    Icon: Utensils,
    iconClass: 'np-hub-icon--purple',
  },
];

export default function NutritionHub() {
  const { profile } = useAuth() || {};
  const onboardingComplete = useNutritionStore(s => Boolean(s.onboardingComplete));
  const targetCalories = useNutritionStore(s => Number(s.targetCalories) || 2200);
  const targetProtein = useNutritionStore(s => Number(s.targetProtein) || 160);
  const targetCarbs = useNutritionStore(s => Number(s.targetCarbs) || 220);
  const targetFat = useNutritionStore(s => Number(s.targetFat) || 65);
  const addFoodEntry = useNutritionStore(s => s.addFoodEntry);
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fallback = {
      headline: 'High protein day',
      breakfast: 'Oats + egg whites',
      lunch: 'Chicken + sweet potato',
      dinner: 'Salmon + rice + greens',
      snack: 'Greek yogurt + berries',
    };

    const loadPlan = async () => {
      try {
        const text = await askGemini(
          `Create a concise nutrition day plan for goal ${profile?.goal || 'strength_gain'}. Return JSON only with headline, breakfast, lunch, dinner, snack.`,
        );
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        if (!cancelled) setPlan({ ...fallback, ...parsed });
      } catch {
        if (!cancelled) setPlan(fallback);
      }
    };

    void loadPlan();
    return () => {
      cancelled = true;
    };
  }, [profile?.goal]);

  return (
    <main className="np-main">
      <div className="np-card">
        <p className="np-brand">My Nutrition Plan</p>
        <div style={{ height: 1, background: '#3f3f46', margin: '10px 0 12px' }} />
        <p className="text-sm font-black text-white">Today: {plan?.headline || 'Loading plan...'}</p>
        <div className="mt-3 space-y-1 text-xs leading-5 text-white/65">
          <p>Breakfast: {plan?.breakfast || '...'}</p>
          <p>Lunch: {plan?.lunch || '...'}</p>
          <p>Dinner: {plan?.dinner || '...'}</p>
          <p>Snack: {plan?.snack || '...'}</p>
        </div>
        <p className="mt-3 text-xs font-bold text-[#CCFF00]">
          Targets: {targetCalories} kcal | P:{targetProtein}g | C:{targetCarbs}g | F:{targetFat}g
        </p>
      </div>

      {!onboardingComplete && (
        <div className="np-card" style={{ borderColor: 'rgba(57,255,20,0.4)', background: 'rgba(57,255,20,0.08)' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#bbf7d0' }}>
            Set your nutrition goal first
          </p>
          <p className="np-muted" style={{ marginTop: 6 }}>
            Open Daily Overview to complete the quick questionnaire.
          </p>
          <Link to="/log/overview" className="np-btn-primary" style={{ marginTop: 12, textDecoration: 'none' }}>
            Start setup
          </Link>
        </div>
      )}

      {onboardingComplete && (
        <div className="np-card">
          <p className="np-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Daily target
          </p>
          <p className="np-stat-big">
            {targetCalories} <span style={{ fontSize: 16, color: '#71717a' }}>kcal</span>
          </p>
          <MacroRings />
        </div>
      )}

      <SafeNutritionBlock label="Supplement Advisor">
        <SupplementAdvisor />
      </SafeNutritionBlock>

      <SafeNutritionBlock label="Food Scanner">
        <FoodScanner
          onAnalyzed={result => {
            if (!result || typeof addFoodEntry !== 'function') return;
            addFoodEntry({
              name: result.name || result.food_name || 'Scanned meal',
              kcal: Number(result.kcal ?? result.calories) || 0,
              protein: Number(result.protein ?? result.protein_g) || 0,
              carbs: Number(result.carbs ?? result.carbs_g) || 0,
              fat: Number(result.fat ?? result.fat_g) || 0,
            });
          }}
        />
      </SafeNutritionBlock>
      <SafeNutritionBlock label="Macro Pie Chart">
        <SmartMacroPieChart />
      </SafeNutritionBlock>
      <SafeNutritionBlock label="Macro Matrix">
        <MacroMatrixGrid />
      </SafeNutritionBlock>

      <div className="np-hub-grid">
        {MENU.map(({ to, label, desc, Icon, iconClass, wide }) => (
          <Link key={to} to={to} className={`np-hub-card ${wide ? 'np-hub-card--wide' : ''}`}>
            <div className={`np-hub-icon ${iconClass}`}>
              <Icon size={22} strokeWidth={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="np-hub-label">{label}</p>
              <p className="np-hub-desc">{desc}</p>
            </div>
            {wide && <ChevronRight size={20} color="#71717a" style={{ flexShrink: 0 }} />}
          </Link>
        ))}
      </div>
    </main>
  );
}

function SafeNutritionBlock({ label, children }) {
  return (
    <ErrorBoundary
      label={label}
      fallback={
        <div className="np-card">
          <p className="np-brand">{label}</p>
          <p className="np-muted" style={{ marginTop: 8 }}>
            This nutrition section could not load on this device. The rest of Nutrition is still available.
          </p>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
