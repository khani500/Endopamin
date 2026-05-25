/**
 * Lightweight RMS-based voice activity detection on a shared mic stream.
 * Used for barge-in while the coach TTS is playing.
 */
export function createVoiceActivityDetector({
  onSpeechStart,
  threshold = 0.018,
  minSpeechMs = 180,
  hangoverMs = 280,
} = {}) {
  let audioContext = null;
  let analyser = null;
  let mediaStream = null;
  let rafId = null;
  let running = false;
  let armed = true;
  let bargeInEnabled = false;
  let coachSpeaking = false;
  let speechStartedAt = 0;
  let aboveThresholdSince = 0;
  let firedSpeechStart = false;

  const getThreshold = () => threshold;

  const loop = () => {
    if (!running || !analyser) return;

    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const sample = (data[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / data.length);
    const now = performance.now();

    if (armed && bargeInEnabled && rms >= getThreshold()) {
      if (!aboveThresholdSince) aboveThresholdSince = now;
      if (!firedSpeechStart && now - aboveThresholdSince >= minSpeechMs) {
        firedSpeechStart = true;
        speechStartedAt = aboveThresholdSince;
        onSpeechStart?.({ rms, at: speechStartedAt });
      }
    } else if (firedSpeechStart && rms < getThreshold() * 0.85) {
      if (now - speechStartedAt >= hangoverMs) {
        firedSpeechStart = false;
        aboveThresholdSince = 0;
      }
    } else if (rms < getThreshold()) {
      aboveThresholdSince = 0;
    }

    rafId = requestAnimationFrame(loop);
  };

  const start = async (existingStream = null) => {
    if (running) return;

    if (existingStream) {
      mediaStream = existingStream;
    } else {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }

    audioContext = new AudioContext();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);

    running = true;
    armed = true;
    firedSpeechStart = false;
    aboveThresholdSince = 0;
    rafId = requestAnimationFrame(loop);
  };

  const stop = () => {
    running = false;
    armed = false;
    firedSpeechStart = false;
    aboveThresholdSince = 0;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }

    analyser = null;
  };

  /** While coach TTS plays, delay VAD arming to ignore speaker bleed. */
  const setCoachSpeaking = speaking => {
    coachSpeaking = speaking;
    if (speaking) {
      armed = false;
      firedSpeechStart = false;
      aboveThresholdSince = 0;
      window.setTimeout(() => {
        if (coachSpeaking) {
          armed = true;
          firedSpeechStart = false;
          aboveThresholdSince = 0;
        }
      }, 700);
    } else {
      armed = true;
      firedSpeechStart = false;
      aboveThresholdSince = 0;
    }
  };

  const setBargeInEnabled = enabled => {
    bargeInEnabled = enabled;
    if (!enabled) {
      firedSpeechStart = false;
      aboveThresholdSince = 0;
    }
  };

  const reset = () => {
    firedSpeechStart = false;
    aboveThresholdSince = 0;
  };

  const getStream = () => mediaStream;

  return {
    start,
    stop,
    reset,
    setCoachSpeaking,
    setBargeInEnabled,
    isRunning: () => running,
    getStream,
  };
}
