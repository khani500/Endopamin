import { NavLink } from 'react-router-dom';
import { Bot, Dumbbell, Home, TrendingUp, User } from 'lucide-react';

const BottomNav = () => {
  return (
    <nav className="fixed bottom-0 left-1/2 z-50 w-[min(390px,100vw)] -translate-x-1/2 border-t border-white/10 bg-[#050505]">
      <div className="flex w-full items-center justify-around py-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex flex-col items-center py-1 px-3 ${isActive ? 'text-[#39FF14]' : 'text-gray-400'}`
          }
        >
          <Home size={22} />
          <span className="text-xs mt-1">Home</span>
        </NavLink>

        <NavLink
          to="/coach"
          className={({ isActive }) =>
            `flex flex-col items-center py-1 px-3 ${isActive ? 'text-[#39FF14]' : 'text-gray-400'}`
          }
        >
          <Bot size={22} />
          <span className="text-xs mt-1">Coach</span>
        </NavLink>

        <NavLink
          to="/gym"
          className={({ isActive }) =>
            `flex flex-col items-center py-1 px-3 ${isActive ? 'text-[#39FF14]' : 'text-gray-400'}`
          }
        >
          <Dumbbell size={22} />
          <span className="text-xs mt-1">Gym</span>
        </NavLink>

        <NavLink
          to="/progress"
          className={({ isActive }) =>
            `flex flex-col items-center py-1 px-3 ${isActive ? 'text-[#39FF14]' : 'text-gray-400'}`
          }
        >
          <TrendingUp size={22} />
          <span className="text-xs mt-1">Progress</span>
        </NavLink>

        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `flex flex-col items-center py-1 px-3 ${isActive ? 'text-[#39FF14]' : 'text-gray-400'}`
          }
        >
          <User size={22} />
          <span className="text-xs mt-1">Me</span>
        </NavLink>
      </div>
    </nav>
  );
};

export default BottomNav;
