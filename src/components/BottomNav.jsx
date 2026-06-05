import { Link, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  {
    id: 'home',
    label: 'Home',
    path: '/',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12,3 22,11 2,11" />
        <rect x="4" y="11" width="16" height="10" rx="1.5" />
        <rect x="9.5" y="14.5" width="5" height="6.5" rx="1" className="door" />
      </svg>
    ),
  },
  {
    id: 'nutrition',
    label: 'Nutrition',
    path: '/log',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="3" x2="8" y2="9" />
        <path d="M6 3v5a2 2 0 004 0V3" />
        <line x1="8" y1="11" x2="8" y2="21" />
        <line x1="16" y1="3" x2="16" y2="21" />
        <path d="M13.5 3c0 0 2.5 1.8 2.5 5s-2.5 4.5-2.5 4.5" />
      </svg>
    ),
  },
  {
    id: 'coach',
    label: 'Coach',
    path: '/coach',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    id: 'workout',
    label: 'My Workout',
    path: '/workout-plan',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2 18 8 11 13 15 22 4" />
        <polyline points="17 4 22 4 22 9" />
      </svg>
    ),
  },
  {
    id: 'me',
    label: 'Me',
    path: '/profile',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-50"
      style={{ background: 'rgba(8,8,8,0.97)', backdropFilter: 'blur(24px)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex justify-around items-end px-1 pt-2 pb-6">
        {NAV_ITEMS.map(item => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

          return (
            <Link key={item.id} to={item.path}
              className="flex flex-col items-center gap-1 px-3 py-1 no-underline group">
              <div className="w-6 h-6"
                style={{
                  color: isActive ? '#CCFF00' : 'rgba(255,255,255,0.3)',
                  filter: isActive ? 'drop-shadow(0 0 4px rgba(204,255,0,0.6))' : 'none',
                  stroke: 'currentColor',
                  transition: 'all 0.2s',
                }}>
                {item.svg}
              </div>
              <span className="text-[9.5px] font-medium transition-all duration-200"
                style={{ color: isActive ? '#CCFF00' : 'rgba(255,255,255,0.35)' }}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute bottom-4 w-1 h-1 rounded-full bg-[#CCFF00]"
                  style={{ boxShadow: '0 0 6px rgba(204,255,0,0.8)' }} />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
