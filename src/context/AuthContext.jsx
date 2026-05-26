/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  const loadProfile = useCallback(async userId => {
    if (!supabase || !userId) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load profile:', error);
      setProfile(null);
      return null;
    }

    const localDone = typeof window !== 'undefined'
      && localStorage.getItem('onboarding_done') === 'true';
    const merged = data && localDone && !data.onboarding_completed
      ? { ...data, onboarding_completed: true }
      : data;
    setProfile(merged);
    return merged;
  }, []);

  const ensureProfile = useCallback(async sessionUser => {
    if (!supabase || !sessionUser?.id) return;
    const existing = await loadProfile(sessionUser.id);
    const metadataName = sessionUser.user_metadata?.display_name;

    if (existing) {
      if (!existing.display_name && metadataName) {
        const { data, error } = await supabase
          .from('profiles')
          .update({ display_name: metadataName })
          .eq('id', sessionUser.id)
          .select('*')
          .single();

        if (!error) setProfile(data);
      }
      return;
    }

    const profileDefaults = {
      id: sessionUser.id,
      display_name: metadataName || sessionUser.email?.split('@')[0] || 'Athlete',
      goal: 'strength_gain',
      experience: 'intermediate',
      gender: null,
      job_type: null,
      days_per_week: 4,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('profiles')
      .upsert(profileDefaults, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      console.error('Failed to create profile:', error);
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('profiles')
        .upsert({
          id: sessionUser.id,
          display_name: profileDefaults.display_name,
          created_at: profileDefaults.created_at,
        }, { onConflict: 'id' })
        .select('*')
        .single();

      if (!fallbackError) {
        setProfile(fallbackData);
      }
      return;
    }
    setProfile(data);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    localStorage.removeItem('onboarding_done');

    if (!supabase) {
      setUser(null);
      setProfile(null);
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign out failed:', error);
      throw error;
    }

    setUser(null);
    setProfile(null);
  }, []);

  const updateCoachPersona = useCallback(async persona => {
    if (!supabase || !user?.id) return { error: null };

    const { error } = await supabase
      .from('profiles')
      .update({ coach_persona: persona })
      .eq('id', user.id);

    if (!error) {
      setProfile(prev => ({ ...prev, coach_persona: persona }));
    }

    return { error };
  }, [user]);

  useEffect(() => {
    if (!supabase) {
      const timer = window.setTimeout(() => setLoading(false), 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (session?.user) await ensureProfile(session.user);
      if (!cancelled) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setLoading(true);
        void ensureProfile(session.user).finally(() => setLoading(false));
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [ensureProfile]);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      setProfile,
      signOut,
      updateCoachPersona,
      refreshProfile: () => loadProfile(user?.id),
    }),
    [user, profile, loading, loadProfile, signOut, updateCoachPersona],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

