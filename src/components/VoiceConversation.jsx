import { useEffect, useRef, useState } from 'react';
import { getCoach } from '../config/coaches';
import { useAuth } from '../context/AuthContext';
import { useWorkout } from '../context/WorkoutContext';
import {
  buildCoachSystemPrompt,
  buildProfileContext,
  sanitizeCoachResponse,
  toGeminiContents,
} from '../lib/coachChat';
import { buildCoachReferenceContext } from '../lib/coachContext';
import { askGeminiChat, buildKnowledgeContext } from '../lib/gemini';
import { GeminiLiveSession } from '../lib/geminiLive';
import {
  isIOSDevice,
  createSpeechRecognition,
  prepareSpeechInputOnUserGesture,
  stopCoachAudio,
  playCoachAudio,
  resumeAudioContextOnUserGesture,
} from '../lib/voice';

const WELCOME_TRIGGER =
  '[VOICE_SESSION_START] Greet the athlete by first name in fluent professional English. Ask only about energy and mood today. Max 2 sentences. Plain spoken English for TTS.';

export const VoiceConversation = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const { todayWorkout, nextWorkout } = useWorkout();

  useEffect(() => {
    console.log('=== VOICE WORKOUT DEBUG ===');
    console.log('todayWorkout:', todayWorkout);
    console.log('nextWorkout:', nextWorkout);
  }, [todayWorkout, nextWorkout]);

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
  const fallbackModeRef = useRef(false);
  const sessionStartingRef = useRef(false);
  const iosRestartTimerRef = useRef(null);
  const micReadyRef = useRef(false);
  const knowledgeContextRef = useRef('');
  const coachId = profile?.coach_persona || 'elias';
  const coach = getCoach(coachId);

  useEffect(() => {
    let cancelled = false;
    void buildKnowledgeContext(profile?.experience).then(context => {
      if (!cancelled) knowledgeContextRef.current = context;
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.experience]);

  /** iOS Safari blocks Gemini Live WebSocket — always use SpeechRecognition + TTS. */
  const usesSpeechPath = () => true;

  const clearIosRestartTimer = () => {
    if (iosRestartTimerRef.current != null) {
      window.clearTimeout(iosRestartTimerRef.current);
      iosRestartTimerRef.current = null;
    }
  };

  const activateFallbackFromLive = err => {
    console.error('Gemini Live failed, falling back to tap-to-speak:', err);
    try {
      sessionRef.current?.disconnect();
    } catch {
      // ignore
    }
    sessionRef.current = null;
    sessionStartingRef.current = false;
    fallbackModeRef.current = true;
    isSpeakingRef.current = false;
    welcomeSentRef.current = false;
    setStatus('ready');
  };

  const scheduleListenAfterSpeak = () => {
    clearIosRestartTimer();
    iosRestartTimerRef.current = window.setTimeout(() => {
      iosRestartTimerRef.current = null;
      if (!isOpen || isSpeakingRef.current || recognitionRef.current) return;
      if (!usesSpeechPath()) return;
      void startIosListening();
    }, 400);
  };

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
    console.log('WORKOUT INJECTED:', todayWorkout || nextWorkout);
    const workout = todayWorkout || nextWorkout;
    const workoutBlock = workout
      ? `CRITICAL OVERRIDE - THESE ARE THE ONLY EXERCISES ALLOWED TODAY:
Focus: ${workout.focus}
${workout.exercises?.map((e, i) => `${i + 1}. ${e?.name}: ${e?.sets} sets x ${e?.reps}, rest ${e?.rest}`).join('\n')}
DO NOT suggest any other exercises. DO NOT add warm-up or cool-down. ONLY use exercises listed above.
VOICE RULE: Max 2 sentences per response. No long introductions.`
      : 'No workout plan found.';

    const ctx = buildProfileContext(profile, profile?.session_duration, profile?.location, []);
    const existingSystemPrompt = buildCoachSystemPrompt(coach.personality, { name: coach.name, id: coachId }, [], ctx, {
      profile,
      knowledgeContext: knowledgeContextRef.current,
      referenceContext: buildCoachReferenceContext({
        location: profile?.location || 'gym',
        experience: profile?.experience,
        equipment: profile?.equipment,
        injuries: profile?.injuries,
        goal: profile?.goal,
      }),
    });

    return `${workoutBlock}\n\n${existingSystemPrompt}`;
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

      if (!controller.signal.aborted && usesSpeechPath()) {
        scheduleListenAfterSpeak();
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('iOS voice turn failed:', err);
        setCoachReply('ERR: ' + (err?.message || String(err)));
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
      if (!micReadyRef.current) {
        // Only request mic permission on first tap (requires user gesture)
        await prepareSpeechInputOnUserGesture();
        micReadyRef.current = true;
      }
    } catch (err) {
      console.error('Speech input preparation failed:', err);
      setStatus('ready');
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
      setStatus('ready');
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
    if (usesSpeechPath()) {
      setStatus('ready');
      return;
    }

    if (sessionRef.current || sessionStartingRef.current) return;

    sessionStartingRef.current = true;

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
        if (fallbackModeRef.current) return;

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
          && !fallbackModeRef.current
          && (prev === 'speaking' || prev === 'thinking' || prev === 'ready')
        ) {
          void sessionRef.current.startMic().catch(err => {
            console.error('Mic resume after coach speech failed:', err);
            activateFallbackFromLive(err);
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
        activateFallbackFromLive(err);
      },
    });

    sessionRef.current = session;

    try {
      await session.connect();
      if (fallbackModeRef.current) return;
      await session.startMic();
    } catch (err) {
      activateFallbackFromLive(err);
    } finally {
      sessionStartingRef.current = false;
    }
  };

  const stopVoiceSession = () => {
    clearIosRestartTimer();
    iosAbortRef.current?.abort();
    iosAbortRef.current = null;
    stopCoachAudio();
    cleanupIosRecognition();
    isSpeakingRef.current = false;
    sessionStartingRef.current = false;
    try {
      sessionRef.current?.disconnect();
    } catch {
      // ignore
    }
    sessionRef.current = null;
    iosHistoryRef.current = [];
    iosTranscriptRef.current = '';
    welcomeSentRef.current = false;
    fallbackModeRef.current = false;
    micReadyRef.current = false;
    prevStatusRef.current = 'idle';
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
      if (usesSpeechPath()) {
        void startIosListening();
      } else {
        void startSession();
      }
      return;
    }

    if (status === 'listening') {
      if (usesSpeechPath() && recognitionRef.current) {
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
    if (!isOpen) {
      stopVoiceSession();
      return () => stopVoiceSession();
    }

    if (isIOS) {
      setStatus('ready');
      return () => stopVoiceSession();
    }

    if (fallbackModeRef.current) {
      setStatus('ready');
      return () => stopVoiceSession();
    }

    void startSession();
    return () => stopVoiceSession();
  }, [isOpen]);

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
