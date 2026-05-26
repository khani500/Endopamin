import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, Send, Volume2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCoachChat } from '../context/CoachContext';
import { supabase } from '../lib/supabase';
import { stripMarkdown } from '../lib/gemini';
import { chatWithCoach } from '../services/coachAI';
import { useCoach } from '../hooks/useCoach';
import { isSpeaking } from '../../lib/voice';
import { useTokenGuard } from '../hooks/useTokenGuard';

const QUICK_ACTIONS = [
  { label: '📅 Give me my weekly plan', message: 'Give me a complete weekly workout plan based on my goal and level' },
  { label: '💪 Today\'s workout', message: 'What should I train today?' },
  { label: '🥗 Nutrition advice', message: 'Give me nutrition advice for my goal' },
  { label: '😴 Recovery tips', message: 'How should I recover between sessions?' },
  { label: '📈 Track my progress', message: 'How do I know if I\'m making progress?' },
];

const QUICK_REPLIES = ['Done ✓', 'Too hard', 'Next exercise', 'Rest day'];

const TONE_TO_PERSONA = {
  motivational: 'maya',
  calm: 'elias',
  strict: 'rex',
};

const PERSONA_TO_TONE = {
  maya: 'motivational',
  elias: 'calm',
  rex: 'strict',
};

export default function CoachPage() {
  const location = useLocation();
  const { user, profile, setProfile } = useAuth();
  const { coach, personaId, setPersona, message, speak } = useCoach();
  const { checkAndConsume } = useTokenGuard();
  const [tokenError, setTokenError] = useState('');
  const { conversationHistory, lastCoachMessage, setConversationHistory, setLastCoachMessage } = useCoachChat();
  const [initialCoachBubble, setInitialCoachBubble] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const inputRef = useRef(null);
  const [selectedGender, setSelectedGender] = useState(profile?.gender === 'female' ? 'female' : 'male');
  const [selectedTone, setSelectedTone] = useState(PERSONA_TO_TONE[personaId] || 'calm');
  const userName = profile?.display_name || 'Champion';

  const settingsSummary = useMemo(() => {
    const genderLabel = selectedGender === 'female' ? 'Female' : 'Male';
    const toneLabel = selectedTone[0].toUpperCase() + selectedTone.slice(1);
    return `${genderLabel} · ${toneLabel}`;
  }, [selectedGender, selectedTone]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelectedGender(profile?.gender === 'female' ? 'female' : 'male');
      setSelectedTone(PERSONA_TO_TONE[personaId] || 'calm');
    }, 0);

    return () => window.clearTimeout(timer);
  }, [personaId, profile?.gender]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (location.state?.prefill) setInput(location.state.prefill);
      if (location.state?.focusInput) inputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [location.state]);

  useEffect(() => {
    if (conversationHistory.length > 0) return;
    if (lastCoachMessage) {
      setInitialCoachBubble(stripMarkdown(lastCoachMessage));
      return;
    }

    const generate = async () => {
      const hour = new Date().getHours();
      const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
      const name = profile?.display_name || 'Athlete';
      const goal = profile?.goal || 'training';

      try {
        const greeting = await chatWithCoach(
          personaId,
          name,
          `Give ${name} a personal ${timeOfDay} check-in. One or two sentences max. Reference their goal (${goal}). Ask what they need or tell them what to focus on. Direct and real, no hype.`,
          [],
          profile || {},
          'chat',
        );
        const clean = stripMarkdown(greeting);
        setInitialCoachBubble(clean);
        setLastCoachMessage(clean);
      } catch {
        setInitialCoachBubble(`${name}, what are we working on today?`);
      }
    };

    void generate();
  }, [profile?.display_name, profile?.goal, personaId]);

  const saveCoachSettings = async (nextGender, nextTone) => {
    setSelectedGender(nextGender);
    setSelectedTone(nextTone);

    const nextPersona = TONE_TO_PERSONA[nextTone] || 'elias';
    await setPersona(nextPersona);

    if (supabase && user?.id) {
      const { error } = await supabase
        .from('profiles')
        .update({ gender: nextGender, coach_persona: nextPersona })
        .eq('id', user.id);

      if (!error) {
        setProfile(prev => ({ ...prev, gender: nextGender, coach_persona: nextPersona }));
      }
    }
  };

  const speakCoach = text => {
    isSpeakingRef.current = true;
    speak(stripMarkdown(text), () => {
      isSpeakingRef.current = false;
    });
  };

  const handleSend = async (textOverride = input, modeOverride = 'chat') => {
    const text = String(textOverride || '').trim();
    if (!text || loading) return;

    // Check token limit before calling AI
    const tokenResult = await checkAndConsume();
    if (!tokenResult.allowed) {
      setTokenError(tokenResult.message);
      return;
    }
    setTokenError('');

    console.log('Sending to coach:', text);

    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    const updated = [...conversationHistory, userMsg];
    setConversationHistory(updated);
    setInput('');
    setLoading(true);

    try {
      const reply = await chatWithCoach(
        personaId,
        profile?.display_name || 'Athlete',
        text,
        updated,
        profile || {},
        modeOverride,
      );
      const clean = stripMarkdown(reply);
      const assistantMsg = { role: 'assistant', content: clean, timestamp: Date.now() };
      setConversationHistory([...updated, assistantMsg]);
      setLastCoachMessage(clean);
      if (modeOverride === 'voice') speakCoach(clean);
    } catch (error) {
      console.error('Coach failed:', error);
      setConversationHistory([
        ...updated,
        {
          role: 'assistant',
          content: 'Connection dropped. What do you need?',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleMic = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setInput('What should I focus on today?');
      setVoiceStatus('');
      setVoiceError('Voice input is not supported in this browser. Please type your message.');
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    setVoiceError('');
    setVoiceStatus('Listening... speak now');

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = event => {
        if (isSpeakingRef.current || isSpeaking()) return;
        const text = event.results?.[0]?.[0]?.transcript || '';
        setInput(text);
        setListening(false);
        setVoiceStatus(text ? `Heard: "${text}"` : '');
        if (text.trim()) void handleSend(text, 'voice');
      };

      recognition.onerror = () => {
        setListening(false);
        setVoiceStatus('');
        setInput('What should I focus on today?');
      };

      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch (error) {
      console.error('Coach microphone error:', error);
      setInput('What should I focus on today?');
      setVoiceStatus('');
      setListening(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      {voiceMode && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95">
          <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full border-2 border-[#CCFF00] bg-black text-5xl">
            {coach.avatar}
          </div>
          <h2 className="mb-2 text-xl font-black">{coach.name}</h2>
          <p className="mb-8 text-sm text-white/50">{listening ? 'Listening...' : 'Tap to speak'}</p>

          <button
            type="button"
            onClick={
              listening
                ? () => {
                    recognitionRef.current?.stop();
                    setListening(false);
                  }
                : handleMic
            }
            className={`mb-8 flex h-20 w-20 items-center justify-center rounded-full text-3xl transition-all ${
              listening ? 'animate-pulse bg-red-500' : 'bg-[#CCFF00]'
            }`}
          >
            {listening ? '⏹' : '🎤'}
          </button>

          {loading && (
            <p className="mb-4 animate-pulse text-sm text-[#CCFF00]">Coach is thinking...</p>
          )}

          {conversationHistory.length > 0 && (
            <div className="mx-6 max-h-40 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm leading-6 text-white">
                {stripMarkdown(conversationHistory[conversationHistory.length - 1]?.content || '')}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setVoiceMode(false)}
            className="mt-8 rounded-full border border-white/20 px-6 py-3 text-sm text-white/60"
          >
            Close
          </button>
        </div>
      )}

      <header className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#CCFF00] bg-black text-3xl">
            {coach.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">ENDO-COACH AI</p>
            <h1 className="mt-1 text-2xl font-black tracking-[-0.04em]">{coach.name}</h1>
            <p className="mt-1 text-sm text-white/45">
              {coach.title} · {settingsSummary}
            </p>
          </div>
          <button
            type="button"
            onClick={() => speakCoach(message || `${userName}, let's make today count.`)}
            className="rounded-2xl bg-[#CCFF00] p-3 text-black"
            aria-label="Play coach message"
          >
            <Volume2 size={18} />
          </button>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/35">Voice Gender</p>
          <div className="grid grid-cols-2 gap-2">
            {['male', 'female'].map(option => (
              <button
                key={option}
                onClick={() => void saveCoachSettings(option, selectedTone)}
                className={`rounded-2xl p-3 text-sm font-black ${
                  selectedGender === option ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/60'
                }`}
              >
                {option === 'male' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/35">Tone</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['motivational', 'Motivational'],
              ['calm', 'Calm'],
              ['strict', 'Strict'],
            ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => void saveCoachSettings(selectedGender, id)}
              className={`rounded-2xl p-3 text-center text-xs font-black ${
                selectedTone === id ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/60'
              }`}
            >
              {label}
            </button>
          ))}
          </div>
        </div>
      </header>

      <button
        type="button"
        onClick={() => setVoiceMode(true)}
        className="mb-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#CCFF00] py-4 text-lg font-bold text-black"
      >
        🎤 Start Voice Session
      </button>

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-4">
        <div className="mb-4 flex items-center gap-2">
          <Bot size={18} className="text-[#CCFF00]" />
          <p className="text-sm font-black">Live Chat</p>
        </div>

        <div className="mb-4 max-h-[44vh] space-y-3 overflow-y-auto">
          {conversationHistory.length === 0 && (
            <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-[#CCFF00]/20 bg-[#0f0f11] p-4 text-sm text-white shadow-[0_0_24px_rgba(204,255,0,0.06)]">
              {!initialCoachBubble ? (
                'Loading your coach message...'
              ) : (
                <p className="whitespace-pre-line leading-6">{initialCoachBubble}</p>
              )}
            </div>
          )}

          {conversationHistory.map((item, index) => (
            <div key={`${item.role}-${index}`}>
              <div className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[90%] rounded-2xl p-4 text-sm ${
                    item.role === 'user'
                      ? 'rounded-br-sm bg-[#CCFF00] font-bold text-black'
                      : 'rounded-bl-sm border border-[#CCFF00]/25 bg-[#0f0f11] text-white shadow-[0_0_24px_rgba(204,255,0,0.06)]'
                  }`}
                >
                  <p style={{ whiteSpace: 'pre-line' }} className="leading-6">
                    {stripMarkdown(item.content)}
                  </p>
                </div>
              </div>
              {item.role === 'assistant' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {QUICK_REPLIES.map(reply => (
                    <button
                      key={reply}
                      type="button"
                      onClick={() => void handleSend(reply)}
                      disabled={loading}
                      className="rounded-full bg-white/[0.06] px-3 py-2 text-[11px] font-black text-white/60 disabled:opacity-50"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && <div className="w-fit rounded-2xl bg-[#1a1a1a] px-4 py-3 text-white/60">Typing...</div>}
        </div>

        <div className="mb-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.label}
              type="button"
              onClick={() => void handleSend(action.message)}
              disabled={loading}
              className="shrink-0 rounded-full border border-[#CCFF00]/45 bg-[#0A0A0A] px-4 py-2 text-xs font-black text-[#CCFF00] disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && input.trim()) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask your coach..."
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#101012] px-4 py-3 text-sm text-white outline-none"
          />
          <button
            type="button"
            onClick={handleMic}
            disabled={loading}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition-all disabled:opacity-50 ${
              listening ? 'animate-pulse bg-red-500 text-white' : 'bg-[#2a2a2a] text-gray-400'
            }`}
            aria-label="Speak to coach"
          >
            🎤
          </button>
          <button type="button" onClick={() => void handleSend()} disabled={loading || !input.trim()} className="rounded-2xl bg-[#CCFF00] p-3 text-black disabled:opacity-50">
            <Send size={18} />
          </button>
        </div>
        {(voiceStatus || voiceError || tokenError) && (
          <div className={`mt-3 rounded-2xl p-3 text-xs leading-5 ${voiceError || tokenError ? 'bg-red-500/10 text-red-200' : 'bg-[#CCFF00]/10 text-[#CCFF00]'}`}>
            {tokenError || voiceError || voiceStatus}
          </div>
        )}
      </section>
    </main>
  );
}

