import { Link, Outlet, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import './nutritionShell.css';

const PAGE_TITLES = {
  '/log': 'Nutrition Hub',
  '/log/overview': 'Daily Overview',
  '/log/scan': 'Food Scanner',
  '/log/plan': 'Meal Plan',
};

export default function NutritionLayout() {
  const { pathname } = useLocation();
  const isHub = pathname === '/log' || pathname === '/log/' || pathname === '/nutrition' || pathname === '/nutrition/';
  const title = PAGE_TITLES[pathname] ?? 'Nutrition';

  return (
    <div className="np-root">
      <div className="np-accent-bar" aria-hidden="true" />
      <header className="np-header">
        <div className="np-header-row">
          <Link to={isHub ? '/' : '/log'} className="np-back">
            <ChevronLeft size={18} />
            {isHub ? 'Home' : 'Nutrition'}
          </Link>
        </div>
        <p className="np-brand">Dopa Peak</p>
        <h1 className="np-title">{title}</h1>
        {!isHub && <p className="np-subtitle">Smart nutrition & AI coaching</p>}
      </header>
      <Outlet />
    </div>
  );
}
