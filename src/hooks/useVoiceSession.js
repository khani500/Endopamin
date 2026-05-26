import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeTranscript } from '../lib/coachChat';
import { stopCoachAudio } from '../lib/voice';
import { createVoiceSession, VOICE_SESSION_STATE } from '../services/voiceSession';

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

          const streamState = { text: '', done: false };

          sessionRef.current?.beginProcessing();

          try {
            const replyPromise = processUtteranceRef.current(text, {
              signal,
              streaming: true,
              voiceTurn: true,
              fromVoice: true,
              onToken: (_chunk, fullText) => {
                streamState.text = fullText;
              },
            });

            const speechPromise = speakReplyRef.current(null, {
              stream: true,
              getText: () => streamState.text,
              isComplete: () => streamState.done,
              signal,
              onSpeechStart: () => {
                sessionRef.current?.beginSpeaking();
              },
            }).catch(err => {
              if (err?.name !== 'AbortError') throw err;
            });

            const reply = await replyPromise;
            if (turnId !== turnIdRef.current || !sessionRef.current?.isActive()) return;

            streamState.done = true;

            if (reply && speechPromise) {
              await speechPromise;
            } else if (reply) {
              sessionRef.current.beginSpeaking();
              await speakReplyRef.current(reply, { signal }).catch(err => {
                if (err?.name !== 'AbortError') throw err;
              });
            }
          } catch (err) {
            if (err?.name === 'AbortError') return;
            console.error('Voice session utterance error:', err);
          } finally {
            streamState.done = true;
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

  const pauseCoachSpeech = useCallback(() => {
    turnIdRef.current += 1;
    cancelActiveTurn();
    stopCoachAudio();
    sessionRef.current?.interruptCoachSpeech?.();
  }, [cancelActiveTurn]);

  const toggleVoiceSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.isSupported()) {
      window.alert('Use Chrome for voice support.');
      return;
    }

    if (session.isActive()) {
      cancelActiveTurn();
      stopCoachAudio();
      session.stop();
      setLiveTranscript('');
      return;
    }

    stopCoachAudio();
    void session.start();
  }, [cancelActiveTurn]);

  const stopVoiceSession = useCallback(() => {
    cancelActiveTurn();
    stopCoachAudio();
    sessionRef.current?.stop();
    setLiveTranscript('');
  }, [cancelActiveTurn]);

  return {
    voiceState,
    liveTranscript,
    voiceSessionActive: voiceState !== VOICE_SESSION_STATE.IDLE,
    toggleVoiceSession,
    toggleVoice: toggleVoiceSession,
    stopVoiceSession,
    pauseCoachSpeech,
    VOICE_SESSION_STATE,
  };
}
