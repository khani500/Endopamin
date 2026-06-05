/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ensureActivePlan } from '../services/workoutPlanService';
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

function applyPlanRecord(data, setters) {
  const days = data?.plan_data?.days || [];
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const today = days.find(d => d.day === todayName) || null;

  console.log('todayName:', todayName, 'todayWorkout:', today);
  setters.setActivePlan(data);
  setters.setPlanId(data?.id || null);
  setters.setPlanDays(days);
  setters.setTodayWorkout(today);
  setters.setNextWorkout(getNextWorkoutAfterToday(days, today));
}

export const WorkoutProvider = ({ children }) => {
  const { user, profile } = useAuth();
  const [activePlan, setActivePlan] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [planDays, setPlanDays] = useState([]);
  const [todayWorkout, setTodayWorkout] = useState(null);
  const [nextWorkout, setNextWorkout] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);

  const loadPlan = useCallback(async () => {
    if (!user?.id) {
      setActivePlan(null);
      setPlanId(null);
      setPlanDays([]);
      setTodayWorkout(null);
      setNextWorkout(null);
      setPlanLoading(false);
      return;
    }

    setPlanLoading(true);
    try {
      const data = await ensureActivePlan(user.id, profile);
      console.log('WorkoutContext fetch result:', data);
      applyPlanRecord(data, {
        setActivePlan,
        setPlanId,
        setPlanDays,
        setTodayWorkout,
        setNextWorkout,
      });
    } catch (err) {
      console.error('Failed to load workout plan:', err);
      setActivePlan(null);
      setPlanId(null);
      setPlanDays([]);
      setTodayWorkout(null);
      setNextWorkout(null);
    } finally {
      setPlanLoading(false);
    }
  }, [user?.id, profile]);

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
      planLoading,
      reloadPlan: loadPlan,
    }),
    [activePlan, planId, planDays, todayWorkout, nextWorkout, planLoading, loadPlan],
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
