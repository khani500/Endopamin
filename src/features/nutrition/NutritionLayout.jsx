import { Outlet } from 'react-router-dom';
import './nutritionShell.css';

export default function NutritionLayout() {
  return (
    <div className="np-root">
      <div className="np-accent-bar" aria-hidden="true" />
      <Outlet />
    </div>
  );
}
