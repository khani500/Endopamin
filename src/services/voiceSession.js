import {
  isSpeaking,
  stopSpeaking,
  playListeningBeep,
  isIOSDevice,
  IOS_SPEECH_RESTART_DELAY_MS,
} from '../lib/voice';
import { createVoiceActivityDetector } from '../lib/vad';

export const VOICE_SESSION_STATE = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  AWAITING_TAP: 'awaiting_tap',
};

export const SILENCE_TIMEOUT_MS = 5000;
export const LISTEN_RESUME_DELAY_MS = 600;

/**
 * Duplex voice session with continuous VAD, barge-in, silence timeout, and hands-free loop.
 * Start → listen → process → speak (music ducks) → beep → listen again.
 */
export function createVoiceSession({
  onStateChange,
  onInterimTranscript,
  onUtteranceFinal,
  onBargeIn,
  lang = 'en-US',
  enableBargeIn = true,
} = {}) {
  let active = false;
  let awaitingTap = false;
  let recognition = null;
  let micStream = null;
  let vad = null;
  let pausedForProcessing = false;
  let bargeInArmed = false;
  let lastFinalTranscript = '';
  let restartTimer = null;
  let resumeTimer = null;
  let silenceTimer = null;
  let bargeInCooldownUntil = 0;
  let coachOutputActive = false;

  const setState = state => onStateChange?.(state);

  const shouldIgnoreMicInput = () =>
    coachOutputActive
    || pausedForProcessing
    || isSpeaking();

  const clearRestartTimer = () => {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const clearResumeTimer = () => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };

  const clearSilenceTimer = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  const isSupported = () =>
    typeof window !== 'undefined'
    && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const ensureMicStream = async () => {
    if (micStream) return micStream;
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    return micStream;
  };

  const releaseMicStream = () => {
    micStream?.getTracks?.().forEach(track => track.stop());
    micStream = null;
  };

  const stopRecognition = () => {
    try {
      recognition?.abort?.();
    } catch {
      // ignore
    }
    try {
      recognition?.stop?.();
    } catch {
      // ignore
    }
    recognition = null;
  };

  const enterAwaitingTap = () => {
    if (!active || pausedForProcessing || coachOutputActive) return;

    clearRestartTimer();
    clearSilenceTimer();
    stopRecognition();
    awaitingTap = true;
    onInterimTranscript?.('');
    setState(VOICE_SESSION_STATE.AWAITING_TAP);
  };

  const resetSilenceTimer = () => {
    clearSilenceTimer();
    if (!active || pausedForProcessing || coachOutputActive || awaitingTap) return;

    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      enterAwaitingTap();
    }, SILENCE_TIMEOUT_MS);
  };

  const scheduleRestart = (delayMs = 350) => {
    clearRestartTimer();
    if (!active || pausedForProcessing || coachOutputActive || awaitingTap) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void startListening();
    }, delayMs);
  };

  const triggerBargeIn = () => {
    if (!active || !enableBargeIn || !bargeInArmed) return;
    if (performance.now() < bargeInCooldownUntil) return;

    bargeInArmed = false;
    bargeInCooldownUntil = performance.now() + 450;

    stopSpeaking();
    onBargeIn?.();

    pausedForProcessing = false;
    lastFinalTranscript = '';
    onInterimTranscript?.('');
    clearRestartTimer();
    stopRecognition();
    vad?.reset?.();
    resumeListening();
  };

  const setVadBargeInEnabled = enabled => {
    if (!vad) return;
    vad.setBargeInEnabled?.(enabled);
  };

  const startVadMonitor = async () => {
    if (!enableBargeIn || vad?.isRunning?.()) return;

    try {
      const stream = await ensureMicStream();
      if (!vad) {
        vad = createVoiceActivityDetector({
          onSpeechStart: () => {
            stopSpeaking();
            if (bargeInArmed) triggerBargeIn();
          },
          minSpeechMs: 380,
          threshold: 0.032,
        });
      }
      await vad.start(stream);
    } catch (err) {
      console.warn('VAD monitor unavailable:', err);
    }
  };

  const stopVadMonitor = () => {
    vad?.stop?.();
    vad = null;
  };

  const startListening = async () => {
    if (!active || pausedForProcessing || coachOutputActive || awaitingTap) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    stopRecognition();

    try {
      await ensureMicStream();
    } catch (err) {
      console.error('Microphone access failed:', err);
      return;
    }

    const r = new SR();
    recognition = r;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;

    r.onstart = () => {
      if (shouldIgnoreMicInput()) return;
      bargeInArmed = false;
      if (!coachOutputActive) stopSpeaking();
      setState(VOICE_SESSION_STATE.LISTENING);
      resetSilenceTimer();
    };

    r.onspeechstart = () => {
      if (shouldIgnoreMicInput()) return;
      resetSilenceTimer();
    };

    r.onresult = event => {
      if (shouldIgnoreMicInput()) return;

      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || '';
        if (result.isFinal) finalChunk += transcript;
        else interim += transcript;
      }

      if (interim.trim() || finalChunk.trim()) resetSilenceTimer();

      if (!interim.trim() && !finalChunk.trim()) return;

      onInterimTranscript?.(`${finalChunk}${interim}`.trim());

      const finalText = finalChunk.trim();
      if (!finalText || finalText === lastFinalTranscript) return;

      lastFinalTranscript = finalText;
      pausedForProcessing = true;
      bargeInArmed = false;
      clearRestartTimer();
      clearSilenceTimer();
      stopRecognition();
      onUtteranceFinal?.(finalText);
    };

    r.onerror = event => {
      if (!active) return;
      if (event.error === 'aborted') return;
      if (awaitingTap) return;
      if (event.error === 'no-speech' && !pausedForProcessing) {
        scheduleRestart(200);
        return;
      }
      if (!pausedForProcessing) scheduleRestart(500);
    };

    r.onend = () => {
      recognition = null;
      if (active && !pausedForProcessing && !coachOutputActive && !awaitingTap) {
        scheduleRestart(200);
      }
    };

    try {
      r.start();
    } catch {
      scheduleRestart(500);
    }
  };

  const scheduleListeningResume = () => {
    clearResumeTimer();
    const iosExtra = isIOSDevice() ? IOS_SPEECH_RESTART_DELAY_MS : 0;

    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!active || pausedForProcessing || coachOutputActive || awaitingTap) return;

      void (async () => {
        await playListeningBeep();
        if (!active || pausedForProcessing || coachOutputActive || awaitingTap) return;
        void startListening();
      })();
    }, LISTEN_RESUME_DELAY_MS + iosExtra);
  };

  const start = async ({ deferListening = false } = {}) => {
    if (!isSupported()) {
      throw new Error('Speech recognition is not supported in this browser.');
    }

    active = true;
    awaitingTap = false;
    pausedForProcessing = false;
    bargeInArmed = false;
    lastFinalTranscript = '';
    stopSpeaking();
    await startVadMonitor();

    if (deferListening) {
      setState(VOICE_SESSION_STATE.PROCESSING);
      return;
    }

    scheduleListeningResume();
  };

  const stop = () => {
    active = false;
    awaitingTap = false;
    coachOutputActive = false;
    pausedForProcessing = false;
    bargeInArmed = false;
    lastFinalTranscript = '';
    clearRestartTimer();
    clearResumeTimer();
    clearSilenceTimer();
    stopRecognition();
    stopVadMonitor();
    releaseMicStream();
    stopSpeaking();
    onInterimTranscript?.('');
    setState(VOICE_SESSION_STATE.IDLE);
  };

  const beginProcessing = () => {
    coachOutputActive = true;
    pausedForProcessing = true;
    bargeInArmed = false;
    awaitingTap = false;
    clearRestartTimer();
    clearResumeTimer();
    clearSilenceTimer();
    stopRecognition();
    setVadBargeInEnabled(false);
    void startVadMonitor();
    setState(VOICE_SESSION_STATE.PROCESSING);
  };

  const beginSpeaking = () => {
    coachOutputActive = true;
    pausedForProcessing = true;
    bargeInArmed = true;
    awaitingTap = false;
    clearRestartTimer();
    clearResumeTimer();
    clearSilenceTimer();
    stopRecognition();
    vad?.setCoachSpeaking?.(true);
    setVadBargeInEnabled(true);
    void startVadMonitor();
    setState(VOICE_SESSION_STATE.SPEAKING);
  };

  /** Resume mic after coach TTS finishes (while session still active). */
  const resumeListening = () => {
    if (!active) return;

    coachOutputActive = false;
    pausedForProcessing = false;
    bargeInArmed = false;
    awaitingTap = false;
    lastFinalTranscript = '';
    onInterimTranscript?.('');
    vad?.setCoachSpeaking?.(false);
    setVadBargeInEnabled(false);
    void startVadMonitor();
    scheduleListeningResume();
  };

  /** Re-enter hands-free loop after silence timeout (requires prior user gesture). */
  const resumeFromTap = () => {
    if (!active || !awaitingTap) return;
    awaitingTap = false;
    resumeListening();
  };

  /** Stop coach audio and return to listening without ending the session. */
  const interruptCoachSpeech = () => {
    if (!active) return;
    stopSpeaking();
    onBargeIn?.();
    resumeListening();
  };

  return {
    start,
    stop,
    beginProcessing,
    beginSpeaking,
    resumeListening,
    resumeFromTap,
    interruptCoachSpeech,
    triggerBargeIn,
    isActive: () => active,
    isAwaitingTap: () => awaitingTap,
    isSupported,
  };
}
