import { supabase } from '../lib/supabase';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return supabase;
}

export const signUp = async (email, password, displayName) => {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
    },
  });
  if (error) throw error;
  return data;
};

export const signIn = async (email, password) => {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

export const signInWithGoogle = async () => {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
};

export const signOut = async () => {
  const client = requireSupabase();
  await client.auth.signOut();
};

export const getCurrentUser = async () => {
  const client = requireSupabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
};

