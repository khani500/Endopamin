/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const WorkoutContext = createContext(null);

function isTrainingDay(day) {
  return day && day.type !== 'rest';
}

function getNextWorkoutAfterToday(planDays, todayWorkout) {
  if (!Array.isArray(planDays) || planDays.length === 0) return null;

  const trainingDays = planDays.filter(isTrainingDay);
  if (trainingDays.length === 0) return null;

  if (!todayWorkout) return trainingDays[0];

  const todayIndex = planDays.findIndex(d => d.day === todayWorkout.day);
  if (todayIndex === -1) return trainingDays[0];

  for (let offset = 1; offset <= planDays.length; offset += 1) {
    const day = planDays[(todayIndex + offset) % planDays.length];
    if (isTrainingDay(day)) return day;
  }

  return trainingDays[0];
}

export const WorkoutProvider = ({ children }) => {
  const { user } = useAuth();
  const [activePlan, setActivePlan] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [planDays, setPlanDays] = useState([]);
  const [todayWorkout, setTodayWorkout] = useState(null);
  const [nextWorkout, setNextWorkout] = useState(null);

  const loadPlan = useCallback(async () => {
    if (!user?.id || !supabase) {
      setActivePlan(null);
      setPlanId(null);
      setPlanDays([]);
      setTodayWorkout(null);
      setNextWorkout(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('workout_plans')
        .select('id, plan_data, week_start, coach_id, generated_at')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      console.log('WorkoutContext fetch result:', data, error);

      if (error) throw error;

      const days = data?.plan_data?.days || [];
      const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
      const today = days.find(d => d.day === todayName) || null;

      console.log('todayName:', todayName, 'todayWorkout:', today);
      setActivePlan(data);
      setPlanId(data?.id || null);
      setPlanDays(days);
      setTodayWorkout(today);
      setNextWorkout(getNextWorkoutAfterToday(days, today));
    } catch (err) {
      console.error('Failed to load workout plan:', err);
      setActivePlan(null);
      setPlanId(null);
      setPlanDays([]);
      setTodayWorkout(null);
      setNextWorkout(null);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const value = useMemo(
    () => ({
      activePlan,
      planId,
      planDays,
      todayWorkout,
      nextWorkout,
      reloadPlan: loadPlan,
    }),
    [activePlan, planId, planDays, todayWorkout, nextWorkout, loadPlan],
  );

  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>;
};

export const useWorkout = () => {
  const context = useContext(WorkoutContext);
  if (!context) {
    throw new Error('useWorkout must be used within WorkoutProvider');
  }
  return context;
};
