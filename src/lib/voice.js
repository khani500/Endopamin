let currentAudio = null;

const BEST_VOICES = {
  elias: ['Daniel', 'Alex', 'Oliver', 'Arthur'],
  maya: ['Samantha', 'Victoria', 'Karen', 'Moira'],
  rex: ['Daniel', 'Fred', 'Gordon'],
};

const WEB_SPEECH_PROFILES = {
  elias: { rate: 0.82, pitch: 0.88 },
  maya: { rate: 1.18, pitch: 1.15 },
  rex: { rate: 0.95, pitch: 0.72 },
};

const GOOGLE_VOICES = {
  elias: 'en-US-Neural2-D',
  maya: 'en-US-Neural2-F',
  rex: 'en-US-Neural2-J',
};

export const speak = (text, coachId = 'elias', onEnd = null) => {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onEnd) onEnd();
      resolve();
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.volume = 1.0;

    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const enUS = voices.filter(voice => voice.lang === 'en-US' || voice.lang === 'en_US');
      const enAll = voices.filter(voice => voice.lang?.startsWith('en'));
      const allEn = enUS.length > 0 ? enUS : enAll;
      const preferredNames = BEST_VOICES[coachId] || BEST_VOICES.elias;
      const selectedVoice =
        preferredNames.map(name => allEn.find(voice => voice.name.includes(name))).find(Boolean) ||
        allEn.find(voice => voice.name.includes('Male')) ||
        allEn[0];

      if (selectedVoice) utterance.voice = selectedVoice;

      const profile = WEB_SPEECH_PROFILES[coachId] || WEB_SPEECH_PROFILES.elias;
      utterance.rate = profile.rate;
      utterance.pitch = profile.pitch;

      utterance.onend = () => {
        if (onEnd) onEnd();
        resolve();
      };
      utterance.onerror = event => {
        console.error('TTS:', event.error);
        if (onEnd) onEnd();
        resolve();
      };

      window.speechSynthesis.speak(utterance);

      window.setTimeout(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 150);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      trySpeak();
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', trySpeak, { once: true });
    }
  });
};

export const speakWithGoogleTTS = async (text, coachId = 'elias', onEnd = null) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return speak(text, coachId, onEnd);

  try {
    stopSpeaking();

    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'en-US',
          name: GOOGLE_VOICES[coachId] || GOOGLE_VOICES.elias,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: coachId === 'maya' ? 1.2 : coachId === 'rex' ? 0.9 : 1.0,
          pitch: coachId === 'maya' ? 2.0 : coachId === 'rex' ? -4.0 : 0.0,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.audioContent) {
      throw new Error(data.error?.message || 'Google TTS did not return audio.');
    }

    currentAudio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
    return await new Promise(resolve => {
      currentAudio.onended = () => {
        currentAudio = null;
        if (onEnd) onEnd();
        resolve();
      };
      currentAudio.onerror = () => {
        currentAudio = null;
        resolve(speak(text, coachId, onEnd));
      };
      void currentAudio.play().catch(error => {
        console.error('Audio playback error:', error);
        currentAudio = null;
        resolve(speak(text, coachId, onEnd));
      });
    });
  } catch (error) {
    console.error('Google TTS error:', error);
    return speak(text, coachId, onEnd);
  }
};

export const stopSpeaking = () => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};

export const isSpeaking = () => {
  return Boolean(currentAudio) || (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking);
};

export const getAvailableVoices = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
};
