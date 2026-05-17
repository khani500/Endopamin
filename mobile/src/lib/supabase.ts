import { useAuth } from '@clerk/clerk-expo';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { useMemo } from 'react';
import { env, isSupabaseConfigured } from '../config/env';

export const supabase = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey)
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

export function createSupabaseClientWithToken(getToken?: () => Promise<string | null>) {
  if (!isSupabaseConfigured) return null;

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      fetch: async (url, options = {}) => {
        const token = getToken ? await getToken() : null;
        const headers = new Headers(options.headers);

        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }

        return fetch(url, { ...options, headers });
      },
    },
  });
}

export function useSupabaseClient() {
  const { getToken } = useAuth();

  return useMemo(
    () =>
      createSupabaseClientWithToken(() =>
        getToken({ template: 'supabase' }).catch(() => null),
      ) as SupabaseClient | null,
    [getToken],
  );
}
