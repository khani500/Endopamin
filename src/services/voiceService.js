import { getCoach } from '../config/coaches';

function getVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

function pickVoice(coachId, voices) {
  const lowerName = voice => voice.name.toLowerCase();
  const englishVoices = voices.filter(voice => voice.lang?.toLowerCase().startsWith('en'));

  if (coachId === 'maya') {
    return englishVoices.find(voice => /samantha|karen|victoria|female|zira/.test(lowerName(voice))) || englishVoices[0];
  }

  if (coachId === 'rex') {
    return englishVoices.find(voice => /fred|gordon|daniel|male|alex/.test(lowerName(voice))) || englishVoices[0];
  }

  return englishVoices.find(voice => /daniel|alex|aaron|male/.test(lowerName(voice))) || englishVoices[0];
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

  const voice = pickVoice(coachId, getVoices());
  if (voice) utterance.voice = voice;

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

