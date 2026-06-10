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
    id: 'progress',
    label: 'Progress',
    path: '/progress',
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
    <nav
      aria-label="Main navigation"
      className="fixed left-1/2 z-50 -translate-x-1/2"
      style={{
        bottom: 'max(20px, env(safe-area-inset-bottom, 0px))',
        width: 'min(calc(100vw - 40px), 390px)',
      }}
    >
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[35px] bg-black/35"
          style={{
            boxShadow: '0 10px 18px rgba(0,0,0,0.45), 0 4px 24px rgba(0,0,0,0.35)',
          }}
        />
        <div
          className="relative flex items-center justify-between rounded-[35px] border border-white/[0.08] px-2.5 py-2"
          style={{
            background: 'rgba(18,18,18,0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {NAV_ITEMS.map((item) => {
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);

            return (
              <Link
                key={item.id}
                to={item.path}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className="relative flex flex-1 items-center justify-center no-underline"
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 ${
                    isActive ? 'bg-white shadow-[0_2px_6px_rgba(255,255,255,0.25)]' : ''
                  }`}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center transition-colors duration-200 [&_svg]:h-full [&_svg]:w-full [&_svg]:stroke-current"
                    style={{
                      color: isActive ? '#000000' : 'rgba(255,255,255,0.45)',
                    }}
                  >
                    {item.svg}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
