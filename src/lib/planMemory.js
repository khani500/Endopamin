import { supabase } from './supabase';

export async function getPlanProgressSummary(userId) {
  try {
    const { data: plans } = await supabase
      .from('workout_plans')
      .select('plan_data, generated_at, week_start')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
      .limit(3);

    if (!plans || plans.length === 0) return null;

    const { data: logs } = await supabase
      .from('workout_logs')
      .select('completed_at, exercise_name, sets_completed, notes')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(30);

    const { data: checkins } = await supabase
      .from('daily_checkins')
      .select('date, mood, energy_level, notes')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(7);

    const lastPlan = plans[0];
    const totalDays = lastPlan?.plan_data?.days?.filter(d => d.type !== 'rest').length || 5;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentLogs = logs?.filter(l => new Date(l.completed_at) > oneWeekAgo) || [];
    const completedDays = recentLogs.length;
    const completionRate = Math.round((completedDays / totalDays) * 100);

    const avgMood = checkins?.length
      ? Math.round(checkins.reduce((s, c) => s + (c.mood || 3), 0) / checkins.length)
      : null;

    const avgEnergy = checkins?.length
      ? Math.round(checkins.reduce((s, c) => s + (c.energy_level || 3), 0) / checkins.length)
      : null;

    const recentNotes = checkins
      ?.filter(c => c.notes)
      .slice(0, 3)
      .map(c => c.notes)
      .join('. ') || null;

    const muscleCount = {};
    recentLogs.forEach(log => {
      if (log.exercise_name) {
        muscleCount[log.exercise_name] = (muscleCount[log.exercise_name] || 0) + 1;
      }
    });

    const mostTrained = Object.entries(muscleCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    const plannedExercises = lastPlan?.plan_data?.days
      ?.flatMap(d => d.exercises?.map(e => e.name) || []) || [];

    const skipped = plannedExercises.filter(
      name => !recentLogs.find(l => l.exercise_name === name)
    ).slice(0, 3);

    return {
      weeksTracked: plans.length,
      lastWeekCompletion: `${completedDays}/${totalDays} days (${completionRate}%)`,
      mostTrainedExercises: mostTrained,
      skippedExercises: skipped,
      avgMood: avgMood ? `${avgMood}/5` : null,
      avgEnergy: avgEnergy ? `${avgEnergy}/5` : null,
      recentNotes,
    };
  } catch (e) {
    console.error('planMemory error:', e);
    return null;
  }
}

export function buildProgressPrompt(summary) {
  if (!summary) return '';

  const lines = [
    '--- USER PROGRESS HISTORY ---',
    `Weeks tracked: ${summary.weeksTracked}`,
    `Last week completion: ${summary.lastWeekCompletion}`,
  ];

  if (summary.mostTrainedExercises?.length)
    lines.push(`Most trained: ${summary.mostTrainedExercises.join(', ')}`);

  if (summary.skippedExercises?.length)
    lines.push(`Tends to skip: ${summary.skippedExercises.join(', ')} — avoid overloading these`);

  if (summary.avgMood)
    lines.push(`Avg mood: ${summary.avgMood}`);

  if (summary.avgEnergy)
    lines.push(`Avg energy: ${summary.avgEnergy}`);

  if (summary.recentNotes)
    lines.push(`User notes: "${summary.recentNotes}"`);

  lines.push('Use this data to make the new plan smarter — adjust volume, swap skipped exercises, and match energy levels.');
  lines.push('--- END HISTORY ---');

  return lines.join('\n');
}
