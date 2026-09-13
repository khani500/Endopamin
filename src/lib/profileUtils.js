export function mapGoalForSave(goal) {
  const g = String(goal || '').trim().toLowerCase();
  if (g === 'fat_loss' || g.includes('burn fat') || g.includes('lose weight')) return 'fat_loss';
  if (g === 'muscle' || g === 'muscle_gain' || g.includes('build muscle') || g.includes('gain mass')) {
    return 'muscle_gain';
  }
  if (g === 'endurance' || g.includes('athletic') || g.includes('endurance')) return 'endurance';
  if (g === 'health') return 'general_fitness';
  return g || 'fat_loss';
}
