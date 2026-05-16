import { getCoach } from '../config/coaches';

function getVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

export const speak = (text, coachId = 'elias', onEnd = null) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('TTS not supported');
    return null;
  }

  window.speechSynthesis.cancel();

  const coach = getCoach(coachId);
  const utterance = new SpeechSynthesisUtterance(text);

  utterance.rate = coach.speechRate;
  utterance.pitch = coach.pitch;
  utterance.volume = 1.0;
  utterance.lang = 'en-US';

  const voices = getVoices();
  const voiceMap = {
    elias: voices.find(v => v.name.includes('Daniel') || v.name.includes('Alex') || v.lang === 'en-US'),
    maya: voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen')),
    rex: voices.find(v => v.name.includes('Fred') || v.name.includes('Gordon')),
  };

  if (voiceMap[coachId]) {
    utterance.voice = voiceMap[coachId];
  }

  if (onEnd) utterance.onend = onEnd;

  window.speechSynthesis.speak(utterance);
  return utterance;
};

export const stopSpeaking = () => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};

export const isSpeaking = () => {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking;
};

export const getAvailableVoices = () => getVoices();

