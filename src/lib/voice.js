const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** iOS Safari stops SpeechRecognition after the first session unless recreated. */
export const IOS_SPEECH_RESTART_DELAY_MS = 300;

export const IOS_SPEECH_HINT = 'Tap mic and speak clearly';

let sharedAudioContext = null;
let audioContextUnlocked = false;

export function isIOSDevice() {
  return typeof navigator !== 'undefined'
    && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isSpeechRecognitionSupported() {
  return typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function getSpeechRecognitionClass() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Fully tear down an instance (required on iOS before starting a new session). */
export function destroySpeechRecognition(recognition) {
  if (!recognition) return;

  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  recognition.onstart = null;
  recognition.onspeechstart = null;
  recognition.onspeechend = null;

  try {
    recognition.abort();
  } catch {
    // ignore
  }
  try {
    recognition.stop();
  } catch {
    // ignore
  }
}

/**
 * Create a fresh SpeechRecognition instance.
 * iOS: non-continuous + caller restarts on `onend` after IOS_SPEECH_RESTART_DELAY_MS.
 */
/** Resume/create AudioContext inside a user gesture (required on iOS Safari). */
export async function resumeAudioContextOnUserGesture() {
  if (typeof window === 'undefined') return null;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioCtx();
  }

  if (sharedAudioContext.state === 'suspended') {
    await sharedAudioContext.resume();
  }

  return sharedAudioContext;
}

export async function unlockAudioContextForIOS() {
  if (audioContextUnlocked) return;
  if (!isIOSDevice()) return;
  if (typeof window === 'undefined') return;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    await ctx.resume();
    audioContextUnlocked = true;
    sharedAudioContext = ctx;
  } catch (e) {
    console.warn('iOS audio unlock failed:', e);
  }
}

/**
 * Unlock mic + audio on tap (iOS blocks SpeechRecognition without a gesture chain).
 */
export async function prepareSpeechInputOnUserGesture() {
  await resumeAudioContextOnUserGesture();

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone API unavailable');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  stream.getTracks().forEach(track => track.stop());
}

export function extractSpeechTranscript(event, { finalOnly = false } = {}) {
  if (!event?.results?.length) return '';

  let text = '';
  for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (finalOnly && !result.isFinal) continue;
    const chunk = result[0]?.transcript || '';
    if (chunk) text = chunk;
  }
  return text.trim();
}

export function createSpeechRecognition({
  lang = 'en-US',
  interimResults,
  continuous,
  onResult,
  onError,
  onEnd,
} = {}) {
  const SR = getSpeechRecognitionClass();
  if (!SR) return null;

  const ios = isIOSDevice();
  const recognition = new SR();
  recognition.lang = lang;
  recognition.interimResults = interimResults ?? !ios;
  recognition.continuous = continuous ?? false;
  recognition.maxAlternatives = 1;

  if (onResult) recognition.onresult = onResult;
  if (onError) recognition.onerror = onError;
  if (onEnd) recognition.onend = onEnd;

  return recognition;
}

/** Delay before starting a new recognition session (iOS needs ~300ms). */
export function getSpeechRecognitionRestartDelay(extraMs = 0) {
  return (isIOSDevice() ? IOS_SPEECH_RESTART_DELAY_MS : 0) + extraMs;
}

export function scheduleSpeechRecognitionRestart(callback, extraMs = 0) {
  const delay = getSpeechRecognitionRestartDelay(extraMs);
  if (typeof window === 'undefined') return null;
  return window.setTimeout(callback, delay);
}

export function clearSpeechRecognitionRestart(timerId) {
  if (timerId != null) window.clearTimeout(timerId);
}

/** Shared HTML5 Audio ref — stop/play targets this everywhere (mic, VAD, pause). */
export const coachAudioRef = { current: null };

const DUCK_VOLUME = 0.22;
let duckDepth = 0;
const duckedMediaVolumes = new Map();

/** Lower in-page media volume so coach TTS mixes instead of replacing it. */
export function duckBackgroundAudio() {
  duckDepth += 1;
  if (duckDepth > 1 || typeof document === 'undefined') return;

  document.querySelectorAll('audio, video').forEach(el => {
    if (el.paused || el.muted) return;
    if (!duckedMediaVolumes.has(el)) duckedMediaVolumes.set(el, el.volume);
    el.volume = Math.min(el.volume, DUCK_VOLUME);
  });
}

export function restoreBackgroundAudio() {
  if (duckDepth <= 0) return;
  duckDepth -= 1;
  if (duckDepth > 0) return;

  duckedMediaVolumes.forEach((volume, el) => {
    el.volume = volume;
  });
  duckedMediaVolumes.clear();
}

export function forceRestoreBackgroundAudio() {
  duckDepth = 0;
  duckedMediaVolumes.forEach((volume, el) => {
    el.volume = volume;
  });
  duckedMediaVolumes.clear();
}

/** Soft cue (~800 Hz, 80 ms) that the mic is open again. */
export async function playListeningBeep() {
  const ctx = await resumeAudioContextOnUserGesture();
  if (!ctx || ctx.state !== 'running') return;

  return new Promise(resolve => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.07, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => resolve();
    osc.start(start);
    osc.stop(start + 0.08);
  });
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

let playbackGeneration = 0;

const DEFAULT_NEURAL_VOICE = 'en-US-Neural2-F';

const COACH_NEURAL_VOICES = {
  aria: 'en-US-Neural2-F',
  zara: 'en-US-Neural2-F',
  nova: 'en-US-Neural2-F',
  blaze: 'en-US-Neural2-J',
  kane: 'en-US-Neural2-J',
  elias: 'en-US-Neural2-D',
  maya: 'en-US-Neural2-F',
  rex: 'en-US-Neural2-J',
};

function getTtsApiKey() {
  return import.meta.env.VITE_GOOGLE_TTS_API_KEY?.trim()
    || import.meta.env.VITE_GEMINI_API_KEY?.trim()
    || '';
}

function getCoachVoiceName(coachId) {
  return COACH_NEURAL_VOICES[coachId] || DEFAULT_NEURAL_VOICE;
}

/** Immediately stop any coach audio (HTML5 + browser TTS fallback). */
export function stopCoachAudio() {
  playbackGeneration += 1;
  forceRestoreBackgroundAudio();

  const playback = coachAudioRef.current;
  if (playback?.stop) {
    try {
      playback.stop();
    } catch {
      // ignore
    }
    coachAudioRef.current = null;
  } else if (playback) {
    try {
      if (!playback.paused) playback.pause();
      playback.currentTime = 0;
    } catch {
      // ignore
    }
    coachAudioRef.current = null;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export const stopSpeaking = stopCoachAudio;

/**
 * Synthesize and play coach speech via Google Cloud TTS (Neural2).
 * Always stops overlapping audio before fetching or playing a new clip.
 */

/** Fallback TTS using browser SpeechSynthesis (works without API key). */
async function speakWithSpeechSynthesis(text, signal) {
  duckBackgroundAudio();
  return new Promise(resolve => {
    const finish = () => {
      restoreBackgroundAudio();
      resolve();
    };

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      finish();
      return;
    }
    window.speechSynthesis.cancel();
    if (signal?.aborted) {
      finish();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.05;
    utterance.volume = 0.92;
    // Timeout fallback: iOS PWA sometimes blocks silently (no onend/onerror)
    const estimatedMs = Math.max(text.length * 65, 2500);
    const timeout = setTimeout(() => {
      window.speechSynthesis.cancel();
      finish();
    }, estimatedMs);

    utterance.onend = () => { clearTimeout(timeout); finish(); };
    utterance.onerror = () => { clearTimeout(timeout); finish(); };
    window.speechSynthesis.speak(utterance);
  });
}

export async function playCoachAudio(text, coachId = 'aria', { signal, onEnd } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  stopCoachAudio();

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const apiKey = getTtsApiKey();
  if (!apiKey) {
    console.warn('Google TTS API key missing — falling back to SpeechSynthesis');
    await speakWithSpeechSynthesis(trimmed, signal);
    onEnd?.();
    return;
  }

  const generation = playbackGeneration;

  const response = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: trimmed },
      voice: {
        languageCode: 'en-US',
        name: getCoachVoiceName(coachId),
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
      },
    }),
    signal,
  });

  const data = await response.json();
  if (!response.ok || !data.audioContent) {
    const errMsg = data.error?.message || 'Google TTS did not return audio.';
    console.warn('Google TTS failed, falling back to SpeechSynthesis:', errMsg);
    await speakWithSpeechSynthesis(trimmed, signal);
    onEnd?.();
    return;
  }

  if (signal?.aborted || generation !== playbackGeneration) {
    throw new DOMException('Aborted', 'AbortError');
  }

  stopCoachAudio();
  const playGeneration = playbackGeneration;

  const context = await resumeAudioContextOnUserGesture();
  // If AudioContext is missing or not running (PWA background/foreground switch), fall back immediately
  if (!context || context.state !== 'running') {
    console.warn('AudioContext not running (state:', context?.state, ') — using SpeechSynthesis');
    await speakWithSpeechSynthesis(trimmed, signal);
    onEnd?.();
    return;
  }

  let source;
  let settled = false;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (source) {
        try {
          source.stop(0);
        } catch {
          // ignore
        }
      }
      restoreBackgroundAudio();
      coachAudioRef.current = null;
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(async () => {
        duckBackgroundAudio();
        const audioBuffer = await context.decodeAudioData(base64ToArrayBuffer(data.audioContent));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const coachGain = context.createGain();
        coachGain.gain.value = 1;
        coachGain.connect(context.destination);

        source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(coachGain);
        coachAudioRef.current = {
          stop: () => {
            try {
              source.stop(0);
            } catch {
              // ignore
            }
          },
        };
        source.onended = () => {
          restoreBackgroundAudio();
          if (settled) return;
          settled = true;
          cleanup();
          if (playGeneration !== playbackGeneration) {
            resolve();
            return;
          }
          if (coachAudioRef.current?.stop) coachAudioRef.current = null;
          onEnd?.();
          resolve();
        };
        source.start(0);
      })
      .catch(async error => {
        restoreBackgroundAudio();
        if (error?.name === 'AbortError') {
          if (!settled) {
            settled = true;
            cleanup();
            reject(error);
          }
          return;
        }
        console.warn('AudioContext playback failed, falling back to SpeechSynthesis');
        if (!settled) {
          settled = true;
          cleanup();
          if (coachAudioRef.current?.stop) coachAudioRef.current = null;
          await speakWithSpeechSynthesis(trimmed, signal);
          onEnd?.();
          resolve();
        }
      });
  });
}

export const speak = playCoachAudio;
export const speakWithGoogleTTS = playCoachAudio;

export const isSpeaking = () => {
  const playback = coachAudioRef.current;
  return Boolean(playback)
    || (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking);
};

export const getAvailableVoices = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
};

function extractReadySentence(spokenIndex, text) {
  const slice = text.slice(spokenIndex);
  const match = slice.match(/^[\s\S]*?[.!?](?:\s+|$)/);
  if (!match) return null;
  const sentence = match[0].trim();
  if (!sentence) return null;
  return {
    sentence,
    nextIndex: spokenIndex + match[0].length,
  };
}

export function speakCancellable(text, coachId = 'aria', signal) {
  if (!text?.trim()) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return playCoachAudio(text, coachId, { signal }).catch(err => {
    if (err?.name === 'AbortError') throw err;
    console.error('speakCancellable error:', err);
  });
}

/** Speak a streaming Gemini reply sentence-by-sentence with Google TTS. */
export async function speakStreamingText(getText, coachId = 'aria', {
  signal,
  isComplete,
  onSentenceStart,
  onSpeechStart,
  speakSentence,
  pollMs = 45,
} = {}) {
  let spokenChars = 0;
  let speechStarted = false;
  const say = speakSentence
    ? (sentence, abortSignal) => speakSentence(sentence, abortSignal)
    : (sentence, abortSignal) => speakCancellable(sentence, coachId, abortSignal);

  const speakReady = async () => {
    const text = getText() || '';
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const ready = extractReadySentence(spokenChars, text);
      if (!ready) break;

      if (!speechStarted) {
        speechStarted = true;
        onSpeechStart?.();
      }

      spokenChars = ready.nextIndex;
      onSentenceStart?.(ready.sentence, text);
      await say(ready.sentence, signal);
    }
  };

  while (!isComplete?.()) {
    await speakReady();
    await new Promise(resolve => window.setTimeout(resolve, pollMs));
  }

  await speakReady();

  const tail = (getText() || '').slice(spokenChars).trim();
  if (tail) {
    if (!speechStarted) {
      speechStarted = true;
      onSpeechStart?.();
    }
    onSentenceStart?.(tail, getText());
    await say(tail, signal);
  }
}
