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

function createSilentKeepAlive() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { start: () => {}, stop: () => {} };

  let ctx = null;
  let source = null;

  return {
    async start() {
      if (!ctx) {
        ctx = new AudioCtx();
      }
      if (ctx.state === 'suspended') await ctx.resume();
      if (source) return;

      const sampleRate = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, sampleRate, sampleRate);
      buffer.getChannelData(0).fill(0);

      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
    },
    stop() {
      try {
        source?.stop?.(0);
      } catch {
        // ignore
      }
      source = null;
      if (ctx?.state !== 'closed') {
        void ctx?.close?.();
      }
      ctx = null;
    },
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

  const teardownSessionMedia = useCallback(() => {
    keepAliveRef.current.stop();
    clearMediaSession();
    syncMediaSessionPlaybackState('none');
  }, [syncMediaSessionPlaybackState]);

  const activateSessionMedia = useCallback(async () => {
    const meta = coachMetaRef.current;
    if (!meta?.name || !meta?.id) return;

    setupMediaSession(
      { coachName: meta.name, coachId: meta.id },
      {
        onPlay: () => {
          setNeedsContinueTap(false);
          void keepAliveRef.current.start();
          sessionRef.current?.resumeFromTap?.();
          syncMediaSessionPlaybackState('playing');
        },
        onPause: () => {
          sessionRef.current?.pauseToAwaitingTap?.();
          syncMediaSessionPlaybackState('paused');
        },
      },
    );

    await keepAliveRef.current.start();
    syncMediaSessionPlaybackState('playing');
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
    if (typeof document === 'undefined') return undefined;

    const onVisibilityChange = () => {
      const session = sessionRef.current;
      if (document.hidden) {
        if (session?.isActive()) {
          wasActiveBeforeHideRef.current = true;
        }
        return;
      }

      if (wasActiveBeforeHideRef.current && session?.isActive()) {
        wasActiveBeforeHideRef.current = false;
        void keepAliveRef.current.start();
        session.suspendForBackground?.();
        setNeedsContinueTap(true);
        syncMediaSessionPlaybackState('paused');
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [syncMediaSessionPlaybackState]);

  useEffect(() => {
    if (!sessionRef.current?.isActive?.()) return;
    const meta = coachMetaRef.current;
    if (!meta?.name || !meta?.id) return;

    setupMediaSession(
      { coachName: meta.name, coachId: meta.id },
      {
        onPlay: () => {
          setNeedsContinueTap(false);
          void keepAliveRef.current.start();
          sessionRef.current?.resumeFromTap?.();
          syncMediaSessionPlaybackState('playing');
        },
        onPause: () => {
          sessionRef.current?.pauseToAwaitingTap?.();
          syncMediaSessionPlaybackState('paused');
        },
      },
    );
  }, [coachMeta?.id, coachMeta?.name, syncMediaSessionPlaybackState]);

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
    setNeedsContinueTap(false);
    void keepAliveRef.current.start();
    sessionRef.current?.resumeFromTap?.();
    syncMediaSessionPlaybackState('playing');
  }, [syncMediaSessionPlaybackState]);

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
      teardownSessionMedia();
      return;
    }

    if (startingRef.current) return;
    startingRef.current = true;

    void (async () => {
      try {
        stopCoachAudio();
        await resumeAudioContextOnUserGesture();
        await prepareSpeechInputOnUserGesture();
        await session.start({ deferListening: true });
        await activateSessionMedia();
        await runWelcomeTurn();
      } catch (err) {
        console.error('Voice session start failed:', err);
        session.stop();
        teardownSessionMedia();
      } finally {
        startingRef.current = false;
      }
    })();
  }, [activateSessionMedia, cancelActiveTurn, resumeFromTap, runWelcomeTurn, teardownSessionMedia]);

  const stopVoiceSession = useCallback(() => {
    cancelActiveTurn();
    stopCoachAudio();
    sessionRef.current?.stop();
    setLiveTranscript('');
    startingRef.current = false;
    setNeedsContinueTap(false);
    wasActiveBeforeHideRef.current = false;
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
