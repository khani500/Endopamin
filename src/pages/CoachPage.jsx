import { useEffect, useMemo, useState } from 'react';
import { Bot, Mic, Send, Volume2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useCoach } from '../hooks/useCoach';

const QUICK_ACTIONS = [
  { title: 'Plan workout', prompt: 'Plan my workout today based on my current goal.' },
  { title: 'Nutrition advice', prompt: 'Give me nutrition advice for today.' },
  { title: 'Recovery tips', prompt: 'Give me recovery tips for tonight.' },
  { title: 'Progress review', prompt: 'Review my progress and tell me what to improve.' },
];

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
  const { user, profile, setProfile } = useAuth();
  const { coach, personaId, setPersona, message, loadingMessage, speak, chat } = useCoach();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
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

  const sendCoachMessage = async textOverride => {
    const text = (textOverride || input).trim();
    if (!text || loading) return;

    const userMessage = { role: 'user', content: text };
    const history = messages;
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await chat(text, history);
      setMessages(prev => [...prev, { role: 'coach', content: response }]);
      speak(response);
    } catch (error) {
      console.error('Coach page chat failed:', error);
      setMessages(prev => [
        ...prev,
        { role: 'coach', content: "I'm having trouble connecting right now, but I'm still here with you." },
      ]);
    }

    setLoading(false);
  };

  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setInput(transcript);
      void sendCoachMessage(transcript);
    };
    recognition.start();
  };

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#CCFF00] bg-black text-3xl">
            {coach.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#CCFF00]">AI Voice Coach</p>
            <h1 className="mt-1 text-2xl font-black tracking-[-0.04em]">{coach.name}</h1>
            <p className="mt-1 text-sm text-white/45">
              {coach.title} · {settingsSummary}
            </p>
          </div>
          <button
            type="button"
            onClick={() => speak(message || `${userName}, let's make today count.`)}
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

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-4">
        <div className="mb-4 flex items-center gap-2">
          <Bot size={18} className="text-[#CCFF00]" />
          <p className="text-sm font-black">Live Chat</p>
        </div>

        <div className="mb-4 max-h-[44vh] space-y-3 overflow-y-auto">
          <div className="max-w-[84%] rounded-2xl rounded-tl-sm bg-[#1a1a1a] p-3 text-sm leading-6 text-white">
            {loadingMessage ? 'Loading your coach message...' : message || `${userName}, what should we attack today?`}
          </div>

          {messages.map((item, index) => (
            <div key={`${item.role}-${index}`} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[84%] rounded-2xl p-3 text-sm leading-6 ${
                  item.role === 'user'
                    ? 'rounded-br-sm bg-[#CCFF00] text-black'
                    : 'rounded-bl-sm bg-[#1a1a1a] text-white'
                }`}
              >
                {item.content}
              </div>
            </div>
          ))}

          {loading && <div className="w-fit rounded-2xl bg-[#1a1a1a] px-4 py-3 text-white/60">Typing...</div>}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.title}
              onClick={() => void sendCoachMessage(action.prompt)}
              className="rounded-xl bg-white/[0.05] px-3 py-3 text-left text-xs font-bold text-white/70"
            >
              {action.title}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && void sendCoachMessage()}
            placeholder="Ask your coach..."
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#101012] px-4 py-3 text-sm text-white outline-none"
          />
          <button type="button" onClick={startVoiceInput} className="rounded-2xl bg-white/[0.08] p-3 text-white">
            <Mic size={18} />
          </button>
          <button type="button" onClick={() => void sendCoachMessage()} className="rounded-2xl bg-[#CCFF00] p-3 text-black">
            <Send size={18} />
          </button>
        </div>
      </section>
    </main>
  );
}

