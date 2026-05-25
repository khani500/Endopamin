import { useEffect, useRef, useState } from 'react';
import { getCoach } from '../../config/coaches';
import { useAuth } from '../../context/AuthContext';
import { askGeminiChat } from '../../lib/gemini';
import {
  buildCoachSystemPrompt,
  buildProfileContext,
  sanitizeCoachResponse,
  sanitizeTranscript,
  toGeminiContents,
} from '../../lib/coachChat';
import {
  clearSpeechRecognitionRestart,
  destroySpeechRecognition,
  extractSpeechTranscript,
  IOS_SPEECH_HINT,
  isIOSDevice,
  isSpeechRecognitionSupported,
  prepareSpeechInputOnUserGesture,
  resumeAudioContextOnUserGesture,
  scheduleSpeechRecognitionRestart,
  createSpeechRecognition,
  stopCoachAudio,
  playCoachAudio,
} from '../../lib/voice';

const TTS_POST_END_DELAY_MS = 500;
const WELCOME_TRIGGER =
  '[VOICE_SESSION_START] The athlete just opened voice chat. Greet them by first name. Ask only today energy and mood. Max 3 sentences. Plain spoken text.';

export const VoiceConversation = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [coachReply, setCoachReply] = useState('');
  const [listenHint, setListenHint] = useState('');
  const [conversation, setConversation] = useState([]);
  const recognitionRef = useRef(null);
  const restartTimerRef = useRef(null);
  const postTtsTimerRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const listeningActiveRef = useRef(false);
  const welcomeRanRef = useRef(false);
  const sessionTranscriptRef = useRef('');
  const iosSubmittedRef = useRef(false);
  const statusRef = useRef(status);
  const conversationRef = useRef(conversation);
  const coachId = profile?.coach_persona || 'elias';
  const coach = getCoach(coachId);
  const ios = isIOSDevice();

  const statusLabels = {
    idle: ios ? 'Tap mic to record' : 'Tap to speak',
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

  const clearPostTtsTimer = () => {
    if (postTtsTimerRef.current) {
      window.clearTimeout(postTtsTimerRef.current);
      postTtsTimerRef.current = null;
    }
  };

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

  /** Stop recognition immediately — abort on iOS, destroy instance. */
  const haltRecognitionForTTS = () => {
    listeningActiveRef.current = false;
    clearRestartTimer();
    destroyCurrentRecognition();
  };

  const canAcceptSpeechInput = () =>
    !isSpeakingRef.current
    && statusRef.current !== 'thinking'
    && statusRef.current !== 'speaking';

  const onCoachTTSStart = () => {
    isSpeakingRef.current = true;
    haltRecognitionForTTS();
  };

  const enableMicAfterTTS = () => {
    clearPostTtsTimer();
    postTtsTimerRef.current = window.setTimeout(() => {
      postTtsTimerRef.current = null;
      isSpeakingRef.current = false;

      if (!isOpenRef.current) return;

      setStatus('idle');

      if (ios) {
        destroyCurrentRecognition();
        return;
      }

      if (isSpeechRecognitionSupported()) {
        void startListening();
      }
    }, TTS_POST_END_DELAY_MS);
  };

  const stopVoiceSession = () => {
    clearRestartTimer();
    clearPostTtsTimer();
    listeningActiveRef.current = false;
    isSpeakingRef.current = false;
    iosSubmittedRef.current = false;
    sessionTranscriptRef.current = '';
    destroyCurrentRecognition();
    stopCoachAudio();
  };

  const handleStop = () => {
    stopVoiceSession();
    setStatus('idle');
  };

  const getProfileContext = () =>
    buildProfileContext(profile, profile?.session_duration, profile?.location, []);

  const speakCoachReply = async text => {
    const reply = String(text || '').trim();
    if (!reply) return;

    onCoachTTSStart();
    setCoachReply(reply);
    setStatus('speaking');

    try {
      await resumeAudioContextOnUserGesture();
      await playCoachAudio(reply, coachId, {
        onEnd: enableMicAfterTTS,
      });
    } catch (error) {
      console.error('Coach TTS error:', error);
      isSpeakingRef.current = false;
      setStatus('idle');
      destroyCurrentRecognition();
    }
  };

  const fetchCoachReply = async historyMessages => {
    const systemPrompt = buildCoachSystemPrompt(
      coach.personality,
      { name: coach.name },
      historyMessages,
      getProfileContext(),
    );

    return sanitizeCoachResponse(
      await askGeminiChat({
        messages: toGeminiContents(historyMessages),
        systemPrompt,
      }),
      coach.name,
    );
  };

  const runAutoWelcome = async () => {
    if (welcomeRanRef.current || !isOpenRef.current) return;
    welcomeRanRef.current = true;

    setStatus('thinking');
    setListenHint('');
    haltRecognitionForTTS();

    try {
      const response = await fetchCoachReply([
        { role: 'user', text: WELCOME_TRIGGER },
      ]);

      const coachMsg = { role: 'coach', content: response };
      setConversation([coachMsg]);
      await speakCoachReply(response);
    } catch (error) {
      console.error('Auto welcome failed:', error);
      isSpeakingRef.current = false;
      setStatus('idle');
    }
  };

  const finishIOSRecording = async rawText => {
    if (iosSubmittedRef.current || isSpeakingRef.current) return;
    iosSubmittedRef.current = true;
    listeningActiveRef.current = false;
    destroyCurrentRecognition();

    const cleanText = sanitizeTranscript(String(rawText || '').trim());
    sessionTranscriptRef.current = '';

    if (!cleanText) {
      setStatus('idle');
      showListenHint();
      return;
    }

    clearListenHint();
    setTranscript(cleanText);
    await handleUserSpeech(cleanText);
  };

  const handleUserSpeech = async text => {
    if (isSpeakingRef.current) return;

    const cleanText = sanitizeTranscript(String(text || '').trim());
    if (!cleanText) {
      setStatus('idle');
      if (ios) showListenHint();
      return;
    }

    haltRecognitionForTTS();
    setStatus('thinking');
    setCoachReply('');

    const userMsg = { role: 'user', content: cleanText };
    const newConversation = [...conversationRef.current, userMsg];
    setConversation(newConversation);

    try {
      const historyMessages = newConversation.map(m => ({
        role: m.role === 'coach' ? 'assistant' : 'user',
        text: m.content,
      }));

      const response = await fetchCoachReply(historyMessages);
      const coachMsg = { role: 'coach', content: response };

      setConversation(prev => [...prev, coachMsg]);
      await speakCoachReply(response);
    } catch (error) {
      console.error('Voice conversation error:', error);
      isSpeakingRef.current = false;
      setStatus('idle');
    }
  };

  const beginIOSRecordingSession = () => {
    if (!listeningActiveRef.current || !isOpenRef.current || !canAcceptSpeechInput()) return;

    destroyCurrentRecognition();
    iosSubmittedRef.current = false;
    sessionTranscriptRef.current = '';

    const recognition = createSpeechRecognition({
      lang: 'en-US',
      interimResults: false,
      continuous: false,
      onResult: event => {
        if (!canAcceptSpeechInput()) return;

        const text = extractSpeechTranscript(event);
        if (!text) return;
        sessionTranscriptRef.current = text;
        setTranscript(text);
      },
      onError: event => {
        if (event?.error === 'aborted' || isSpeakingRef.current) return;
        listeningActiveRef.current = false;
        destroyCurrentRecognition();
        setStatus('idle');
        showListenHint();
      },
      onEnd: () => {
        recognitionRef.current = null;
        if (isSpeakingRef.current || iosSubmittedRef.current || !listeningActiveRef.current) {
          return;
        }
        void finishIOSRecording(sessionTranscriptRef.current);
      },
    });

    if (!recognition) {
      listeningActiveRef.current = false;
      setStatus('idle');
      showListenHint();
      return;
    }

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error('iOS speech recognition start failed:', error);
      listeningActiveRef.current = false;
      destroyCurrentRecognition();
      setStatus('idle');
      showListenHint();
    }
  };

  const beginDesktopRecognitionSession = () => {
    if (!listeningActiveRef.current || !isOpenRef.current || !canAcceptSpeechInput()) return;

    destroyCurrentRecognition();

    let heardFinalResult = false;

    const recognition = createSpeechRecognition({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      onResult: event => {
        if (!canAcceptSpeechInput()) return;

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
      onError: event => {
        if (event?.error === 'aborted' || isSpeakingRef.current) return;
        if (!heardFinalResult && listeningActiveRef.current) {
          listeningActiveRef.current = false;
          setStatus('idle');
          setTranscript('');
        }
        destroyCurrentRecognition();
      },
      onEnd: () => {
        recognitionRef.current = null;

        if (isSpeakingRef.current || heardFinalResult || !listeningActiveRef.current) {
          if (!heardFinalResult && !isSpeakingRef.current) {
            listeningActiveRef.current = false;
            setStatus('idle');
          }
          return;
        }

        if (statusRef.current === 'listening') {
          restartTimerRef.current = scheduleSpeechRecognitionRestart(() => {
            restartTimerRef.current = null;
            if (listeningActiveRef.current && canAcceptSpeechInput()) {
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
    if (!canAcceptSpeechInput()) return;

    if (!isSpeechRecognitionSupported()) {
      window.alert('Voice not supported. Please use Chrome or Safari.');
      return;
    }

    clearRestartTimer();
    clearPostTtsTimer();
    destroyCurrentRecognition();
    stopCoachAudio();

    listeningActiveRef.current = true;
    setStatus('listening');
    setTranscript('');
    clearListenHint();

    if (ios) {
      try {
        await prepareSpeechInputOnUserGesture();
        beginIOSRecordingSession();
      } catch (error) {
        console.error('iOS microphone unlock failed:', error);
        listeningActiveRef.current = false;
        setStatus('idle');
        showListenHint();
      }
      return;
    }

    beginDesktopRecognitionSession();
  };

  const handleMicPress = () => {
    if (isSpeakingRef.current || status === 'thinking' || status === 'speaking') return;

    if (status === 'listening') {
      if (ios) {
        void finishIOSRecording(sessionTranscriptRef.current);
      } else {
        handleStop();
      }
      return;
    }

    if (status === 'idle') {
      void startListening();
    }
  };

  const showListenHint = (message = IOS_SPEECH_HINT) => {
    setListenHint(message);
  };

  const clearListenHint = () => setListenHint('');

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      stopVoiceSession();
      welcomeRanRef.current = false;
      return;
    }

    void runAutoWelcome();
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

      <div className="relative mb-6 flex items-center justify-center">
        {status === 'listening' && (
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
      <p className="mb-8 text-sm text-gray-400">{coach.title}</p>

      <div className={`mb-4 rounded-full border px-4 py-2 transition-all ${statusColors[status]}`}>
        <p className={`text-sm font-medium ${status === 'idle' && !listenHint ? 'text-gray-400' : 'text-white'}`}>
          {statusLabels[status]}
        </p>
      </div>

      {status === 'listening' && (
        <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
          <span className="absolute inset-1 animate-pulse rounded-full border-2 border-red-400 bg-red-500/30" />
          <span className="relative text-xs font-semibold uppercase tracking-wide text-red-200">Rec</span>
        </div>
      )}

      <div className="mb-8 min-h-16 w-full max-w-sm text-center">
        {listenHint && status === 'idle' && (
          <p className="text-sm text-red-400">{listenHint}</p>
        )}
        {status === 'listening' && transcript && (
          <p className="text-sm italic text-white">&quot;{transcript}&quot;</p>
        )}
        {(status === 'thinking' || status === 'speaking') && coachReply && (
          <p className="text-sm text-[#CCFF00]">&quot;{coachReply}&quot;</p>
        )}
      </div>

      <button
        type="button"
        onClick={handleMicPress}
        disabled={isBusy}
        className={`relative flex h-20 w-20 items-center justify-center rounded-full text-3xl transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 ${
          status === 'idle'
            ? 'bg-[#CCFF00] text-black'
            : status === 'listening'
              ? 'bg-red-500 text-white'
              : 'bg-[#2a2a2a] text-gray-400'
        }`}
        aria-label={
          isBusy
            ? 'Coach is speaking'
            : status === 'idle'
              ? 'Tap to record your message'
              : 'Stop recording'
        }
      >
        {status === 'listening' && (
          <span className="absolute inset-0 animate-ping rounded-full bg-red-400/50" />
        )}
        <span className="relative">{status === 'idle' ? '🎤' : status === 'listening' ? '⏹' : '⏳'}</span>
      </button>

      <p className="mt-4 text-xs text-gray-600">
        {isBusy
          ? 'Listen to your coach...'
          : status === 'idle'
            ? (ios ? 'Tap mic, speak, then wait' : 'Tap to start')
            : (ios ? 'Tap stop when finished' : 'Tap to stop')}
      </p>

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
