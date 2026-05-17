export const speak = (text, coachId = 'elias', onEnd = null) => {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
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

      const voicePreferences = {
        elias: [
          allEn.find(voice => voice.name === 'Daniel'),
          allEn.find(voice => voice.name === 'Alex'),
          allEn.find(voice => voice.name === 'Google UK English Male'),
          allEn.find(voice => voice.name.includes('Male')),
          allEn[0],
        ],
        maya: [
          allEn.find(voice => voice.name === 'Samantha'),
          allEn.find(voice => voice.name === 'Victoria'),
          allEn.find(voice => voice.name === 'Google US English'),
          allEn.find(voice => voice.name.includes('Female')),
          allEn[1] || allEn[0],
        ],
        rex: [
          allEn.find(voice => voice.name === 'Fred'),
          allEn.find(voice => voice.name === 'Daniel'),
          allEn.find(voice => voice.name === 'Google UK English Male'),
          allEn[0],
        ],
      };

      const selectedVoice = (voicePreferences[coachId] || voicePreferences.elias).find(Boolean);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      const profiles = {
        elias: { rate: 0.82, pitch: 0.88 },
        maya: { rate: 1.18, pitch: 1.15 },
        rex: { rate: 0.95, pitch: 0.72 },
      };

      const profile = profiles[coachId] || profiles.elias;
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
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
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
