import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { sendNotification } from '../services/notificationService';

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 60, 100];

export const useStreak = () => {
  const { user, profile, setProfile } = useAuth();

  const updateStreak = async () => {
    if (!user || !profile) return null;

    const today = new Date().toISOString().split('T')[0];
    const lastActive = profile.last_active;
    let newStreak = profile.streak_count || 0;

    if (lastActive === today) return null;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (lastActive === yesterdayStr) {
      newStreak += 1;
    } else {
      newStreak = 1;
    }

    const xpGained = 50 + newStreak * 5;
    const newXP = (profile.dopa_xp || 0) + xpGained;
    const xpPerLevel = 500;
    const newLevel = Math.floor(newXP / xpPerLevel) + 1;

    if (supabase) {
      await supabase
        .from('profiles')
        .update({
          streak_count: newStreak,
          last_active: today,
          dopa_xp: newXP,
          dopa_level: newLevel,
        })
        .eq('id', user.id);
    }

    setProfile(prev => ({
      ...prev,
      streak_count: newStreak,
      last_active: today,
      dopa_xp: newXP,
      dopa_level: newLevel,
    }));

    if (STREAK_MILESTONES.includes(newStreak)) {
      sendNotification(
        `🏆 ${newStreak}-Day Streak!`,
        newStreak === 7 ? 'One week strong!' : newStreak === 30 ? 'ONE MONTH! You are ELITE!' : 'Keep going champion!',
      );
    }

    return { newStreak, xpGained, newLevel };
  };

  return { updateStreak };
};
