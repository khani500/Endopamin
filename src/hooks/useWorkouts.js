import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

function requireReady(user) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!user?.id) throw new Error('User must be signed in.');
  return supabase;
}

export const useWorkouts = () => {
  const { user } = useAuth();

  const logWorkout = async workoutData => {
    const client = requireReady(user);
    const { data, error } = await client
      .from('workout_logs')
      .insert({ user_id: user.id, ...workoutData })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const getHistory = async (limit = 20) => {
    const client = requireReady(user);
    const { data, error } = await client
      .from('workout_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  };

  const getTodayWorkout = async () => {
    const client = requireReady(user);
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await client
      .from('workout_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('logged_at', today)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  return { logWorkout, getHistory, getTodayWorkout };
};

