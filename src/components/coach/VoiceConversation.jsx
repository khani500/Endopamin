import { useEffect, useRef, useState } from 'react';
import { getCoach } from '../../config/coaches';
import { useAuth } from '../../context/AuthContext';
import {
  buildCoachSystemPrompt,
  buildProfileContext,
  sanitizeCoachResponse,
  toGeminiContents,
} from '../../lib/coachChat';
import { askGeminiChat } from '../../lib/gemini';
import { GeminiLiveSession } from '../../lib/geminiLive';
import {
  isIOSDevice,
  createSpeechRecognition,
  prepareSpeechInputOnUserGesture,
  stopCoachAudio,
  playCoachAudio,
  resumeAudioContextOnUserGesture,
} from '../../lib/voice';

const WELCOME_TRIGGER =
  '[VOICE_SESSION_START] Greet the athlete by first name in fluent professional English. Ask only about energy and mood today. Max 2 sentences. Plain spoken English for TTS.';

export const VoiceConversation = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const isIOS = isIOSDevice();
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [coachReply, setCoachReply] = useState('');
  const [listenHint] = useState('');
  const [conversation, setConversation] = useState([]);
  const sessionRef = useRef(null);
  const recognitionRef = useRef(null);
  const iosHistoryRef = useRef([]);
  const iosTranscriptRef = useRef('');
  const shouldSubmitTranscriptRef = useRef(false);
  const iosAbortRef = useRef(null);
  const welcomeSentRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const prevStatusRef = useRef('idle');
  const coachId = profile?.coach_persona || 'elias';
  const coach = getCoach(coachId);

  const statusLabels = {
    idle: 'Tap to speak',
    connecting: 'Connecting...',
    ready: 'Ready',
    listening: 'Listening...',
    thinking: 'Coach is thinking...',
    speaking: `${coach.name} is speaking...`,
    closed: 'Disconnected',
  };

  const statusColors = {
    idle: 'bg-[#1a1a1a] border-[#2a2a2a]',
    connecting: 'bg-[#CCFF00]/10 border-[#CCFF00]/30',
    ready: 'bg-[#1a1a1a] border-[#2a2a2a]',
    listening: 'bg-red-500/20 border-red-500',
    thinking: 'bg-[#CCFF00]/10 border-[#CCFF00]/50',
    speaking: 'bg-[#CCFF00]/20 border-[#CCFF00]',
    closed: 'bg-[#1a1a1a] border-[#2a2a2a]',
  };

  const isBusy = status === 'thinking' || status === 'speaking' || status === 'connecting';
  const canStartMic = status === 'idle' || status === 'closed' || status === 'ready';

  const buildSystemPrompt = () => {
    const ctx = buildProfileContext(profile, profile?.session_duration, profile?.location, []);
    return buildCoachSystemPrompt(coach.personality, { name: coach.name, id: coachId }, [], ctx, {
      profile,
    });
  };

  const cleanupIosRecognition = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      } catch {
        // ignore
      }
    }
    recognitionRef.current = null;
    shouldSubmitTranscriptRef.current = false;
  };

  const runIosTurn = async rawText => {
    const text = String(rawText || '').trim();
    if (!text) {
      setStatus('ready');
      return;
    }

    stopCoachAudio();
    setStatus('thinking');
    setCoachReply('');
    const userMessage = { role: 'user', text };
    const historyWithUser = [...iosHistoryRef.current, userMessage];
    iosHistoryRef.current = historyWithUser;
    setConversation(historyWithUser);

    const controller = new AbortController();
    iosAbortRef.current = controller;

    try {
      const rawReply = await askGeminiChat({
        messages: toGeminiContents(historyWithUser),
        systemPrompt: buildSystemPrompt(),
        signal: controller.signal,
      });
      const reply = sanitizeCoachResponse(rawReply, coach.name);
      if (!reply) {
        setStatus('ready');
        return;
      }

      const assistantMessage = { role: 'assistant', text: reply };
      iosHistoryRef.current = [...historyWithUser, assistantMessage];
      setConversation(iosHistoryRef.current);
      setCoachReply(reply);
      setStatus('speaking');
      isSpeakingRef.current = true;

      await playCoachAudio(reply, coachId, { signal: controller.signal });

      isSpeakingRef.current = false;
      setStatus('ready');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('iOS voice turn failed:', err);
      }
      isSpeakingRef.current = false;
      setStatus('ready');
    } finally {
      iosAbortRef.current = null;
    }
  };

  const startIosListening = async () => {
    try {
      await resumeAudioContextOnUserGesture();
      await prepareSpeechInputOnUserGesture();
    } catch (err) {
      console.error('iOS audio/mic preparation failed:', err);
      setStatus('closed');
      return;
    }

    cleanupIosRecognition();
    iosTranscriptRef.current = '';
    setTranscript('');
    setCoachReply('');
    shouldSubmitTranscriptRef.current = false;

    const recognition = createSpeechRecognition({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
      onResult: event => {
        const result = event?.results?.[event.results.length - 1];
        const chunk = result?.[0]?.transcript?.trim() || '';
        if (chunk) {
          iosTranscriptRef.current = chunk;
          setTranscript(chunk);
        }
      },
      onError: err => {
        console.error('SpeechRecognition error:', err);
        setStatus('ready');
      },
      onEnd: () => {
        const hasTranscript = Boolean(iosTranscriptRef.current.trim());
        const shouldSubmit = shouldSubmitTranscriptRef.current || hasTranscript;
        shouldSubmitTranscriptRef.current = false;
        recognitionRef.current = null;
        if (shouldSubmit && iosTranscriptRef.current.trim()) {
          void runIosTurn(iosTranscriptRef.current);
        } else if (!isSpeakingRef.current) {
          setStatus('ready');
        }
      },
    });

    if (!recognition) {
      setStatus('closed');
      return;
    }

    recognitionRef.current = recognition;
    setStatus('listening');
    try {
      recognition.start();
    } catch (err) {
      console.error('Failed to start SpeechRecognition:', err);
      recognitionRef.current = null;
      setStatus('ready');
    }
  };

  const startSession = async () => {
    if (isIOS) {
      setStatus('ready');
      return;
    }

    if (sessionRef.current) return;

    const session = new GeminiLiveSession({
      coachId,
      systemPrompt: buildSystemPrompt(),
      onText: text => {
        setCoachReply(prev => prev + text);
        setConversation(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { role: 'assistant', text: last.text + text }];
          }
          return [...prev, { role: 'assistant', text }];
        });
      },
      onStatusChange: s => {
        const prev = prevStatusRef.current;
        prevStatusRef.current = s;
        setStatus(s);

        const coachIsOutputting = s === 'speaking' || s === 'thinking';
        isSpeakingRef.current = coachIsOutputting;

        if (coachIsOutputting) {
          sessionRef.current?.stopMic();
        } else if (
          s === 'listening'
          && sessionRef.current
          && (prev === 'speaking' || prev === 'thinking' || prev === 'ready')
        ) {
          void sessionRef.current.startMic().catch(err => {
            console.error('Mic resume after coach speech failed:', err);
          });
        }

        if (s === 'ready' && !welcomeSentRef.current) {
          welcomeSentRef.current = true;
          sessionRef.current?.sendText(WELCOME_TRIGGER);
        }

        if (s === 'listening') {
          setCoachReply('');
          setTranscript('');
        }
      },
      onError: err => {
        console.error('Gemini Live error, falling back to tap-to-speak:', err);
        sessionRef.current = null;
        setStatus('ready');
      },
    });

    sessionRef.current = session;

    try {
      await session.connect();
      await session.startMic();
    } catch (err) {
      console.error('Gemini Live session failed, falling back to tap-to-speak:', err);
      sessionRef.current = null;
      setStatus('ready');
    }
  };

  const stopVoiceSession = () => {
    iosAbortRef.current?.abort();
    iosAbortRef.current = null;
    stopCoachAudio();
    cleanupIosRecognition();
    isSpeakingRef.current = false;
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    iosHistoryRef.current = [];
    iosTranscriptRef.current = '';
    welcomeSentRef.current = false;
    setStatus('idle');
    setTranscript('');
    setCoachReply('');
  };

  const handleMicPress = () => {
    if (status === 'thinking' || status === 'speaking' || isSpeakingRef.current) {
      iosAbortRef.current?.abort();
      iosAbortRef.current = null;
      stopCoachAudio();
      stopVoiceSession();
      setStatus('idle');
      return;
    }

    if (canStartMic) {
      if (isIOS) {
        void startIosListening();
      } else {
        void startSession();
      }
      return;
    }

    if (status === 'listening') {
      if (isIOS && recognitionRef.current) {
        shouldSubmitTranscriptRef.current = true;
        setStatus('thinking');
        try {
          recognitionRef.current.stop();
        } catch (err) {
          console.error('Failed to stop SpeechRecognition:', err);
          shouldSubmitTranscriptRef.current = false;
          setStatus('ready');
        }
      } else {
        stopVoiceSession();
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      void startSession();
    } else {
      stopVoiceSession();
    }

    return () => stopVoiceSession();
  }, [isOpen, isIOS]);

  if (!isOpen) return null;

  const statusLabel = statusLabels[status] || statusLabels.idle;
  const statusColor = statusColors[status] || statusColors.idle;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-6">
      <button
        type="button"
        onClick={() => {
          stopVoiceSession();
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
          className={`relative flex h-24 w-24 items-center justify-center rounded-full border-4 text-5xl transition-all duration-300 ${statusColor}`}
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

      <div className={`mb-4 rounded-full border px-4 py-2 transition-all ${statusColor}`}>
        <p className={`text-sm font-medium ${status === 'idle' && !listenHint ? 'text-gray-400' : 'text-white'}`}>
          {statusLabel}
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
        className={`relative flex h-20 w-20 items-center justify-center rounded-full text-3xl transition-all duration-300 ${
          canStartMic
            ? 'bg-[#CCFF00] text-black'
            : status === 'listening'
              ? 'bg-red-500 text-white'
              : 'bg-[#2a2a2a] text-gray-400'
        }`}
        aria-label={
          isBusy
            ? 'Tap to interrupt coach'
            : canStartMic
              ? 'Tap to record your message'
              : 'Stop recording'
        }
      >
        {status === 'listening' && (
          <span className="absolute inset-0 animate-ping rounded-full bg-red-400/50" />
        )}
        <span className="relative">
          {canStartMic ? '🎤' : status === 'listening' ? '⏹' : '⏳'}
        </span>
      </button>

      <p className="mt-4 text-xs text-gray-600">
        {isBusy
          ? 'Tap mic to interrupt'
          : canStartMic
            ? 'Tap to start'
            : 'Tap to stop'}
      </p>

      {conversation.length > 0 && (
        <div className="mt-6 max-h-32 w-full max-w-sm space-y-2 overflow-y-auto">
          {conversation.slice(-4).map((message, index) => (
            <p
              key={`${message.role}-${index}`}
              className={`text-xs ${message.role === 'user' ? 'text-right text-gray-300' : 'text-left text-[#CCFF00]'}`}
            >
              {message.role === 'user' ? '🗣 ' : `${coach.avatar} `}
              {message.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
