import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { estimateDailyTargets } from '../lib/macroTargets';

/** @typedef {'cut' | 'bulk' | 'maintain'} NutritionGoal */
/** @typedef {'sedentary' | 'light' | 'moderate' | 'active' | 'athlete'} ActivityLevel */

const defaultTargets = {
  targetCalories: 2200,
  targetProtein: 160,
  targetCarbs: 220,
  targetFat: 65,
  mealsPerDay: 4,
};

export const useNutritionStore = create(
  persist(
    (set, get) => ({
      onboardingComplete: false,
      /** @type {NutritionGoal} */
      goal: 'maintain',
      /** @type {ActivityLevel} */
      activity: 'moderate',
      currentWeightKg: 78,
      targetWeightKg: null,
      ...defaultTargets,
      /** @type {{ id: string; name: string; kcal: number; protein: number; carbs: number; fat: number; at: string }[]} */
      foodLog: [],
      /** @type {'male' | 'female'} */
      coachGender: 'male',
      /** @type {'motivational' | 'calm' | 'military'} */
      coachTone: 'motivational',

      setCoachProfile: ({ gender, tone }) =>
        set({
          coachGender: gender ?? get().coachGender,
          coachTone: tone ?? get().coachTone,
        }),

      setGoalProfile: payload =>
        set({
          goal: payload.goal ?? get().goal,
          activity: payload.activity ?? get().activity,
          currentWeightKg: payload.currentWeightKg ?? get().currentWeightKg,
          targetWeightKg: payload.targetWeightKg ?? get().targetWeightKg,
          targetCalories: payload.targetCalories ?? get().targetCalories,
          targetProtein: payload.targetProtein ?? get().targetProtein,
          targetCarbs: payload.targetCarbs ?? get().targetCarbs,
          targetFat: payload.targetFat ?? get().targetFat,
          mealsPerDay: payload.mealsPerDay ?? get().mealsPerDay,
        }),

      completeOnboarding: () => set({ onboardingComplete: true }),

      resetOnboarding: () => set({ onboardingComplete: false }),

      /** Skip questionnaire; applies `estimateDailyTargets` from current or passed fields. */
      skipOnboardingWithDefaults: (partial = {}) =>
        set(s => {
          const g = partial.goal ?? s.goal;
          const act = partial.activity ?? s.activity;
          const w = partial.currentWeightKg ?? s.currentWeightKg;
          const mp = partial.mealsPerDay ?? s.mealsPerDay;
          const targets = estimateDailyTargets({ goal: g, activity: act, currentWeightKg: w });
          return {
            ...s,
            goal: g,
            activity: act,
            currentWeightKg: w,
            mealsPerDay: mp,
            targetWeightKg: partial.targetWeightKg !== undefined ? partial.targetWeightKg : s.targetWeightKg,
            ...targets,
            onboardingComplete: true,
          };
        }),

      addFoodEntry: entry => {
        const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const at = new Date().toISOString();
        set(s => ({
          foodLog: [
            ...s.foodLog,
            {
              id,
              name: entry.name,
              kcal: entry.kcal,
              protein: entry.protein,
              carbs: entry.carbs,
              fat: entry.fat,
              at,
            },
          ],
        }));
      },

      removeFoodEntry: id =>
        set(s => ({
          foodLog: s.foodLog.filter(e => e.id !== id),
        })),
    }),
    {
      name: 'dopa-peak-nutrition',
      partialize: s => ({
        onboardingComplete: s.onboardingComplete,
        goal: s.goal,
        activity: s.activity,
        currentWeightKg: s.currentWeightKg,
        targetWeightKg: s.targetWeightKg,
        targetCalories: s.targetCalories,
        targetProtein: s.targetProtein,
        targetCarbs: s.targetCarbs,
        targetFat: s.targetFat,
        mealsPerDay: s.mealsPerDay,
        foodLog: s.foodLog,
        coachGender: s.coachGender,
        coachTone: s.coachTone,
      }),
    },
  ),
);
