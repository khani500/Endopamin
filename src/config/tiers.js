export const FREE_LIMITS = {
  workoutsPerWeek: 3,
  coachVoice: false,
  coachChat: false,
  nutritionTracking: 'basic',
  progressHistory: 14,
  groupSessions: false,
  shareCard: false,
  prTracker: false,
};

export const PRO_FEATURES = {
  workoutsPerWeek: Infinity,
  coachVoice: true,
  coachChat: true,
  nutritionTracking: 'full',
  progressHistory: Infinity,
  groupSessions: true,
  shareCard: true,
  prTracker: true,
};

export const FREE_COACH_MESSAGE_LIMIT = 10;

export function isProUser(profile) {
  return profile?.is_pro === true;
}
