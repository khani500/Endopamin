import { useEffect, useRef, useState } from 'react';
import { getCoach } from '../../config/coaches';
import { useAuth } from '../../context/AuthContext';
import { buildCoachSystemPrompt, buildProfileContext } from '../../lib/coachChat';
import { GeminiLiveSession } from '../../lib/geminiLive';

const WELCOME_TRIGGER =
  '[VOICE_SESSION_START] Greet the athlete by first name in fluent Persian. Ask only about energy and mood today. Max 2 sentences. Plain spoken Farsi for TTS.';

export const VoiceConversation = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [coachReply, setCoachReply] = useState('');
  const [listenHint] = useState('');
  const [conversation, setConversation] = useState([]);
  const sessionRef = useRef(null);
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
  const canStartMic = status === 'idle' || status === 'closed';

  const buildSystemPrompt = () => {
    const ctx = buildProfileContext(profile, profile?.session_duration, profile?.location, []);
    return buildCoachSystemPrompt(coach.personality, { name: coach.name }, [], ctx);
  };

  const startSession = async () => {
    if (sessionRef.current) return;

    const session = new GeminiLiveSession({
      coachId,
      systemPrompt: buildSystemPrompt(),
      onText: text => {
        setCoachReply(prev => prev + text);
        setConversation(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'coach') {
            return [...prev.slice(0, -1), { role: 'coach', content: last.content + text }];
          }
          return [...prev, { role: 'coach', content: text }];
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
        console.error('Gemini Live error:', err);
        setStatus('closed');
      },
    });

    sessionRef.current = session;

    try {
      await session.connect();
      await session.startMic();
    } catch (err) {
      console.error('Gemini Live session failed:', err);
      sessionRef.current = null;
      setStatus('closed');
    }
  };

  const stopSession = () => {
    isSpeakingRef.current = false;
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    welcomeSentRef.current = false;
    setStatus('idle');
    setTranscript('');
    setCoachReply('');
  };

  const handleMicPress = () => {
    if (status === 'thinking' || status === 'speaking' || isSpeakingRef.current) {
      stopSession();
      setStatus('idle');
      return;
    }

    if (canStartMic) {
      void startSession();
      return;
    }

    if (status === 'listening') {
      stopSession();
    }
  };

  useEffect(() => {
    if (isOpen) {
      void startSession();
    } else {
      stopSession();
    }

    return () => stopSession();
  }, [isOpen]);

  if (!isOpen) return null;

  const statusLabel = statusLabels[status] || statusLabels.idle;
  const statusColor = statusColors[status] || statusColors.idle;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-6">
      <button
        type="button"
        onClick={() => {
          stopSession();
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
            ? 'Coach is speaking'
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
          ? 'Listen to your coach...'
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
              {message.content}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
