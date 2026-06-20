/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function isProfileComplete(profile) {
  if (!profile) return false;
  if (profile.onboarding_completed === true) return true;

  const localDone = typeof window !== 'undefined'
    && localStorage.getItem('onboarding_done') === 'true';
  if (localDone) return true;

  return Boolean(
    profile.display_name?.trim()
    && profile.goal
    && profile.coach_persona,
  );
}

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
    const metadataName = sessionUser.user_metadata?.display_name;

    const { data, error: selectError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', sessionUser.id)
      .maybeSingle();

    if (selectError) {
      console.error('Failed to load profile:', selectError);
      setProfile(null);
      return;
    }

    if (data) {
      if (!data.display_name && metadataName) {
        const { data: updated, error: updateError } = await supabase
          .from('profiles')
          .update({ display_name: metadataName })
          .eq('id', sessionUser.id)
          .select('*')
          .single();

        if (!updateError) {
          setProfile(updated);
          return;
        }
      }

      const localDone = typeof window !== 'undefined'
        && localStorage.getItem('onboarding_done') === 'true';
      const merged = localDone && !data.onboarding_completed
        ? { ...data, onboarding_completed: true }
        : data;
      setProfile(merged);
      return;
    }

    const profileDefaults = {
      id: sessionUser.id,
      display_name: metadataName || sessionUser.email?.split('@')[0] || 'Athlete',
      goal: null,
      experience: null,
      gender: null,
      job_type: null,
      days_per_week: 4,
      created_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertError } = await supabase
      .from('profiles')
      .insert(profileDefaults)
      .select('*')
      .single();

    if (insertError) {
      console.error('Failed to create profile:', insertError);
      return;
    }
    setProfile(inserted);
  }, []);

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
    if (!user?.id || typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') !== 'true') return;

    let cancelled = false;

    const clearUpgradeQuery = () => {
      params.delete('upgraded');
      params.delete('session_id');
      const query = params.toString();
      window.history.replaceState(
        {},
        '',
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      );
    };

    const finishUpgrade = async () => {
      localStorage.setItem('scan_count', '0');
      window.dispatchEvent(new Event('endopamin:scan-count-reset'));

      const sessionId = params.get('session_id');
      if (sessionId) {
        try {
          await fetch('/api/activate-pro-from-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, userId: user.id }),
          });
        } catch (err) {
          console.error('Failed to activate Pro from checkout session:', err);
        }
      }

      if (!cancelled) {
        await loadProfile(user.id);
        clearUpgradeQuery();
      }
    };

    void finishUpgrade();

    return () => {
      cancelled = true;
    };
  }, [user?.id, loadProfile]);

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

