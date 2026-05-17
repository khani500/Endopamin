import { supabase } from '../lib/supabase';
import { NOTIFICATION_TEMPLATES, getAbsenceMessage } from './notificationService';

function coachDisplayName(persona) {
  return {
    elias: 'Elias',
    maya: 'Maya',
    rex: 'Rex',
  }[persona] || 'Elias';
}

export const checkUserAbsence = async (_userId, userProfile) => {
  if (!userProfile?.last_active) return null;

  const today = new Date();
  const lastActive = new Date(userProfile.last_active);
  const daysDiff = Math.floor((today - lastActive) / (1000 * 60 * 60 * 24));
  const coachName = coachDisplayName(userProfile.coach_persona);
  const userName = userProfile.display_name || 'Champion';

  if (daysDiff === 0) {
    const hour = new Date().getHours();
    if (hour >= 19 && !userProfile.workout_today) {
      return NOTIFICATION_TEMPLATES.streakRisk(userName, userProfile.streak_count || 0, coachName);
    }
  } else if (daysDiff === 1) {
    return { ...getAbsenceMessage(1, userProfile.streak_count || 0), type: 'missed_1_day' };
  } else if (daysDiff === 2) {
    return { ...getAbsenceMessage(2, userProfile.streak_count || 0), type: 'missed_2_days' };
  } else if (daysDiff === 5) {
    return { ...getAbsenceMessage(5, userProfile.streak_count || 0), type: 'missed_5_days' };
  } else if (daysDiff > 7) {
    return {
      title: `We saved your progress, ${userName}`,
      body: `Your ${userProfile.streak_count || 0}-day streak history is waiting. Let's build a new one.`,
      type: 'comeback',
    };
  }

  return null;
};

export const updateLastActive = async userId => {
  if (!supabase || !userId) return;
  await supabase
    .from('profiles')
    .update({ last_active: new Date().toISOString().split('T')[0] })
    .eq('id', userId);
};

