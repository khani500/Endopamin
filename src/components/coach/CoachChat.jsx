import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCoach } from '../../hooks/useCoach';

export const CoachChat = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  const { coach, chat } = useCoach();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const userName = profile?.display_name || 'Champion';

  const sendMessage = async (textOverride = input) => {
    const text = String(textOverride || '').trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const priorMessages = messages;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await chat(text, priorMessages);
      const coachMsg = { role: 'coach', content: response };
      setMessages(prev => [...prev, coachMsg]);
    } catch (err) {
      console.error('CoachChat AI error:', err);
      setMessages(prev => [
        ...prev,
        {
          role: 'coach',
          content: "I'm having trouble connecting right now. Try again in a moment.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/80">
      <div className="flex h-[85vh] w-full flex-col rounded-t-3xl bg-[#111]">
        <div className="flex items-center gap-3 border-b border-[#2a2a2a] p-4">
          <span className="text-2xl">{coach.avatar}</span>
          <div>
            <p className="m-0 font-bold text-white">{coach.name}</p>
            <p className="m-0 text-xs text-[#CCFF00]">● Online</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto border-0 bg-transparent text-xl text-gray-400">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-[#1a1a1a] p-3">
              <p className="m-0 text-sm text-white">
                Hey {userName.split(/\s+/)[0] || userName}! What&apos;s on your mind? Ask me anything about training, nutrition, or recovery.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={`${msg.role}-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl p-3 ${
                  msg.role === 'user'
                    ? 'rounded-br-sm bg-[#CCFF00] text-black'
                    : 'rounded-bl-sm bg-[#1a1a1a] text-white'
                }`}
              >
                <p className="m-0 text-sm">{msg.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="max-w-[60px] rounded-2xl rounded-tl-sm bg-[#1a1a1a] p-3">
              <p className="m-0 animate-pulse text-sm text-white">···</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-[#2a2a2a] p-4">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && input.trim()) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Ask your coach..."
            className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-sm text-white outline-none"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-[#CCFF00] px-4 py-3 text-sm font-bold text-black disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

