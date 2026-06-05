import { supabase } from '../lib/supabase';
import { generateWorkoutPlan } from '../lib/gemini';
import { resolveCoachId } from '../config/coaches';
const PLAN_PROFILE_KEYS = ['location', 'equipment', 'goal', 'experience', 'injuries', 'session_duration'];
const MIN_TRAINING_EXERCISES = 4;
const TARGET_TRAINING_EXERCISES = 6;

const GYM_FALLBACK = coachId => ({
  coachId,
  days: [
    {
      day: 'Monday',
      focus: 'Push — Chest, Shoulders & Triceps',
      type: 'training',
      exercises: [
        { name: 'Barbell Bench Press', sets: '4', reps: '8-10', rest: '90s' },
        { name: 'Incline Dumbbell Press', sets: '3', reps: '10-12', rest: '75s' },
        { name: 'Overhead Press (Dumbbell)', sets: '3', reps: '10', rest: '75s' },
        { name: 'Cable Chest Fly', sets: '3', reps: '12-15', rest: '60s' },
        { name: 'Lateral Raise', sets: '3', reps: '12-15', rest: '45s' },
        { name: 'Tricep Pushdown (Cable)', sets: '3', reps: '12-15', rest: '60s' },
      ],
    },
    {
      day: 'Tuesday',
      focus: 'Pull — Back & Biceps',
      type: 'training',
      exercises: [
        { name: 'Lat Pulldown', sets: '4', reps: '10-12', rest: '90s' },
        { name: 'Seated Cable Row', sets: '3', reps: '12', rest: '75s' },
        { name: 'Face Pull (Cable)', sets: '3', reps: '15-20', rest: '45s' },
        { name: 'Dumbbell Hammer Curl', sets: '3', reps: '12', rest: '60s' },
        { name: 'Rear Delt Fly (Dumbbell)', sets: '3', reps: '12-15', rest: '45s' },
        { name: 'Straight-Arm Pulldown', sets: '3', reps: '12', rest: '60s' },
      ],
    },
    {
      day: 'Wednesday',
      focus: 'Active Recovery — Mobility & Walk',
      type: 'rest',
      exercises: [{ name: '20 min brisk walk + dynamic stretching', sets: '-', reps: '-', rest: '-' }],
    },
    {
      day: 'Thursday',
      focus: 'Legs — Quads, Hamstrings & Glutes',
      type: 'training',
      exercises: [
        { name: 'Leg Press', sets: '4', reps: '10-12', rest: '90s' },
        { name: 'Romanian Deadlift (Barbell)', sets: '3', reps: '10', rest: '90s' },
        { name: 'Walking Lunge (Dumbbell)', sets: '3', reps: '10 each', rest: '75s' },
        { name: 'Lying Leg Curl', sets: '3', reps: '12', rest: '60s' },
        { name: 'Standing Calf Raise', sets: '4', reps: '15', rest: '45s' },
        { name: 'Goblet Squat', sets: '3', reps: '12', rest: '75s' },
      ],
    },
    {
      day: 'Friday',
      focus: 'Upper Body — Balanced Push & Pull',
      type: 'training',
      exercises: [
        { name: 'Dumbbell Bench Press', sets: '3', reps: '10-12', rest: '75s' },
        { name: 'Pull-Up (Assisted)', sets: '3', reps: '8-10', rest: '90s' },
        { name: 'Arnold Press', sets: '3', reps: '10', rest: '75s' },
        { name: 'Single-Arm Cable Row', sets: '3', reps: '12 each', rest: '60s' },
        { name: 'Overhead Tricep Extension', sets: '3', reps: '12', rest: '60s' },
      ],
    },
    {
      day: 'Saturday',
      focus: 'Core + Metabolic Conditioning',
      type: 'training',
      exercises: [
        { name: 'Plank', sets: '3', reps: '45-60s', rest: '45s' },
        { name: 'Cable Crunch', sets: '3', reps: '15', rest: '45s' },
        { name: 'Russian Twist (Dumbbell)', sets: '3', reps: '20', rest: '45s' },
        { name: 'Kettlebell Swing', sets: '4', reps: '15', rest: '60s' },
        { name: 'Farmer Carry', sets: '3', reps: '40m', rest: '60s' },
      ],
    },
    {
      day: 'Sunday',
      focus: 'Full Rest & Recovery',
      type: 'rest',
      exercises: [{ name: 'Light stretching + hydration', sets: '-', reps: '-', rest: '-' }],
    },
  ],
});

const HOME_FALLBACK = coachId => ({
  coachId,
  days: [
    {
      day: 'Monday',
      focus: 'Push — Chest, Shoulders & Triceps',
      type: 'training',
      exercises: [
        { name: 'Standard Push-Up', sets: '4', reps: '12-15', rest: '60s' },
        { name: 'Pike Push-Up', sets: '3', reps: '10-12', rest: '60s' },
        { name: 'Diamond Push-Up', sets: '3', reps: '10-12', rest: '60s' },
        { name: 'Tricep Dips (Chair)', sets: '3', reps: '12-15', rest: '45s' },
        { name: 'Shoulder Tap Plank', sets: '3', reps: '20 taps', rest: '45s' },
        { name: 'Lateral Raise (Water Bottles)', sets: '3', reps: '15', rest: '45s' },
      ],
    },
    {
      day: 'Tuesday',
      focus: 'Pull — Back & Biceps',
      type: 'training',
      exercises: [
        { name: 'Inverted Row (Table)', sets: '4', reps: '10-12', rest: '75s' },
        { name: 'Superman Hold', sets: '3', reps: '30s', rest: '45s' },
        { name: 'Resistance Band Row', sets: '3', reps: '15', rest: '60s' },
        { name: 'Bicep Curl (Water Bottles)', sets: '3', reps: '12-15', rest: '45s' },
        { name: 'Reverse Snow Angels', sets: '3', reps: '15', rest: '45s' },
        { name: 'Dead Bug', sets: '3', reps: '12 each', rest: '45s' },
      ],
    },
    {
      day: 'Wednesday',
      focus: 'Active Recovery — Mobility & Walk',
      type: 'rest',
      exercises: [{ name: '20 min walk + hip/shoulder mobility', sets: '-', reps: '-', rest: '-' }],
    },
    {
      day: 'Thursday',
      focus: 'Legs — Quads, Glutes & Hamstrings',
      type: 'training',
      exercises: [
        { name: 'Bodyweight Squat', sets: '4', reps: '15-20', rest: '60s' },
        { name: 'Reverse Lunge', sets: '3', reps: '12 each', rest: '60s' },
        { name: 'Glute Bridge', sets: '3', reps: '15-20', rest: '45s' },
        { name: 'Single-Leg Glute Bridge', sets: '3', reps: '12 each', rest: '45s' },
        { name: 'Calf Raise (Step)', sets: '4', reps: '15', rest: '45s' },
        { name: 'Wall Sit', sets: '3', reps: '45-60s', rest: '60s' },
      ],
    },
    {
      day: 'Friday',
      focus: 'Upper Body — Push & Pull Balance',
      type: 'training',
      exercises: [
        { name: 'Decline Push-Up', sets: '3', reps: '12', rest: '60s' },
        { name: 'Wide Push-Up', sets: '3', reps: '12', rest: '60s' },
        { name: 'Door Frame Row', sets: '3', reps: '12', rest: '75s' },
        { name: 'Bear Crawl', sets: '3', reps: '20m', rest: '60s' },
        { name: 'Side Plank', sets: '3', reps: '30s each', rest: '45s' },
      ],
    },
    {
      day: 'Saturday',
      focus: 'Full Body Conditioning + Core',
      type: 'training',
      exercises: [
        { name: 'Jumping Jacks', sets: '3', reps: '40', rest: '30s' },
        { name: 'Mountain Climbers', sets: '3', reps: '30', rest: '45s' },
        { name: 'Burpees', sets: '3', reps: '10', rest: '60s' },
        { name: 'High Knees', sets: '3', reps: '30s', rest: '45s' },
        { name: 'Bicycle Crunch', sets: '3', reps: '20', rest: '45s' },
      ],
    },
    {
      day: 'Sunday',
      focus: 'Full Rest & Recovery',
      type: 'rest',
      exercises: [{ name: 'Light stretching + foam rolling', sets: '-', reps: '-', rest: '-' }],
    },
  ],
});

function isRestDay(day) {
  const focus = day?.focus || '';
  return day?.type === 'rest'
    || focus.includes('Rest')
    || focus.includes('Recovery')
    || focus.includes('Mobility');
}

export function normalizeWorkoutPlan(planData, coachId, profile = {}) {
  const fallback = getFallbackPlan(coachId, profile);
  if (!planData?.days?.length) return fallback;

  const usedNames = new Set();

  const days = planData.days.map((day, index) => {
    const fallbackDay = fallback.days.find(d => d.day === day.day) || fallback.days[index] || fallback.days[0];
    const restDay = isRestDay(day) || isRestDay(fallbackDay);

    if (restDay) {
      return {
        ...fallbackDay,
        ...day,
        type: 'rest',
        exercises: day.exercises?.length ? day.exercises : fallbackDay.exercises,
      };
    }

    let exercises = (day.exercises || []).map(ex => ({
      name: ex.name,
      sets: String(ex.sets || '3'),
      reps: String(ex.reps || '10-12'),
      rest: ex.rest || '60s',
    }));

    for (const ex of fallbackDay.exercises || []) {
      if (exercises.length >= TARGET_TRAINING_EXERCISES) break;
      const name = ex.name?.trim();
      if (!name || usedNames.has(name) || exercises.some(e => e.name === name)) continue;
      exercises.push({ ...ex });
    }

    if (exercises.length < MIN_TRAINING_EXERCISES) {
      exercises = [...(fallbackDay.exercises || [])];
    }

    exercises.forEach(ex => usedNames.add(ex.name));
    return {
      ...day,
      type: 'training',
      focus: day.focus || fallbackDay.focus,
      exercises: exercises.slice(0, TARGET_TRAINING_EXERCISES),
    };
  });

  return {
    coachId: planData.coachId || coachId,
    days: days.length === 7 ? days : fallback.days,
  };
}

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
    sessionDuration: profile.session_duration || 45,
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

export const PLAN_VALID_DAYS = 7;

export function isPlanStale(weekStart) {
  if (!weekStart) return false;
  const start = new Date(weekStart);
  if (Number.isNaN(start.getTime())) return false;
  const ageDays = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= PLAN_VALID_DAYS;
}

export async function regenerateWorkoutPlan(userId, profile, coachId) {
  if (!userId || !supabase) return null;

  const resolvedCoach = resolveCoachId(coachId || recommendCoachFromProfile(profile));
  const planInput = mapProfileToPlanInput(profile);

  let planData;
  try {
    planData = await generateWorkoutPlan(resolvedCoach, { id: userId }, planInput);
    planData = normalizeWorkoutPlan(planData, resolvedCoach, profile);
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
