import { useLocation, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/', icon: '🏠', label: 'Home' },
  { path: '/log', icon: '🥗', label: 'Nutrition' },
  { path: '/coach', icon: '🤖', label: 'Coach' },
  { path: '/progress', icon: '📈', label: 'Progress' },
  { path: '/profile', icon: '👤', label: 'Me' },
];

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActivePath = path => {
    if (path === '/') return location.pathname === '/';
    if (path === '/log') return location.pathname.startsWith('/log') || location.pathname.startsWith('/nutrition');
    return location.pathname === path;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#1a1a1a] bg-[#111] pb-safe">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around">
        {NAV_ITEMS.map(item => {
          const active = isActivePath(item.path);
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className="relative flex h-full flex-1 flex-col items-center justify-center gap-1"
            >
              <span className={`text-2xl transition-transform ${active ? 'scale-110' : 'scale-100'}`}>
                {item.icon}
              </span>
              <span className={`text-[10px] font-medium ${active ? 'text-[#CCFF00]' : 'text-gray-500'}`}>
                {item.label}
              </span>
              {active && <div className="absolute bottom-0 h-0.5 w-8 rounded-full bg-[#CCFF00]" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
