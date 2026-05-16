import { useMemo, useState } from 'react';
import { Bot, Mic, Send, Volume2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCoach } from '../hooks/useCoach';

const QUICK_PROMPTS = [
  'What should I focus on today?',
  'Build me a quick workout.',
  'How should I recover tonight?',
  'Give me a nutrition tip.',
];

export default function CoachPage() {
  const { profile } = useAuth();
  const { coach, coaches, personaId, setPersona, message, loadingMessage, speak, chat } = useCoach();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const userName = profile?.display_name || 'Champion';

  const coachOptions = useMemo(() => Object.values(coaches), [coaches]);

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
              {coach.title} · Voice matched to your persona
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

        <div className="mt-4 grid grid-cols-3 gap-2">
          {coachOptions.map(option => (
            <button
              key={option.id}
              onClick={() => void setPersona(option.id)}
              className={`rounded-2xl p-3 text-center text-xs font-black ${
                personaId === option.id ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/60'
              }`}
            >
              <div className="mb-1 text-xl">{option.avatar}</div>
              {option.name.replace('Coach ', '')}
            </button>
          ))}
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
          {QUICK_PROMPTS.map(prompt => (
            <button
              key={prompt}
              onClick={() => void sendCoachMessage(prompt)}
              className="rounded-xl bg-white/[0.05] px-3 py-2 text-left text-xs font-bold text-white/70"
            >
              {prompt}
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

