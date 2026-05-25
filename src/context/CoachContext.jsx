import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

const STORAGE_PREFIX = 'endopamin_coach_session';

function sessionKey(userId, coachId) {
  return `${STORAGE_PREFIX}_${userId || 'guest'}_${coachId}`;
}

export function getAssessmentGreeting(coachId, fallbackGreeting) {
  const assessmentGreeting = {
    aria: "Aria here. Science first — how's your energy, sleep quality, and any soreness or injuries I should factor in today?",
    kane: "Kane. No small talk. State your goal, training history, injuries, and energy level — then we execute.",
    blaze: "YO bestie!! Blaze in the chat 🔥 Vibe check: energy 1-10, any injuries, and are we about to absolutely send it today??",
    nova: "Nova here. How are you feeling — body and mind? Any stress, tension, or small wins worth celebrating before we train?",
    zara: "Zara here! You're stronger than you think — tell me how you're feeling today, your goal, and anything holding you back.",
  };
  return assessmentGreeting[coachId] || fallbackGreeting || "Let's get started — how are you feeling today?";
}

function loadStoredMessages(userId, coachId) {
  try {
    const raw = localStorage.getItem(sessionKey(userId, coachId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const messages = parsed?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;
    return messages.filter(m => m?.role && m?.text);
  } catch {
    return null;
  }
}

function persistMessages(userId, coachId, messages) {
  try {
    localStorage.setItem(
      sessionKey(userId, coachId),
      JSON.stringify({ messages, updatedAt: Date.now() }),
    );
  } catch {
    // ignore quota errors
  }
}

function createInitialSession(coachId, fallbackGreeting) {
  return [{
    role: 'assistant',
    text: getAssessmentGreeting(coachId, fallbackGreeting),
  }];
}

const CoachContext = createContext(null);

export function CoachProvider({ children }) {
  const { user } = useAuth() || {};
  const userId = user?.id || null;
  const [activeCoachId, setActiveCoachId] = useState('aria');
  const [messagesByCoach, setMessagesByCoach] = useState({});
  const messagesByCoachRef = useRef({});

  const messages = messagesByCoach[activeCoachId] || [];

  useEffect(() => {
    messagesByCoachRef.current = messagesByCoach;
  }, [messagesByCoach]);

  const initCoachSession = useCallback((coachId, fallbackGreeting) => {
    const stored = loadStoredMessages(userId, coachId);
    const session = stored || createInitialSession(coachId, fallbackGreeting);

    setMessagesByCoach(prev => {
      if (prev[coachId]?.length) return prev;
      return { ...prev, [coachId]: session };
    });

    if (!stored) {
      persistMessages(userId, coachId, session);
    }

    return session;
  }, [userId]);

  const switchCoach = useCallback((coachId, fallbackGreeting) => {
    setActiveCoachId(coachId);

    const inMemory = messagesByCoachRef.current[coachId];
    if (inMemory?.length) {
      return inMemory;
    }

    const stored = loadStoredMessages(userId, coachId);
    if (stored) {
      setMessagesByCoach(prev => ({ ...prev, [coachId]: stored }));
      messagesByCoachRef.current = { ...messagesByCoachRef.current, [coachId]: stored };
      return stored;
    }

    const session = createInitialSession(coachId, fallbackGreeting);
    setMessagesByCoach(prev => ({ ...prev, [coachId]: session }));
    messagesByCoachRef.current = { ...messagesByCoachRef.current, [coachId]: session };
    persistMessages(userId, coachId, session);
    return session;
  }, [userId]);

  const setCoachMessages = useCallback((coachId, nextMessages) => {
    setMessagesByCoach(prev => ({ ...prev, [coachId]: nextMessages }));
    messagesByCoachRef.current = { ...messagesByCoachRef.current, [coachId]: nextMessages };
    persistMessages(userId, coachId, nextMessages);
  }, [userId]);

  const appendCoachMessages = useCallback((coachId, ...newMessages) => {
    const current = messagesByCoachRef.current[coachId] || [];
    const next = [...current, ...newMessages];
    setCoachMessages(coachId, next);
    return next;
  }, [setCoachMessages]);

  const getCoachMessages = useCallback((coachId) => {
    return messagesByCoachRef.current[coachId]
      || loadStoredMessages(userId, coachId)
      || [];
  }, [userId]);

  const clearCoachSession = useCallback((coachId) => {
    try {
      localStorage.removeItem(sessionKey(userId, coachId));
    } catch {
      // ignore
    }
    setMessagesByCoach(prev => {
      const next = { ...prev };
      delete next[coachId];
      return next;
    });
  }, [userId]);

  const value = useMemo(() => ({
    activeCoachId,
    messages,
    initCoachSession,
    switchCoach,
    setCoachMessages,
    appendCoachMessages,
    getCoachMessages,
    clearCoachSession,
  }), [
    activeCoachId,
    messages,
    initCoachSession,
    switchCoach,
    setCoachMessages,
    appendCoachMessages,
    getCoachMessages,
    clearCoachSession,
  ]);

  return (
    <CoachContext.Provider value={value}>
      {children}
    </CoachContext.Provider>
  );
}

export function useCoachSession() {
  const ctx = useContext(CoachContext);
  if (!ctx) {
    throw new Error('useCoachSession must be used within CoachProvider');
  }
  return ctx;
}

/** @deprecated Use useCoachSession */
export function useCoachChat() {
  return useCoachSession();
}

export function getDailyGreeting(profile) {
  const hour = new Date().getHours();
  const name = profile?.display_name || profile?.name || 'Athlete';
  if (hour < 12) return `Morning ${name}. Ready to work?`;
  if (hour < 17) return `${name}, afternoon session. Let's go.`;
  return `Evening ${name}. Finish strong today.`;
}
