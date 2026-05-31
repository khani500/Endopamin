import { useCallback, useEffect, useMemo, useState } from 'react';
import { COACHES, getCoach } from '../config/coaches';
import { useAuth } from '../context/AuthContext';
import { chatWithCoach, getDailyMessage } from '../services/coachAI';
import { speakWithGoogleTTS as speakText, stopSpeaking } from '../services/voiceService';

export function useCoach() {
  const { user, profile, updateCoachPersona } = useAuth();
  const [message, setMessage] = useState('');
  const [loadingMessage, setLoadingMessage] = useState(false);
  const personaId = profile?.coach_persona || 'aria';
  const coach = useMemo(() => getCoach(personaId), [personaId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingMessage(true);
      void (async () => {
        try {
          const daily = await getDailyMessage(personaId, {
            name: profile?.display_name || 'Champion',
            streak: profile?.streak_count || 0,
            level: profile?.dopa_level || 1,
            goal: profile?.goal || 'strength_gain',
            energy: profile?.energy_level,
            gender: profile?.gender,
          });
          if (!cancelled) setMessage(daily);
        } catch (error) {
          console.error('Daily coach message failed:', error);
          if (!cancelled) setMessage(`${profile?.display_name || 'Champion'}, let's make today count.`);
        }
        if (!cancelled) setLoadingMessage(false);
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    personaId,
    profile?.display_name,
    profile?.dopa_level,
    profile?.energy_level,
    profile?.gender,
    profile?.goal,
    profile?.streak_count,
  ]);

  const speak = useCallback((text, onEnd) => speakText(text, personaId, onEnd), [personaId]);

  const chat = useCallback(async (text, history = [], userName) => {
    return chatWithCoach(
      personaId,
      userName || profile?.display_name || 'Champion',
      text,
      history,
      profile || {},
    );
  }, [personaId, profile]);

  const setPersona = useCallback(async persona => {
    if (!COACHES[persona] || !user?.id) return { error: null };
    return updateCoachPersona(persona);
  }, [updateCoachPersona, user?.id]);

  return {
    coach,
    personaId,
    message,
    loadingMessage,
    speak,
    stopSpeaking,
    chat,
    setPersona,
    coaches: COACHES,
  };
}

