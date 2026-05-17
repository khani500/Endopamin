import { useUser } from '@clerk/clerk-expo';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { GradientButton, ScreenContainer, SectionHeader } from '../components';
import { useSupabaseClient } from '../lib/supabase';
import { FoodScanRecord, getFoodScans, getWorkoutHistory, WorkoutLoggedRecord } from '../services/database';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function HomeScreen({ onOpenMe }: { onOpenMe: () => void }) {
  const { user } = useUser();
  const supabase = useSupabaseClient();
  const [foods, setFoods] = useState<FoodScanRecord[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutLoggedRecord[]>([]);

  useEffect(() => {
    if (!user?.id || !supabase) return;

    void Promise.all([
      getFoodScans(user.id, todayIsoDate(), supabase).catch(() => []),
      getWorkoutHistory(user.id, 5, supabase).catch(() => []),
    ]).then(([foodRows, workoutRows]) => {
      setFoods(foodRows);
      setWorkouts(workoutRows);
    });
  }, [supabase, user?.id]);

  const calories = foods.reduce((total, item) => total + item.calories, 0);
  const protein = foods.reduce((total, item) => total + item.protein, 0);

  return (
    <ScreenContainer>
      <View className="mb-6 flex-row items-center justify-between">
        <View>
          <Text className="text-xs font-black uppercase tracking-[3px] text-accent">DopaPeak</Text>
          <Text className="mt-1 text-2xl font-black text-white">
            Hi, {user?.firstName ?? 'Athlete'}
          </Text>
        </View>
        {user?.imageUrl ? (
          <Image source={{ uri: user.imageUrl }} className="h-14 w-14 rounded-2xl border border-accent/40" />
        ) : (
          <View className="h-14 w-14 items-center justify-center rounded-2xl border border-accent/40 bg-secondary">
            <Text className="font-black text-accent">{user?.firstName?.[0] ?? 'D'}</Text>
          </View>
        )}
      </View>

      <SectionHeader
        eyebrow="Connected data"
        title="Supabase is your workout + nutrition source"
        subtitle="Food scans and workout logs now read through the shared mobile service layer."
      />

      <View className="mb-4 rounded-3xl border border-white/10 bg-secondary p-5">
        <Text className="text-sm font-black uppercase tracking-[2px] text-white/40">Today Nutrition</Text>
        <Text className="mt-3 text-4xl font-black text-white">{calories}</Text>
        <Text className="mt-1 text-sm text-white/45">calories logged • {protein}g protein</Text>
      </View>

      <View className="mb-5 rounded-3xl border border-white/10 bg-secondary p-5">
        <Text className="text-sm font-black uppercase tracking-[2px] text-white/40">Recent Workouts</Text>
        <Text className="mt-3 text-4xl font-black text-white">{workouts.length}</Text>
        <Text className="mt-1 text-sm text-white/45">sessions synced from Supabase</Text>
      </View>

      <GradientButton label="Open Me / Membership" onPress={onOpenMe} />
    </ScreenContainer>
  );
}
