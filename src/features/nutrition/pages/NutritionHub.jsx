import { Link } from 'react-router-dom';
import { Activity, ScanLine, Utensils, Mic, ChevronRight } from 'lucide-react';
import { useNutritionStore } from '../store/nutritionStore';

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
    to: '/log/scan',
    label: 'Food Scanner',
    desc: 'Camera scan & macro estimate',
    Icon: ScanLine,
    iconClass: 'np-hub-icon--blue',
  },
  {
    to: '/log/plan',
    label: 'Meal Plan',
    desc: 'Goal-based daily meals',
    Icon: Utensils,
    iconClass: 'np-hub-icon--purple',
  },
  {
    to: '/log/coach',
    label: 'AI Voice Coach',
    desc: '24/7 voice guidance',
    Icon: Mic,
    iconClass: 'np-hub-icon--orange',
  },
];

export default function NutritionHub() {
  const onboardingComplete = useNutritionStore(s => s.onboardingComplete);
  const targetCalories = useNutritionStore(s => s.targetCalories);

  return (
    <main className="np-main">
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
        </div>
      )}

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
