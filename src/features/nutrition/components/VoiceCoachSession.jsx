import { useCallback, useRef, useState } from 'react';
import { Headphones, Mic, Square } from 'lucide-react';
import { sendVoiceCoachTurn, sendVoiceCoachTurnDemo } from '../api/nutritionApi';
import { useNutritionStore } from '../store/nutritionStore';
import { AudioWaveform } from './AudioWaveform';
import { GlassCard } from './GlassCard';

export function VoiceCoachSession() {
  const coachGender = useNutritionStore(s => s.coachGender);
  const coachTone = useNutritionStore(s => s.coachTone);
  const goal = useNutritionStore(s => s.goal);

  const [listening, setListening] = useState(false);
  const [coachSpeaking, setCoachSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const runCoachTurn = useCallback(
    async text => {
      setError(null);
      setCoachSpeaking(true);
      try {
        let res;
        try {
          res = await sendVoiceCoachTurn({ transcript: text, coachGender, coachTone, goal }, undefined);
        } catch {
          res = await sendVoiceCoachTurnDemo({ transcript: text, coachGender, coachTone, goal });
        }
        setReply(res.replyText ?? '');
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setCoachSpeaking(false);
      }
    },
    [coachGender, coachTone, goal],
  );

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setListening(false);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setReply('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const placeholder = '[Audio — wire STT then sendVoiceCoachTurn]';
        setTranscript(placeholder);
        void runCoachTurn(placeholder);
      };
      mr.start();
      setListening(true);
    } catch {
      setError('Microphone unavailable. You can still send a demo text line.');
    }
  }, [runCoachTurn]);

  const sendTextDemo = () => {
    const text = 'What should I eat for lunch today?';
    setTranscript(text);
    void runCoachTurn(text);
  };

  return (
    <GlassCard>
      <div className="np-row-between" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Headphones size={20} color="#fb923c" />
          <h3 style={{ margin: 0 }}>Voice session</h3>
        </div>
        <span className="np-muted">{coachGender} · {coachTone}</span>
      </div>

      <AudioWaveform active={coachSpeaking} />

      <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
        {!listening ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={coachSpeaking}
            className="np-voice-mic"
            aria-label="Start speaking"
          >
            <Mic size={26} />
          </button>
        ) : (
          <button type="button" onClick={stopRecording} className="np-voice-mic np-voice-mic--stop" aria-label="Stop">
            <Square size={22} fill="currentColor" />
          </button>
        )}
      </div>

      <button type="button" className="np-btn-secondary" style={{ width: '100%', marginBottom: 12 }} onClick={sendTextDemo} disabled={coachSpeaking}>
        Send demo line (no mic)
      </button>

      {transcript && (
        <div className="np-list-item" style={{ marginBottom: 8 }}>
          <div>
            <p className="np-muted" style={{ margin: '0 0 4px', textTransform: 'uppercase' }}>You</p>
            <p style={{ margin: 0, fontSize: 12 }}>{transcript}</p>
          </div>
        </div>
      )}
      {reply && (
        <div className="np-list-item" style={{ borderColor: 'rgba(57,255,20,0.35)', background: 'rgba(57,255,20,0.08)' }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, color: '#39ff14', textTransform: 'uppercase' }}>Coach</p>
            <p style={{ margin: 0, fontSize: 12 }}>{reply}</p>
          </div>
        </div>
      )}
      {error && <p className="np-error">{error}</p>}
      <p className="np-hint" style={{ marginTop: 12 }}>Pipeline: mic → STT → sendVoiceCoachTurn → TTS stream</p>
    </GlassCard>
  );
}
