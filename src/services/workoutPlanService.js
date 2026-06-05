import { supabase } from '../lib/supabase';
import { generateWorkoutPlan } from '../lib/gemini';
import { resolveCoachId } from '../config/coaches';

const PLAN_PROFILE_KEYS = ['location', 'equipment', 'goal', 'experience', 'injuries', 'session_duration'];

const GYM_FALLBACK = coachId => ({
  coachId,
  days: [
    { day: 'Monday', focus: 'Push — Chest & Shoulders', type: 'training', exercises: [{ name: 'Bench Press', sets: '3', reps: '10', rest: '90s' }, { name: 'Overhead Press', sets: '3', reps: '10', rest: '75s' }, { name: 'Tricep Pushdown', sets: '3', reps: '12', rest: '60s' }] },
    { day: 'Tuesday', focus: 'Pull — Back & Biceps', type: 'training', exercises: [{ name: 'Lat Pulldown', sets: '3', reps: '10', rest: '90s' }, { name: 'Cable Row', sets: '3', reps: '12', rest: '75s' }, { name: 'Dumbbell Curl', sets: '3', reps: '12', rest: '60s' }] },
    { day: 'Wednesday', focus: 'Active Recovery', type: 'rest', exercises: [{ name: '20 min walk', sets: '-', reps: '-', rest: '-' }] },
    { day: 'Thursday', focus: 'Upper Body — Full Upper Body Focus', type: 'training', exercises: [{ name: 'Incline Dumbbell Press', sets: '3', reps: '10', rest: '75s' }, { name: 'Face Pull', sets: '3', reps: '15', rest: '45s' }, { name: 'Lateral Raise', sets: '3', reps: '12', rest: '45s' }] },
    { day: 'Friday', focus: 'Legs — Quads & Glutes', type: 'training', exercises: [{ name: 'Leg Press', sets: '4', reps: '10', rest: '90s' }, { name: 'Romanian Deadlift', sets: '3', reps: '10', rest: '90s' }, { name: 'Calf Raise', sets: '3', reps: '15', rest: '45s' }] },
    { day: 'Saturday', focus: 'Core + Conditioning', type: 'training', exercises: [{ name: 'Plank', sets: '3', reps: '45s', rest: '45s' }, { name: 'Cable Crunch', sets: '3', reps: '15', rest: '45s' }] },
    { day: 'Sunday', focus: 'Full Rest', type: 'rest', exercises: [{ name: 'Recovery', sets: '-', reps: '-', rest: '-' }] },
  ],
});

const HOME_FALLBACK = coachId => ({
  coachId,
  days: [
    { day: 'Monday', focus: 'Upper Push — Home', type: 'training', exercises: [{ name: 'Push-Up', sets: '3', reps: '12-15', rest: '60s' }, { name: 'Pike Push-Up', sets: '3', reps: '10', rest: '60s' }, { name: 'Tricep Dips (Chair)', sets: '3', reps: '12', rest: '45s' }] },
    { day: 'Tuesday', focus: 'Lower Body — Home', type: 'training', exercises: [{ name: 'Bodyweight Squat', sets: '4', reps: '15', rest: '60s' }, { name: 'Reverse Lunge', sets: '3', reps: '12 each', rest: '60s' }, { name: 'Glute Bridge', sets: '3', reps: '15', rest: '45s' }] },
    { day: 'Wednesday', focus: 'Mobility & Walk', type: 'rest', exercises: [{ name: '20 min walk', sets: '-', reps: '-', rest: '-' }] },
    { day: 'Thursday', focus: 'Full Body — Bodyweight', type: 'training', exercises: [{ name: 'Squat to Press (water bottles)', sets: '3', reps: '12', rest: '60s' }, { name: 'Mountain Climber', sets: '3', reps: '20', rest: '45s' }, { name: 'Plank', sets: '3', reps: '45s', rest: '45s' }] },
    { day: 'Friday', focus: 'Pull & Core — Home', type: 'training', exercises: [{ name: 'Inverted Row (table)', sets: '3', reps: '10', rest: '75s' }, { name: 'Superman Hold', sets: '3', reps: '30s', rest: '45s' }, { name: 'Dead Bug', sets: '3', reps: '12', rest: '45s' }] },
    { day: 'Saturday', focus: 'Cardio Circuit', type: 'training', exercises: [{ name: 'Jumping Jacks', sets: '3', reps: '40', rest: '30s' }, { name: 'Burpees', sets: '3', reps: '10', rest: '60s' }] },
    { day: 'Sunday', focus: 'Full Rest', type: 'rest', exercises: [{ name: 'Stretching', sets: '-', reps: '10 min', rest: '-' }] },
  ],
});

export function getFallbackPlan(coachId, profile = {}) {
  const setting = profile.location === 'home' || profile.equipment === 'bodyweight' ? 'home' : 'gym';
  const id = resolveCoachId(coachId);
  return setting === 'home' ? HOME_FALLBACK(id) : GYM_FALLBACK(id);
}

export function mapProfileToPlanInput(profile = {}) {
  const location = profile.location || 'gym';
  let equipment = profile.equipment || 'full_gym';

  if (location === 'home' && equipment === 'full_gym') {
    equipment = 'home_basic';
  }

  return {
    fitnessLevel: profile.experience || 'beginner',
    availableEquipment: equipment,
    goal: profile.goal || 'fat_loss',
    injuries: profile.injuries || 'none',
    age: profile.age || null,
    weight: profile.weight || null,
    isReturning: profile.last_workout === 'months_ago' || profile.last_workout === 'over_a_year',
    setting: location === 'home' ? 'home' : 'gym',
  };
}

export function hasPlanRelevantChanges(previous = {}, next = {}) {
  return PLAN_PROFILE_KEYS.some(key => String(previous[key] ?? '') !== String(next[key] ?? ''));
}

/** Pick the best-matched coach from profile goals and context. */
export function recommendCoachFromProfile(profile = {}) {
  const goal = profile.goal || 'fat_loss';
  const experience = profile.experience || 'intermediate';
  const location = profile.location || 'gym';
  const equipment = profile.equipment || 'full_gym';

  if (String(profile.injuries || '').trim().length > 2) return 'zara';
  if (goal === 'fat_loss') return 'blaze';
  if (goal === 'endurance') return 'nova';
  if (goal === 'muscle') {
    return experience === 'advanced' || experience === 'athlete' ? 'zara' : 'aria';
  }
  if (experience === 'beginner') return 'aria';
  if (experience === 'athlete' || experience === 'advanced') return 'kane';
  if (location === 'home' || equipment === 'bodyweight') return 'nova';
  return 'aria';
}

export async function regenerateWorkoutPlan(userId, profile, coachId) {
  if (!userId || !supabase) return null;

  const resolvedCoach = resolveCoachId(coachId || recommendCoachFromProfile(profile));
  const planInput = mapProfileToPlanInput(profile);

  let planData;
  try {
    planData = await generateWorkoutPlan(resolvedCoach, { id: userId }, planInput);
  } catch (err) {
    console.error('Plan generation failed, using environment fallback:', err);
    planData = getFallbackPlan(resolvedCoach, profile);
  }

  await supabase
    .from('workout_plans')
    .update({ is_active: false })
    .eq('user_id', userId);

  const { data, error } = await supabase
    .from('workout_plans')
    .insert({
      user_id: userId,
      coach_id: resolvedCoach,
      plan_data: planData,
      week_start: new Date().toISOString().split('T')[0],
      is_active: true,
    })
    .select('id, plan_data')
    .single();

  if (error) {
    console.error('Failed to save workout plan:', error);
    return { coachId: resolvedCoach, planData, saved: false };
  }

  return { coachId: resolvedCoach, planData, saved: true, record: data };
}

export function getTodayWorkoutFromPlan(planData) {
  const days = planData?.days || planData?.plan_data?.days || [];
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return days.find(d => d.day === todayName) || days.find(d => d.type !== 'rest') || null;
}
