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

    setProfile(data);
    return data;
  }, []);

  const ensureProfile = useCallback(async sessionUser => {
    if (!supabase || !sessionUser?.id) return;
    const existing = await loadProfile(sessionUser.id);
    if (existing) return;

    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: sessionUser.id, created_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      console.error('Failed to create profile:', error);
      return;
    }
    setProfile(data);
  }, [loadProfile]);

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
      updateCoachPersona,
      refreshProfile: () => loadProfile(user?.id),
    }),
    [user, profile, loading, loadProfile, updateCoachPersona],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

