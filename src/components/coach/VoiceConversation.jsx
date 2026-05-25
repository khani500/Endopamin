import { useEffect, useRef, useState } from 'react';
import { getCoach } from '../../config/coaches';
import { useAuth } from '../../context/AuthContext';
import { askGeminiChat } from '../../lib/gemini';
import {
  buildCoachSystemPrompt,
  sanitizeCoachResponse,
  sanitizeTranscript,
  toGeminiContents,
} from '../../lib/coachChat';
import {
  clearSpeechRecognitionRestart,
  destroySpeechRecognition,
  extractSpeechTranscript,
  isIOSDevice,
  isSpeechRecognitionSupported,
  scheduleSpeechRecognitionRestart,
  createSpeechRecognition,
  stopCoachAudio,
  playCoachAudio,
} from '../../lib/voice';

export const VoiceConversation = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [textInput, setTextInput] = useState('');
  const [coachReply, setCoachReply] = useState('');
  const [conversation, setConversation] = useState([]);
  const recognitionRef = useRef(null);
  const restartTimerRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const listeningActiveRef = useRef(false);
  const statusRef = useRef(status);
  const conversationRef = useRef(conversation);
  const textInputRef = useRef(null);
  const coachId = profile?.coach_persona || 'elias';
  const coach = getCoach(coachId);
  const ios = isIOSDevice();

  const statusLabels = ios
    ? {
        idle: 'Type a message below',
        listening: 'Listening...',
        thinking: 'Coach is thinking...',
        speaking: `${coach.name} is speaking...`,
      }
    : {
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

  const isBusy = status === 'thinking' || status === 'speaking';

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearSpeechRecognitionRestart(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const destroyCurrentRecognition = () => {
    destroySpeechRecognition(recognitionRef.current);
    recognitionRef.current = null;
  };

  const stopVoiceSession = () => {
    clearRestartTimer();
    listeningActiveRef.current = false;
    destroyCurrentRecognition();
    stopCoachAudio();
  };

  const handleStop = () => {
    stopVoiceSession();
    setStatus('idle');
  };

  const handleUserSpeech = async text => {
    const cleanText = sanitizeTranscript(String(text || '').trim());
    if (!cleanText) {
      setStatus('idle');
      return;
    }

    setStatus('thinking');
    setCoachReply('');
    if (ios) setTextInput('');

    const userMsg = { role: 'user', content: cleanText };
    const newConversation = [...conversationRef.current, userMsg];
    setConversation(newConversation);

    try {
      const historyMessages = newConversation.map(m => ({
        role: m.role === 'coach' ? 'assistant' : 'user',
        text: m.content,
      }));

      const systemPrompt = buildCoachSystemPrompt(
        coach.personality,
        { name: coach.name },
        historyMessages,
        `Name: ${profile?.display_name || 'Athlete'}`,
      );

      const response = sanitizeCoachResponse(
        await askGeminiChat({
          messages: toGeminiContents(historyMessages),
          systemPrompt,
        }),
        coach.name,
      );
      const coachMsg = { role: 'coach', content: response };

      setConversation(prev => [...prev, coachMsg]);
      setCoachReply(response);
      setStatus('speaking');

      await playCoachAudio(response, coachId, {
        onEnd: () => {
          setStatus('idle');
          if (ios) {
            textInputRef.current?.focus();
            return;
          }
          restartTimerRef.current = scheduleSpeechRecognitionRestart(() => {
            restartTimerRef.current = null;
            if (isOpenRef.current) void startListening();
          }, 800);
        },
      });
    } catch (error) {
      console.error('Voice conversation error:', error);
      setStatus('idle');
    }
  };

  const handleSendText = () => {
    if (isBusy) return;
    const message = textInput.trim();
    if (!message) return;
    setTranscript(message);
    void handleUserSpeech(message);
  };

  const handleTextKeyDown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendText();
    }
  };

  const beginDesktopRecognitionSession = () => {
    if (!listeningActiveRef.current || !isOpenRef.current) return;

    destroyCurrentRecognition();

    let heardFinalResult = false;

    const recognition = createSpeechRecognition({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      onResult: event => {
        const text = extractSpeechTranscript(event);
        setTranscript(text);

        const lastResult = event.results[event.results.length - 1];
        if (lastResult?.isFinal) {
          heardFinalResult = true;
          listeningActiveRef.current = false;
          destroyCurrentRecognition();
          void handleUserSpeech(text);
        }
      },
      onError: () => {
        if (!heardFinalResult && listeningActiveRef.current) {
          listeningActiveRef.current = false;
          setStatus('idle');
          setTranscript('');
        }
        destroyCurrentRecognition();
      },
      onEnd: () => {
        recognitionRef.current = null;

        if (heardFinalResult || !listeningActiveRef.current) {
          if (!heardFinalResult) {
            listeningActiveRef.current = false;
            setStatus('idle');
          }
          return;
        }

        if (statusRef.current === 'listening') {
          restartTimerRef.current = scheduleSpeechRecognitionRestart(() => {
            restartTimerRef.current = null;
            if (listeningActiveRef.current && statusRef.current === 'listening') {
              beginDesktopRecognitionSession();
            }
          });
        }
      },
    });

    if (!recognition) {
      listeningActiveRef.current = false;
      setStatus('idle');
      return;
    }

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error('Speech recognition start failed:', error);
      destroyCurrentRecognition();
      listeningActiveRef.current = false;
      setStatus('idle');
    }
  };

  const startListening = async () => {
    if (ios) return;

    if (!isSpeechRecognitionSupported()) {
      window.alert('Voice not supported. Please use Chrome or Safari.');
      return;
    }

    clearRestartTimer();
    destroyCurrentRecognition();
    stopCoachAudio();

    listeningActiveRef.current = true;
    setStatus('listening');
    setTranscript('');

    beginDesktopRecognitionSession();
  };

  const handleMicPress = () => {
    if (status === 'listening') {
      handleStop();
      return;
    }

    if (status === 'idle') {
      void startListening();
    }
  };

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) stopVoiceSession();
    if (isOpen && ios) {
      const timer = window.setTimeout(() => textInputRef.current?.focus(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, ios]);

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

      <div className="relative mb-6 flex items-center justify-center">
        {!ios && status === 'listening' && (
          <>
            <span className="absolute h-32 w-32 animate-ping rounded-full bg-red-500/30" />
            <span className="absolute h-28 w-28 animate-pulse rounded-full border-4 border-red-500 bg-red-500/25" />
          </>
        )}
        <div
          className={`relative flex h-24 w-24 items-center justify-center rounded-full border-4 text-5xl transition-all duration-300 ${statusColors[status]}`}
          style={{
            boxShadow:
              status === 'listening'
                ? '0 0 40px rgba(239,68,68,0.65)'
                : status === 'speaking'
                  ? '0 0 30px rgba(204,255,0,0.5)'
                  : 'none',
          }}
        >
          {coach.avatar}
        </div>
      </div>

      <p className="mb-1 text-xl font-bold text-white">{coach.name}</p>
      <p className="mb-4 text-sm text-gray-400">{coach.title}</p>

      {ios && (
        <p className="mb-6 max-w-sm text-center text-sm text-gray-500">
          Voice input coming soon — type your message
        </p>
      )}

      <div className={`mb-4 rounded-full border px-4 py-2 transition-all ${statusColors[status]}`}>
        <p className={`text-sm font-medium ${status === 'idle' ? 'text-gray-400' : 'text-white'}`}>
          {statusLabels[status]}
        </p>
      </div>

      {!ios && status === 'listening' && (
        <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
          <span className="absolute inset-1 animate-pulse rounded-full border-2 border-red-400 bg-red-500/30" />
          <span className="relative text-xs font-semibold uppercase tracking-wide text-red-200">Rec</span>
        </div>
      )}

      <div className="mb-6 min-h-16 w-full max-w-sm text-center">
        {!ios && status === 'listening' && transcript && (
          <p className="text-sm italic text-white">&quot;{transcript}&quot;</p>
        )}
        {(status === 'thinking' || status === 'speaking') && coachReply && (
          <p className="text-sm text-[#CCFF00]">&quot;{coachReply}&quot;</p>
        )}
      </div>

      {ios ? (
        <div className="w-full max-w-sm">
          <div className="flex items-end gap-2 rounded-2xl border border-[#2a2a2a] bg-[#141414] p-2 shadow-inner">
            <textarea
              ref={textInputRef}
              value={textInput}
              onChange={event => setTextInput(event.target.value)}
              onKeyDown={handleTextKeyDown}
              placeholder="Message your coach..."
              rows={1}
              disabled={isBusy}
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="on"
              className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl bg-transparent px-3 py-2.5 text-base text-white placeholder:text-gray-500 focus:outline-none disabled:opacity-50"
              style={{ WebkitAppearance: 'none' }}
            />
            <button
              type="button"
              onClick={handleSendText}
              disabled={isBusy || !textInput.trim()}
              className="mb-0.5 flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-xl bg-[#CCFF00] px-4 text-sm font-semibold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send message"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={handleMicPress}
            className={`relative flex h-20 w-20 items-center justify-center rounded-full text-3xl transition-all duration-300 ${
              status === 'idle'
                ? 'bg-[#CCFF00] text-black'
                : status === 'listening'
                  ? 'bg-red-500 text-white'
                  : 'bg-[#2a2a2a] text-gray-400'
            }`}
            aria-label={status === 'idle' ? 'Tap to record your message' : 'Stop recording'}
          >
            {status === 'listening' && (
              <span className="absolute inset-0 animate-ping rounded-full bg-red-400/50" />
            )}
            <span className="relative">{status === 'idle' ? '🎤' : status === 'listening' ? '⏹' : '⏳'}</span>
          </button>

          <p className="mt-4 text-xs text-gray-600">
            {status === 'idle' ? 'Tap to start' : 'Tap to stop'}
          </p>
        </>
      )}

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
