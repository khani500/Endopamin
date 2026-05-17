export const startListening = async (onResult, onError) => {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    onError('mic_not_supported');
    return null;
  }

  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = event => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
    };

    recognition.onerror = event => {
      console.error('Speech error:', event.error);
      onError(event.error);
    };

    recognition.start();
    return recognition;
  } catch (err) {
    console.error('Mic error:', err);
    onError('permission_denied');
    return null;
  }
};
