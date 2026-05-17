import { useState } from 'react';
import { isSpeaking } from '../../services/voiceService';
import { useCoach } from '../../hooks/useCoach';
import { CoachChat } from './CoachChat';

export const CoachCard = ({ fallbackMessage = '' }) => {
  const { coach, message, loadingMessage, personaId, speak, stopSpeaking } = useCoach();
  const [playing, setPlaying] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const handleVoice = () => {
    const voiceMessage = fallbackMessage || message;
    if (!voiceMessage.trim()) return;
    if (playing || isSpeaking()) {
      stopSpeaking();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    speak(voiceMessage, () => setPlaying(false));
  };

  const borderColor = {
    elias: 'border-[#CCFF00]/30',
    maya: 'border-[#FF2D9B]/40',
    rex: 'border-[#38BDF8]/40',
  }[personaId] || 'border-[#CCFF00]/30';

  return (
    <div className={`mx-5 mb-4 rounded-2xl border ${borderColor} bg-[#1a1a1a] p-4`}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#CCFF00] text-xl">
          {coach.avatar}
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-bold text-white">{coach.name}</p>
          <p className="m-0 text-xs text-gray-500">{coach.description}</p>
        </div>
        <button
          type="button"
          onClick={handleVoice}
          disabled={loadingMessage || !(fallbackMessage || message).trim()}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:opacity-40 ${
            playing ? 'bg-[#CCFF00] text-black' : 'bg-[#2a2a2a] text-gray-400'
          }`}
          aria-label={playing ? 'Stop coach voice' : 'Play coach voice'}
        >
          {playing ? '⏹' : '▶'}
        </button>
      </div>

      {loadingMessage && !fallbackMessage ? (
        <div className="h-12 animate-pulse rounded-lg bg-[#2a2a2a]" />
      ) : (
        <p className="m-0 text-sm leading-relaxed text-white">{fallbackMessage || message}</p>
      )}

      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="mt-3 border-0 bg-transparent p-0 text-xs font-medium text-[#CCFF00]"
      >
        Reply to coach →
      </button>

      <CoachChat isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
};

