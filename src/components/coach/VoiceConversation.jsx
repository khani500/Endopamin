import { useEffect, useRef, useState } from 'react';
import { getCoach } from '../../config/coaches';
import { useAuth } from '../../context/AuthContext';
import { askGemini } from '../../lib/gemini';
import { speak, stopSpeaking } from '../../lib/voice';

export const VoiceConversation = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [coachReply, setCoachReply] = useState('');
  const [conversation, setConversation] = useState([]);
  const recognitionRef = useRef(null);
  const restartTimerRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const coachId = profile?.coach_persona || 'elias';
  const coach = getCoach(coachId);

  const statusLabels = {
    idle: 'Tap to speak',
    listening: 'Listening...',
    thinking: 'Coach is thinking...',
    speaking: `${coach.name} is speaking...`,
  };

  const statusColors = {
    idle: 'bg-[#1a1a1a] border-[#2a2a2a]',
    listening: 'bg-red-500/20 border-red-500',
    thinking: 'bg-[#CCFF00]/10 border-[#CCFF00]/50',
    speaking: 'bg-[#CCFF00]/20 border-[#CCFF00]',
  };

  const stopVoiceSession = () => {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopSpeaking();
  };

  const handleStop = () => {
    stopVoiceSession();
    setStatus('idle');
  };

  const handleUserSpeech = async text => {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      setStatus('idle');
      return;
    }

    setStatus('thinking');
    setCoachReply('');

    const userMsg = { role: 'user', content: cleanText };
    const newConversation = [...conversation, userMsg];
    setConversation(newConversation);

    try {
      const historyText = newConversation
        .slice(-6)
        .map(message => `${message.role === 'user' ? 'User' : coach.name}: ${message.content}`)
        .join('\n');

      const prompt = `Conversation so far:
${historyText}

User just said: "${cleanText}"

Respond as ${coach.name} in 1-2 short sentences. Be conversational.`;

      const response = await askGemini(prompt, coach.personality);
      const coachMsg = { role: 'coach', content: response };

      setConversation(prev => [...prev, coachMsg]);
      setCoachReply(response);
      setStatus('speaking');

      await speak(response, coachId, () => {
        setStatus('idle');
        restartTimerRef.current = window.setTimeout(() => {
          if (isOpenRef.current) startListening();
        }, 800);
      });
    } catch (error) {
      console.error('Voice conversation error:', error);
      setStatus('idle');
    }
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      window.alert('Voice not supported. Please use Chrome.');
      return;
    }

    handleStop();
    setStatus('listening');
    setTranscript('');

    const recognition = new SpeechRecognition();
    let heardFinalResult = false;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = event => {
      const text = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('');

      setTranscript(text);

      const lastResult = event.results[event.results.length - 1];
      if (lastResult?.isFinal) {
        heardFinalResult = true;
        recognition.stop();
        void handleUserSpeech(text);
      }
    };

    recognition.onerror = () => {
      setStatus('idle');
      setTranscript('');
    };

    recognition.onend = () => {
      if (!heardFinalResult) setStatus('idle');
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) stopVoiceSession();
  }, [isOpen]);

  useEffect(() => () => stopVoiceSession(), []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-6">
      <button
        type="button"
        onClick={() => {
          handleStop();
          onClose();
        }}
        className="absolute right-6 top-6 text-2xl text-gray-400"
        aria-label="Close voice conversation"
      >
        x
      </button>

      <div
        className={`mb-6 flex h-24 w-24 items-center justify-center rounded-full border-4 text-5xl transition-all duration-300 ${statusColors[status]}`}
        style={{
          boxShadow:
            status === 'listening'
              ? '0 0 30px rgba(239,68,68,0.5)'
              : status === 'speaking'
                ? '0 0 30px rgba(204,255,0,0.5)'
                : 'none',
        }}
      >
        {coach.avatar}
      </div>

      <p className="mb-1 text-xl font-bold text-white">{coach.name}</p>
      <p className="mb-8 text-sm text-gray-400">{coach.title}</p>

      <div className={`mb-8 rounded-full border px-4 py-2 transition-all ${statusColors[status]}`}>
        <p className={`text-sm font-medium ${status === 'idle' ? 'text-gray-400' : 'text-white'}`}>
          {statusLabels[status]}
        </p>
      </div>

      {status === 'listening' && (
        <div className="mb-4 flex items-center gap-1">
          {[14, 24, 18, 30, 16].map((height, index) => (
            <div
              key={height}
              className="w-1 animate-bounce rounded-full bg-red-400"
              style={{
                height: `${height}px`,
                animationDelay: `${(index + 1) * 0.1}s`,
                animationDuration: '0.6s',
              }}
            />
          ))}
        </div>
      )}

      <div className="mb-8 min-h-16 w-full max-w-sm text-center">
        {status === 'listening' && transcript && <p className="text-sm italic text-white">&quot;{transcript}&quot;</p>}
        {(status === 'thinking' || status === 'speaking') && coachReply && (
          <p className="text-sm text-[#CCFF00]">&quot;{coachReply}&quot;</p>
        )}
      </div>

      <button
        type="button"
        onClick={status === 'idle' ? startListening : handleStop}
        className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl transition-all duration-300 ${
          status === 'idle'
            ? 'bg-[#CCFF00] text-black'
            : status === 'listening'
              ? 'animate-pulse bg-red-500 text-white'
              : 'bg-[#2a2a2a] text-gray-400'
        }`}
        aria-label={status === 'idle' ? 'Start voice conversation' : 'Stop voice conversation'}
      >
        {status === 'idle' ? '🎤' : status === 'listening' ? '⏹' : '⏳'}
      </button>

      <p className="mt-4 text-xs text-gray-600">{status === 'idle' ? 'Tap to start' : 'Tap to stop'}</p>

      {conversation.length > 0 && (
        <div className="mt-6 max-h-32 w-full max-w-sm space-y-2 overflow-y-auto">
          {conversation.slice(-4).map((message, index) => (
            <p
              key={`${message.role}-${index}`}
              className={`text-xs ${message.role === 'user' ? 'text-right text-gray-300' : 'text-left text-[#CCFF00]'}`}
            >
              {message.role === 'user' ? '🗣 ' : `${coach.avatar} `}
              {message.content}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
