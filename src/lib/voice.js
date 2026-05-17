export const speak = (text, coachId = 'elias', onEnd = null) => {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('TTS not supported');
      resolve();
      return;
    }

    window.speechSynthesis.cancel();

    const VOICE_PROFILES = {
      elias: { rate: 0.85, pitch: 0.9 },
      maya: { rate: 1.15, pitch: 1.1 },
      rex: { rate: 1.0, pitch: 0.75 },
    };

    const profile = VOICE_PROFILES[coachId] || VOICE_PROFILES.elias;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const enVoices = voices.filter(voice => voice.lang?.startsWith('en'));

      if (enVoices.length > 0) {
        const voiceMap = {
          elias: enVoices.find(voice => /daniel|alex|oliver|male/i.test(voice.name)) || enVoices[0],
          maya: enVoices.find(voice => /samantha|karen|victoria|female/i.test(voice.name)) || enVoices[1] || enVoices[0],
          rex: enVoices.find(voice => /fred|gordon|arthur/i.test(voice.name)) || enVoices[0],
        };
        utterance.voice = voiceMap[coachId] || enVoices[0];
      }

      utterance.onend = () => {
        if (onEnd) onEnd();
        resolve();
      };
      utterance.onerror = event => {
        console.error('TTS error:', event.error);
        resolve();
      };

      window.speechSynthesis.speak(utterance);

      window.setTimeout(() => {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }, 100);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      trySpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = trySpeak;
    }
  });
};

export const stopSpeaking = () => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};

export const isSpeaking = () => {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking;
};

export const getAvailableVoices = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
};
