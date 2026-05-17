import { NavLink } from 'react-router-dom';
import { useLocation } from 'react-router-dom';

function NavIcon({ type, active }) {
  const color = active ? '#CCFF00' : '#8A8A8A';
  const common = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };

  return (
    <svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true">
      {type === 'home' && (
        <>
          <path {...common} d="M4 10.8 12 4l8 6.8" />
          <path {...common} d="M6.5 10.5V20h11v-9.5" />
          <path {...common} d="M10 20v-5.2h4V20" />
        </>
      )}
      {type === 'nutrition' && (
        <>
          <path {...common} d="M7 3v8M5 3v8M9 3v8M5 11h4M7 11v10" />
          <path {...common} d="M16 3c2 2 2.5 5.2 0 7.4V21M16 3v18" />
        </>
      )}
      {type === 'coach' && (
        <>
          <rect x="5" y="7" width="14" height="11" rx="4" stroke={color} strokeWidth="1.8" fill="none" />
          <path {...common} d="M12 7V4" />
          <circle cx="9" cy="12" r="1.1" fill={color} />
          <circle cx="15" cy="12" r="1.1" fill={color} />
          <path {...common} d="M9.5 16h5" />
        </>
      )}
      {type === 'progress' && (
        <>
          <path {...common} d="M4 18h16" />
          <path {...common} d="M5 15l4-4 3 3 6-7" />
          <path {...common} d="M16 7h2v2" />
        </>
      )}
      {type === 'me' && (
        <>
          <circle cx="12" cy="8" r="3.2" stroke={color} strokeWidth="1.8" fill="none" />
          <path {...common} d="M5.5 20c.9-4 3.2-6 6.5-6s5.6 2 6.5 6" />
        </>
      )}
    </svg>
  );
}

const tabs = [
  { to: '/', label: 'Home', type: 'home', end: true },
  { to: '/log', label: 'Nutrition', type: 'nutrition', end: true },
  { to: '/coach', label: 'Coach', type: 'coach' },
  { to: '/progress', label: 'Progress', type: 'progress' },
  { to: '/profile', label: 'Me', type: 'me' },
];

const BottomNav = () => {
  const { pathname } = useLocation();
  const isTabActive = (tab, isActive) => {
    if (tab.type === 'nutrition') return isActive || pathname.startsWith('/log');
    return isActive;
  };

  return (
    <nav className="fixed bottom-0 left-1/2 z-50 h-16 w-[min(430px,100vw)] -translate-x-1/2 rounded-t-[22px] border border-[#CCFF00]/25 bg-[#050505]/95 shadow-2xl shadow-black/60 backdrop-blur">
      <div className="flex h-full w-full items-center justify-around px-2">
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex min-w-[58px] flex-col items-center rounded-2xl px-2 py-1.5 transition-all ${
                isTabActive(tab, isActive)
                  ? 'bg-[#CCFF00]/10 text-[#CCFF00]'
                  : 'text-gray-400'
              }`
            }
          >
            {({ isActive }) => {
              const active = isTabActive(tab, isActive);
              return (
                <>
                  <NavIcon type={tab.type} active={active} />
                  <span className="mt-1 text-[10px] font-bold">{tab.label}</span>
                </>
              );
            }}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;
