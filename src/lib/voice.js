const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** iOS Safari stops SpeechRecognition after the first session unless recreated. */
export const IOS_SPEECH_RESTART_DELAY_MS = 300;

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
export function createSpeechRecognition({
  lang = 'en-US',
  interimResults = true,
  continuous,
  onResult,
  onError,
  onEnd,
} = {}) {
  const SR = getSpeechRecognitionClass();
  if (!SR) return null;

  const recognition = new SR();
  recognition.lang = lang;
  recognition.interimResults = interimResults;
  recognition.continuous = continuous ?? !isIOSDevice();

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

let playbackGeneration = 0;

const DEFAULT_NEURAL_VOICE = 'en-US-Neural2-F';

const COACH_NEURAL_VOICES = {
  aria: 'en-US-Neural2-F',
  zara: 'en-US-Neural2-F',
  nova: 'en-US-Neural2-F',
  blaze: 'en-US-Neural2-J',
  kane: 'en-US-Neural2-D',
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

  const audio = coachAudioRef.current;
  if (audio) {
    try {
      if (!audio.paused) audio.pause();
      audio.currentTime = 0;
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
export async function playCoachAudio(text, coachId = 'aria', { signal, onEnd } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  stopCoachAudio();

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const apiKey = getTtsApiKey();
  if (!apiKey) {
    console.warn('Google TTS API key missing — set VITE_GOOGLE_TTS_API_KEY in .env.local');
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
    throw new Error(data.error?.message || 'Google TTS did not return audio.');
  }

  if (signal?.aborted || generation !== playbackGeneration) {
    throw new DOMException('Aborted', 'AbortError');
  }

  stopCoachAudio();
  const playGeneration = playbackGeneration;

  const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
  coachAudioRef.current = audio;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      stopCoachAudio();
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    audio.onended = () => {
      cleanup();
      if (playGeneration !== playbackGeneration) {
        resolve();
        return;
      }
      if (coachAudioRef.current === audio) coachAudioRef.current = null;
      onEnd?.();
      resolve();
    };

    audio.onerror = () => {
      cleanup();
      if (coachAudioRef.current === audio) coachAudioRef.current = null;
      reject(new Error('Coach audio playback failed.'));
    };

    void audio.play().catch(error => {
      cleanup();
      if (coachAudioRef.current === audio) coachAudioRef.current = null;
      reject(error);
    });
  });
}

export const speak = playCoachAudio;
export const speakWithGoogleTTS = playCoachAudio;

export const isSpeaking = () => {
  const audio = coachAudioRef.current;
  return Boolean(audio && !audio.paused && !audio.ended)
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
