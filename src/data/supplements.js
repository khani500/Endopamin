export const SUPPLEMENTS = [
  {
    id: 'creatine',
    name: 'Creatine',
    emoji: '⚡',
    tier: 1,
    goals: ['strength_gain', 'maintenance'],
    dose: { beginner: '3g daily', intermediate: '5g daily', advanced: '5g daily' },
    timing: 'Any time, daily',
  },
  {
    id: 'whey',
    name: 'Whey Protein',
    emoji: '🥛',
    tier: 1,
    goals: ['weight_loss', 'strength_gain', 'maintenance'],
    dose: { beginner: '20-25g as needed', intermediate: '25-35g post workout', advanced: '30-40g post workout' },
    timing: 'Post-workout or between meals',
  },
  {
    id: 'vitamin_d',
    name: 'Vitamin D3',
    emoji: '☀️',
    tier: 1,
    goals: ['weight_loss', 'strength_gain', 'maintenance'],
    dose: { beginner: '1000 IU daily', intermediate: '1000-2000 IU daily', advanced: '2000 IU daily' },
    timing: 'Morning with food',
  },
  {
    id: 'omega_3',
    name: 'Omega-3',
    emoji: '🐟',
    tier: 1,
    goals: ['weight_loss', 'strength_gain', 'maintenance'],
    dose: { beginner: '1g EPA/DHA daily', intermediate: '1-2g EPA/DHA daily', advanced: '2g EPA/DHA daily' },
    timing: 'With a meal',
  },
  {
    id: 'magnesium',
    name: 'Magnesium',
    emoji: '🌙',
    tier: 2,
    goals: ['strength_gain', 'maintenance'],
    dose: { beginner: '200mg nightly', intermediate: '300mg nightly', advanced: '300-400mg nightly' },
    timing: 'Night',
  },
  {
    id: 'caffeine',
    name: 'Caffeine',
    emoji: '☕',
    tier: 3,
    goals: ['weight_loss', 'strength_gain'],
    dose: { beginner: '50-100mg', intermediate: '100-200mg', advanced: '200mg' },
    timing: '30-45 min pre-workout',
  },
];

export function getSupplementsForProfile(profile = {}) {
  const safeProfile = profile || {};
  const experience = String(safeProfile.experience || 'beginner').toLowerCase();
  const goal = String(safeProfile.goal || 'strength_gain').toLowerCase().replace(/\s+/g, '_');
  const maxTier = experience === 'advanced' ? 3 : experience === 'intermediate' ? 2 : 1;
  return SUPPLEMENTS.filter(item => item.tier <= maxTier && item.goals.includes(goal));
}
