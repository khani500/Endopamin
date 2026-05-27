const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim();
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
const CONNECT_TIMEOUT_MS = 8000;

export class GeminiLiveSession {
  constructor({ coachId = 'aria', systemPrompt = '', onAudio, onText, onError, onStatusChange } = {}) {
    this.coachId = coachId;
    this.systemPrompt = systemPrompt;
    this.onAudio = onAudio;
    this.onText = onText;
    this.onError = onError;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.micCtx = null;
    this.playCtx = null;
    this.mediaStream = null;
    this.scriptProcessor = null;
    this.isRecording = false;
    this.isPlaying = false;
    this.playbackQueue = [];
    this._dead = false;
  }

  connect() {
    if (!GEMINI_API_KEY) {
      const err = new Error('VITE_GEMINI_API_KEY is missing');
      this.onError?.(err);
      return Promise.reject(err);
    }

    this.onStatusChange?.('connecting');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.close();
        const err = new Error('Gemini Live connection timeout');
        this.onError?.(err);
        reject(err);
      }, CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({
          setup: {
            model: 'models/gemini-2.0-flash-live-001',
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: { voice_name: this._getVoiceName() },
                },
              },
            },
            system_instruction: this.systemPrompt
              ? { parts: [{ text: this.systemPrompt }] }
              : undefined,
          },
        }));
      };

      this.ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.setupComplete) {
            clearTimeout(timeout);
            this.onStatusChange?.('ready');
            resolve();
          }

          if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/')) {
                this.onStatusChange?.('speaking');
                this.onAudio?.(part.inlineData.data);
                void this._enqueueAudio(part.inlineData.data);
              }
              if (part.text) this.onText?.(part.text);
            }
          }

          if (msg.serverContent?.turnComplete) {
            this.onStatusChange?.('listening');
          }
        } catch (err) {
          this.onError?.(err);
        }
      };

      this.ws.onerror = err => {
        clearTimeout(timeout);
        this.onError?.(err);
        reject(err);
      };

      this.ws.onclose = () => {
        if (!this._dead) this.onStatusChange?.('closed');
        this.stopMic();
      };
    });
  }

  async startMic() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('AudioContext not supported');

    this.micCtx = new AudioCtx({ sampleRate: 16000 });
    if (this.micCtx.state === 'suspended') await this.micCtx.resume();

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    const source = this.micCtx.createMediaStreamSource(this.mediaStream);
    this.scriptProcessor = this.micCtx.createScriptProcessor(4096, 1, 1);

    this.scriptProcessor.onaudioprocess = e => {
      if (!this.isRecording || this.isPlaying || this.ws?.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
      }
      const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
      this.ws.send(JSON.stringify({
        realtime_input: {
          media_chunks: [{ mime_type: 'audio/pcm;rate=16000', data: base64 }],
        },
      }));
    };

    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.micCtx.destination);
    this.isRecording = true;
    this.onStatusChange?.('listening');
  }

  stopMic() {
    this.isRecording = false;
    try { this.scriptProcessor?.disconnect(); } catch {}
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.scriptProcessor = null;
    this.mediaStream = null;
    if (this.micCtx?.state !== 'closed') {
      void this.micCtx?.close?.();
    }
    this.micCtx = null;
  }

  // ── Audio playback (reuse single AudioContext) ─────────────────────────────

  async _getPlayCtx() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.playCtx || this.playCtx.state === 'closed') {
      this.playCtx = new AudioCtx({ sampleRate: 24000 });
    }
    if (this.playCtx.state === 'suspended') await this.playCtx.resume();
    return this.playCtx;
  }

  async _enqueueAudio(base64) {
    this.playbackQueue.push(base64);
    if (!this.isPlaying) await this._drainQueue();
  }

  async _drainQueue() {
    if (this.isPlaying || !this.playbackQueue.length) return;
    this.isPlaying = true;
    while (this.playbackQueue.length > 0) {
      await this._playPcm(this.playbackQueue.shift());
    }
    this.isPlaying = false;
  }

  async _playPcm(base64) {
    return new Promise(async resolve => {
      try {
        const ctx = await this._getPlayCtx();
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const int16 = new Int16Array(bytes.buffer);
        const buffer = ctx.createBuffer(1, int16.length, 24000);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = resolve;
        source.start();
      } catch { resolve(); }
    });
  }

  sendText(text) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      client_content: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turn_complete: true,
      },
    }));
    this.onStatusChange?.('thinking');
  }

  disconnect() {
    this._dead = true;
    this.stopMic();
    if (this.playCtx?.state !== 'closed') void this.playCtx?.close?.();
    this.playCtx = null;
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.playbackQueue = [];
    this.isPlaying = false;
    this.onStatusChange?.('closed');
  }

  _getVoiceName() {
    const voices = { aria: 'Aoede', zara: 'Aoede', nova: 'Aoede', blaze: 'Puck', kane: 'Charon', elias: 'Charon', maya: 'Kore', rex: 'Fenrir' };
    return voices[this.coachId] || 'Aoede';
  }
}
