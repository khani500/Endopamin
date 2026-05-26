import { isSpeaking, stopSpeaking } from '../lib/voice';
import { createVoiceActivityDetector } from '../lib/vad';

export const VOICE_SESSION_STATE = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
};

/**
 * Duplex voice session with continuous VAD and barge-in while the coach speaks.
 * Start → listen → process → speak (VAD stays hot) → listen again.
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
  let recognition = null;
  let micStream = null;
  let vad = null;
  let pausedForProcessing = false;
  let bargeInArmed = false;
  let lastFinalTranscript = '';
  let restartTimer = null;
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

  const scheduleRestart = (delayMs = 350) => {
    clearRestartTimer();
    if (!active || pausedForProcessing || coachOutputActive) return;
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
    setState(VOICE_SESSION_STATE.LISTENING);
    void startListening();
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

  /** Desktop continuous recognition (formerly beginDesktopRecognitionSession). */
  const startListening = async () => {
    if (!active || pausedForProcessing || coachOutputActive) return;

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

      if (!interim.trim() && !finalChunk.trim()) return;

      onInterimTranscript?.(`${finalChunk}${interim}`.trim());

      const finalText = finalChunk.trim();
      if (!finalText || finalText === lastFinalTranscript) return;

      lastFinalTranscript = finalText;
      pausedForProcessing = true;
      bargeInArmed = false;
      clearRestartTimer();
      stopRecognition();
      onUtteranceFinal?.(finalText);
    };

    r.onerror = event => {
      if (!active) return;
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech' && !pausedForProcessing) {
        scheduleRestart(200);
        return;
      }
      if (!pausedForProcessing) scheduleRestart(500);
    };

    r.onend = () => {
      recognition = null;
      if (active && !pausedForProcessing && !coachOutputActive) scheduleRestart(200);
    };

    try {
      r.start();
    } catch {
      scheduleRestart(500);
    }
  };

  const start = async () => {
    if (!isSupported()) {
      throw new Error('Speech recognition is not supported in this browser.');
    }

    active = true;
    pausedForProcessing = false;
    bargeInArmed = false;
    lastFinalTranscript = '';
    stopSpeaking();
    await startVadMonitor();
    await startListening();
  };

  const stop = () => {
    active = false;
    coachOutputActive = false;
    pausedForProcessing = false;
    bargeInArmed = false;
    lastFinalTranscript = '';
    clearRestartTimer();
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
    clearRestartTimer();
    stopRecognition();
    setVadBargeInEnabled(false);
    void startVadMonitor();
    setState(VOICE_SESSION_STATE.PROCESSING);
  };

  const beginSpeaking = () => {
    coachOutputActive = true;
    pausedForProcessing = true;
    bargeInArmed = true;
    clearRestartTimer();
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
    lastFinalTranscript = '';
    onInterimTranscript?.('');
    vad?.setCoachSpeaking?.(false);
    setVadBargeInEnabled(false);
    void startVadMonitor();
    void startListening();
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
    interruptCoachSpeech,
    triggerBargeIn,
    isActive: () => active,
    isSupported,
  };
}
