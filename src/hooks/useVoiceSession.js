import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeTranscript } from '../lib/coachChat';
import {
  stopCoachAudio,
  prepareSpeechInputOnUserGesture,
  resumeAudioContextOnUserGesture,
  VOICE_MODES,
} from '../lib/voice';
import { createVoiceSession, VOICE_SESSION_STATE } from '../services/voiceSession';

const WELCOME_TRIGGER =
  '[VOICE_SESSION_START] Greet the athlete by first name in fluent professional English. Ask only about energy and mood today. Max 2 sentences. Plain spoken English for TTS.';

const VOICE_PENDING_KEY = 'endopamin_voice_pending_resume';

function markVoiceSessionPending(coachId) {
  try {
    sessionStorage.setItem(VOICE_PENDING_KEY, coachId);
  } catch {
    // ignore quota errors
  }
}

function clearVoiceSessionPending() {
  try {
    sessionStorage.removeItem(VOICE_PENDING_KEY);
  } catch {
    // ignore
  }
}

function getVoiceSessionPending() {
  try {
    return sessionStorage.getItem(VOICE_PENDING_KEY);
  } catch {
    return null;
  }
}

function setupMediaSession({ coachName, coachId }, handlers) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Endopamin Coach',
    artist: coachName,
    artwork: [{ src: `/coaches/${coachId}.jpg`, sizes: '512x512', type: 'image/jpeg' }],
  });

  navigator.mediaSession.setActionHandler('play', handlers.onPlay);
  navigator.mediaSession.setActionHandler('pause', handlers.onPause);
}

function clearMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = null;
  ['play', 'pause'].forEach(action => {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // ignore unsupported actions
    }
  });
}

/** iOS background keep-alive: 1s silent buffer loop on a running AudioContext (no gain node). */
function createSilentKeepAlive() {
  let source = null;
  let audioContext = null;

  return {
    async start(ctx) {
      if (!ctx) {
        throw new Error('Silent keep-alive requires an AudioContext from a user gesture');
      }

      audioContext = ctx;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      if (source) return audioContext;

      const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
      buffer.getChannelData(0).fill(0);

      source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(audioContext.destination);
      source.start(0);

      return audioContext;
    },
    stop() {
      try {
        source?.stop?.(0);
      } catch {
        // ignore
      }
      source = null;
    },
    isRunning: () => Boolean(source),
  };
}

/**
 * Duplex voice session: streaming Gemini replies, sentence TTS, and VAD barge-in.
 */
export function useVoiceSession({ processUtterance, speakReply, voiceMode, coachMeta } = {}) {
  const [voiceState, setVoiceState] = useState(VOICE_SESSION_STATE.IDLE);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [needsContinueTap, setNeedsContinueTap] = useState(false);
  const sessionRef = useRef(null);
  const processUtteranceRef = useRef(processUtterance);
  const speakReplyRef = useRef(speakReply);
  const coachMetaRef = useRef(coachMeta);
  const voiceModeRef = useRef(voiceMode);
  const turnAbortRef = useRef(null);
  const turnIdRef = useRef(0);
  const startingRef = useRef(false);
  const keepAliveRef = useRef(createSilentKeepAlive());
  const wasActiveBeforeHideRef = useRef(false);
  const pendingRecoveryRef = useRef(false);

  useEffect(() => {
    processUtteranceRef.current = processUtterance;
    speakReplyRef.current = speakReply;
    coachMetaRef.current = coachMeta;
    voiceModeRef.current = voiceMode;
  }, [processUtterance, speakReply, coachMeta, voiceMode]);

  const cancelActiveTurn = useCallback(() => {
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
  }, []);

  const beginTurn = useCallback(() => {
    cancelActiveTurn();
    turnIdRef.current += 1;
    const abortController = new AbortController();
    turnAbortRef.current = abortController;
    return { turnId: turnIdRef.current, signal: abortController.signal };
  }, [cancelActiveTurn]);

  const syncMediaSessionPlaybackState = useCallback(state => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch {
      // ignore
    }
  }, []);

  const registerMediaSession = useCallback(() => {
    const meta = coachMetaRef.current;
    if (!meta?.name || !meta?.id) return;

    setupMediaSession(
      { coachName: meta.name, coachId: meta.id },
      {
        onPlay: () => {
          if (!sessionRef.current?.isActive()) return;
          sessionRef.current?.suspendForBackground?.();
          setNeedsContinueTap(true);
          syncMediaSessionPlaybackState('paused');
        },
        onPause: () => {
          sessionRef.current?.pauseToAwaitingTap?.();
          syncMediaSessionPlaybackState('paused');
        },
      },
    );
  }, [syncMediaSessionPlaybackState]);

  const startSessionMediaFromGesture = useCallback(async ctx => {
    await keepAliveRef.current.start(ctx);
    registerMediaSession();
    syncMediaSessionPlaybackState('playing');
  }, [registerMediaSession, syncMediaSessionPlaybackState]);

  const teardownSessionMedia = useCallback(() => {
    keepAliveRef.current.stop();
    clearMediaSession();
    syncMediaSessionPlaybackState('none');
  }, [syncMediaSessionPlaybackState]);

  const handleAppBackground = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.isActive() || session.isAwaitingTap?.()) return;

    wasActiveBeforeHideRef.current = true;
    session.suspendForBackground?.();
  }, []);

  const handleAppForeground = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.isActive()) return;
    if (!wasActiveBeforeHideRef.current && !session.isAwaitingTap?.()) return;

    wasActiveBeforeHideRef.current = false;
    if (!session.isAwaitingTap?.()) {
      session.suspendForBackground?.();
    }
    setNeedsContinueTap(true);
    syncMediaSessionPlaybackState('paused');
  }, [syncMediaSessionPlaybackState]);

  useEffect(() => {
    const session = createVoiceSession({
      onStateChange: setVoiceState,
      onInterimTranscript: setLiveTranscript,
      onBargeIn: () => {
        turnIdRef.current += 1;
        cancelActiveTurn();
      },
      onUtteranceFinal: rawText => {
        void (async () => {
          const { turnId, signal } = beginTurn();

          const text = sanitizeTranscript(rawText);
          if (!text || !sessionRef.current?.isActive()) {
            sessionRef.current?.resumeListening();
            return;
          }

          sessionRef.current?.beginProcessing();

          try {
            const reply = await processUtteranceRef.current(text, {
              signal,
              fromVoice: true,
              voiceTurn: true,
              onSpeechStart: voiceModeRef.current === VOICE_MODES.VOICE
                ? () => {
                    sessionRef.current?.beginSpeaking();
                  }
                : undefined,
            });
            if (turnId !== turnIdRef.current || !sessionRef.current?.isActive()) return;
          } catch (err) {
            if (err?.name === 'AbortError') return;
            console.error('Voice session utterance error:', err);
          } finally {
            if (turnId === turnIdRef.current) {
              sessionRef.current?.resumeListening();
              setLiveTranscript('');
              turnAbortRef.current = null;
            }
          }
        })();
      },
    });

    sessionRef.current = session;
    return () => {
      cancelActiveTurn();
      session.stop();
      teardownSessionMedia();
    };
  }, [beginTurn, cancelActiveTurn, teardownSessionMedia]);

  useEffect(() => {
    const pendingCoachId = getVoiceSessionPending();
    if (!pendingCoachId || pendingRecoveryRef.current) return;
    if (coachMeta?.id && pendingCoachId !== coachMeta.id) return;

    const session = sessionRef.current;
    if (!session || session.isActive()) return;

    pendingRecoveryRef.current = true;
    void (async () => {
      try {
        await session.start({ deferListening: true });
        session.suspendForBackground?.();
        setNeedsContinueTap(true);
      } catch (err) {
        console.error('Voice session recovery failed:', err);
        clearVoiceSessionPending();
      }
    })();
  }, [coachMeta?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const onVisibilityChange = () => {
      if (document.hidden) {
        handleAppBackground();
        return;
      }
      handleAppForeground();
    };

    const onPageHide = () => {
      handleAppBackground();
    };

    const onPageShow = () => {
      handleAppForeground();
    };

    const onWindowFocus = () => {
      handleAppForeground();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [handleAppBackground, handleAppForeground]);

  const runWelcomeTurn = useCallback(async () => {
    const session = sessionRef.current;
    if (!session?.isActive()) return;

    const { turnId, signal } = beginTurn();
    session.beginProcessing();

    try {
      await processUtteranceRef.current(WELCOME_TRIGGER, {
        signal,
        fromVoice: true,
        voiceTurn: true,
        skipHistory: true,
        onSpeechStart: voiceModeRef.current === VOICE_MODES.VOICE
          ? () => {
              sessionRef.current?.beginSpeaking();
            }
          : undefined,
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Voice welcome error:', err);
      }
    } finally {
      if (turnId === turnIdRef.current && sessionRef.current?.isActive()) {
        sessionRef.current.resumeListening();
        turnAbortRef.current = null;
      }
    }
  }, [beginTurn]);

  const pauseCoachSpeech = useCallback(() => {
    turnIdRef.current += 1;
    cancelActiveTurn();
    stopCoachAudio();
    sessionRef.current?.interruptCoachSpeech?.();
  }, [cancelActiveTurn]);

  const resumeFromTap = useCallback(() => {
    void (async () => {
      const session = sessionRef.current;
      if (!session?.isActive()) return;

      setNeedsContinueTap(false);
      wasActiveBeforeHideRef.current = false;

      try {
        const ctx = await resumeAudioContextOnUserGesture();
        await prepareSpeechInputOnUserGesture();
        await startSessionMediaFromGesture(ctx);
        session.resumeFromTap?.();
      } catch (err) {
        console.error('Voice session resume failed:', err);
        session.suspendForBackground?.();
        setNeedsContinueTap(true);
      }
    })();
  }, [startSessionMediaFromGesture]);

  const toggleVoiceSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.isSupported()) {
      window.alert('Use Chrome for voice support.');
      return;
    }

    if (session.isAwaitingTap?.()) {
      resumeFromTap();
      return;
    }

    if (session.isActive()) {
      cancelActiveTurn();
      stopCoachAudio();
      session.stop();
      setLiveTranscript('');
      startingRef.current = false;
      setNeedsContinueTap(false);
      wasActiveBeforeHideRef.current = false;
      pendingRecoveryRef.current = false;
      clearVoiceSessionPending();
      teardownSessionMedia();
      return;
    }

    if (startingRef.current) return;
    startingRef.current = true;

    void (async () => {
      try {
        stopCoachAudio();
        const ctx = await resumeAudioContextOnUserGesture();
        await keepAliveRef.current.start(ctx);
        await prepareSpeechInputOnUserGesture();
        await session.start({ deferListening: true });
        markVoiceSessionPending(coachMetaRef.current?.id || 'coach');
        registerMediaSession();
        syncMediaSessionPlaybackState('playing');
        await runWelcomeTurn();
      } catch (err) {
        console.error('Voice session start failed:', err);
        session.stop();
        clearVoiceSessionPending();
        teardownSessionMedia();
      } finally {
        startingRef.current = false;
      }
    })();
  }, [
    cancelActiveTurn,
    registerMediaSession,
    resumeFromTap,
    runWelcomeTurn,
    syncMediaSessionPlaybackState,
    teardownSessionMedia,
  ]);

  const stopVoiceSession = useCallback(() => {
    cancelActiveTurn();
    stopCoachAudio();
    sessionRef.current?.stop();
    setLiveTranscript('');
    startingRef.current = false;
    setNeedsContinueTap(false);
    wasActiveBeforeHideRef.current = false;
    pendingRecoveryRef.current = false;
    clearVoiceSessionPending();
    teardownSessionMedia();
  }, [cancelActiveTurn, teardownSessionMedia]);

  return {
    voiceState,
    liveTranscript,
    needsContinueTap,
    voiceSessionActive: voiceState !== VOICE_SESSION_STATE.IDLE,
    toggleVoiceSession,
    toggleVoice: toggleVoiceSession,
    stopVoiceSession,
    pauseCoachSpeech,
    resumeFromTap,
    VOICE_SESSION_STATE,
  };
}
