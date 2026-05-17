import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabase } from '../lib/supabase';

export type UserProfileRecord = {
  id?: string;
  user_id: string;
  weight_lb?: number | null;
  height_ft_in?: string | null;
  committed_days_per_week?: number | null;
  bmi?: number | null;
  food_macro_goals_id?: string | null;
};

export type WorkoutLoggedRecord = {
  id?: string;
  user_id: string;
  session_type: string;
  session_duration_min: number;
  date: string;
};

export type FoodScanRecord = {
  id?: string;
  user_id: string;
  food_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  date: string;
};

function db(client?: SupabaseClient | null) {
  return client ?? requireSupabase();
}

export async function upsertUserProfile(profile: UserProfileRecord, client?: SupabaseClient | null) {
  const { data, error } = await db(client)
    .from('users_profile')
    .upsert(profile, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data as UserProfileRecord;
}

export async function getUserProfile(userId: string, client?: SupabaseClient | null) {
  const { data, error } = await db(client)
    .from('users_profile')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data as UserProfileRecord | null;
}

export async function logWorkout(workout: WorkoutLoggedRecord, client?: SupabaseClient | null) {
  const { data, error } = await db(client)
    .from('workouts_logged')
    .insert(workout)
    .select('*')
    .single();

  if (error) throw error;
  return data as WorkoutLoggedRecord;
}

export async function getWorkoutHistory(userId: string, limit = 20, client?: SupabaseClient | null) {
  const { data, error } = await db(client)
    .from('workouts_logged')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as WorkoutLoggedRecord[];
}

export async function saveFoodScan(scan: FoodScanRecord, client?: SupabaseClient | null) {
  const { data, error } = await db(client)
    .from('food_scans')
    .insert(scan)
    .select('*')
    .single();

  if (error) throw error;
  return data as FoodScanRecord;
}

export async function getFoodScans(userId: string, date?: string, client?: SupabaseClient | null) {
  let query = db(client)
    .from('food_scans')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (date) query = query.eq('date', date);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FoodScanRecord[];
}
