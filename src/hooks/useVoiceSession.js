import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeTranscript } from '../lib/coachChat';
import {
  stopCoachAudio,
  prepareSpeechInputOnUserGesture,
  resumeAudioContextOnUserGesture,
} from '../lib/voice';
import { createVoiceSession, VOICE_SESSION_STATE } from '../services/voiceSession';

const WELCOME_TRIGGER =
  '[VOICE_SESSION_START] Greet the athlete by first name in fluent professional English. Ask only about energy and mood today. Max 2 sentences. Plain spoken English for TTS.';

/**
 * Duplex voice session: streaming Gemini replies, sentence TTS, and VAD barge-in.
 */
export function useVoiceSession({ processUtterance, speakReply }) {
  const [voiceState, setVoiceState] = useState(VOICE_SESSION_STATE.IDLE);
  const [liveTranscript, setLiveTranscript] = useState('');
  const sessionRef = useRef(null);
  const processUtteranceRef = useRef(processUtterance);
  const speakReplyRef = useRef(speakReply);
  const turnAbortRef = useRef(null);
  const turnIdRef = useRef(0);
  const startingRef = useRef(false);

  useEffect(() => {
    processUtteranceRef.current = processUtterance;
    speakReplyRef.current = speakReply;
  }, [processUtterance, speakReply]);

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
              onSpeechStart: () => {
                sessionRef.current?.beginSpeaking();
              },
            });
            if (turnId !== turnIdRef.current || !sessionRef.current?.isActive()) return;

            if (reply) {
              sessionRef.current?.beginSpeaking();
            }
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
    };
  }, [beginTurn, cancelActiveTurn]);

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
        onSpeechStart: () => {
          sessionRef.current?.beginSpeaking();
        },
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
    sessionRef.current?.resumeFromTap?.();
  }, []);

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
        await runWelcomeTurn();
      } catch (err) {
        console.error('Voice session start failed:', err);
        session.stop();
      } finally {
        startingRef.current = false;
      }
    })();
  }, [cancelActiveTurn, resumeFromTap, runWelcomeTurn]);

  const stopVoiceSession = useCallback(() => {
    cancelActiveTurn();
    stopCoachAudio();
    sessionRef.current?.stop();
    setLiveTranscript('');
    startingRef.current = false;
  }, [cancelActiveTurn]);

  return {
    voiceState,
    liveTranscript,
    voiceSessionActive: voiceState !== VOICE_SESSION_STATE.IDLE,
    toggleVoiceSession,
    toggleVoice: toggleVoiceSession,
    stopVoiceSession,
    pauseCoachSpeech,
    resumeFromTap,
    VOICE_SESSION_STATE,
  };
}
