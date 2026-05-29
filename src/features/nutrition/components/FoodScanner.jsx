import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Scan, X } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import { imageToGeminiPayload, scanFood } from '../../../services/foodScanner';

export function FoodScanner({ onAnalyzed }) {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [coachTip, setCoachTip] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [debugInfo, setDebugInfo] = useState(null);
  const abortRef = useRef(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setResult(null);

    const canUseLiveCamera =
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia &&
      (window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname));

    if (!canUseLiveCamera) {
      setError('Live camera needs HTTPS on mobile. Opening your phone camera instead.');
      cameraInputRef.current?.click();
      return;
    }

    try {
      const constraintOptions = [
        { video: { facingMode: { exact: 'environment' } }, audio: false },
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: true, audio: false },
      ];

      let stream = null;
      let lastError = null;

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!stream) throw lastError || new Error('Camera unavailable.');

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
    } catch (err) {
      console.error('Camera start failed:', err);
      setError('Camera access denied or unavailable. Opening your phone camera instead.');
      cameraInputRef.current?.click();
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const captureFrameBlob = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.88));
  }, []);

  const runAnalysis = async blob => {
    if (!blob) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    setBusy(true);
    setError(null);
    setSaveStatus('');
    setDebugInfo(null);
    try {
      if (signal.aborted) return;
      const { base64, mimeType, byteSize, originalMimeType } = await imageToGeminiPayload(blob);
      setDebugInfo({
        stage: 'Prepared image for Gemini',
        originalMimeType,
        mimeType,
        byteSize,
        base64Length: base64.length,
      });
      const analyzed = await scanFood(blob, { signal });
      if (!analyzed) throw new Error('Could not analyze food image.');
      setResult(analyzed);
      setDebugInfo({
        stage: 'Gemini response parsed',
        originalMimeType,
        mimeType,
        base64Length: base64.length,
      });
      setCoachTip(analyzed.protein_g >= 30 ? 'Good protein choice!' : 'Add a lean protein to balance this meal.');
    } catch (e) {
      if (e.name !== 'AbortError') {
        let message = e instanceof Error ? e.message : String(e);
        if (/json|parse|eof|unterminated/i.test(message)) {
          message = 'Analysis incomplete. Please try again.';
        }
        setError(message);
        setDebugInfo({
          stage: 'Gemini scan failed',
          ...(e.details || {}),
          exactError: message,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const onShutter = async () => {
    const blob = await captureFrameBlob();
    await runAnalysis(blob);
  };

  const onFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    await runAnalysis(file);
  };

  const logMeal = async () => {
    if (!result) return;
    const entry = {
      name: result.food_name,
      kcal: Number(result.calories) || 0,
      protein: Number(result.protein_g) || 0,
      carbs: Number(result.carbs_g) || 0,
      fat: Number(result.fat_g) || 0,
    };
    onAnalyzed?.(entry);
    setSaveStatus('Meal added to today’s macros.');

    if (supabase && user?.id) {
      const { error: saveError } = await supabase.from('nutrition_logs').insert({
        user_id: user.id,
        meal_name: result.food_name,
        calories: Number(result.calories) || 0,
        protein_g: Number(result.protein_g) || 0,
        carbs_g: Number(result.carbs_g) || 0,
        fat_g: Number(result.fat_g) || 0,
        meal_type: 'snack',
      });
      if (saveError) {
        console.error('Failed to save nutrition log:', saveError);
        setSaveStatus('Saved locally, but Supabase rejected the log.');
      } else {
        setSaveStatus('Meal logged to Supabase and macros updated.');
      }
    } else if (!user?.id) {
      setSaveStatus('Meal added locally. Sign in to sync with Supabase.');
    }
  };

  const resetScan = () => {
    setResult(null);
    setCoachTip('');
    setSaveStatus('');
    setDebugInfo(null);
    setError(null);
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  return (
    <GlassCard>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Scan size={20} color="#39ff14" />
          <h3 style={{ margin: 0 }}>Food Scanner</h3>
        </div>
        {cameraOn && (
          <button type="button" className="np-back" onClick={stopCamera} aria-label="Close camera">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="np-camera-box np-camera-box--scan">
        {previewUrl && !cameraOn && <img src={previewUrl} alt="Preview" />}
        <video
          ref={videoRef}
          style={{ display: cameraOn ? 'block' : 'none' }}
          playsInline
          muted
          autoPlay
          onLoadedMetadata={() => videoRef.current?.play?.().catch(() => undefined)}
        />
        {!cameraOn && !previewUrl && (
          <div className="np-camera-empty">
            <Camera size={42} color="#CCFF00" style={{ opacity: 0.72 }} />
            <p>Open the camera or pick an image from your gallery.</p>
          </div>
        )}
        {busy && (
          <div className="np-camera-overlay">
            <Loader2 size={32} color="#CCFF00" className="spin" style={{ animation: 'spin 1s linear infinite' }} />
            <span>Estimating portion & macros…</span>
          </div>
        )}
      </div>

      {error && <p className="np-error">{error}</p>}
      {debugInfo && <ScannerDebugPanel info={debugInfo} />}

      {result && (
        <div className="mt-4 rounded-2xl border border-[#CCFF00]/25 bg-[#0A0A0A] p-4">
          <button type="button" onClick={() => window.history.back()} className="mb-3 text-xs font-black text-white/45">← Back</button>
          <p className="text-sm font-black text-white">✅ {result.food_name}</p>
          <p className="mt-1 text-xs text-white/45">Estimated serving: {result.serving_size}</p>
          <MacroResult label="Calories" value={`${result.calories} kcal`} pct={78} />
          <MacroResult label="Protein" value={`${result.protein_g}g`} pct={82} />
          <MacroResult label="Carbs" value={`${result.carbs_g}g`} pct={48} />
          <MacroResult label="Fat" value={`${result.fat_g}g`} pct={24} />
          <p className="mt-3 text-xs font-bold text-white/50">Confidence: {result.confidence}</p>
          {result.notes && <p className="mt-2 text-xs leading-5 text-white/40">{result.notes}</p>}
          <p className="mt-2 text-xs font-bold text-[#CCFF00]">Coach: {coachTip}</p>
          {saveStatus && <p className="mt-2 text-xs font-bold text-white/50">{saveStatus}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void logMeal()} className="rounded-xl bg-[#CCFF00] py-3 text-xs font-black text-black">
              Log This Meal
            </button>
            <button type="button" onClick={resetScan} className="rounded-xl border border-white/10 bg-white/[0.06] py-3 text-xs font-black text-white/60">
              Re-scan
            </button>
          </div>
        </div>
      )}

      <div className="np-btn-row" style={{ marginTop: 12 }}>
        <button type="button" className="np-btn-primary" onClick={cameraOn ? onShutter : startCamera} disabled={busy}>
          {busy ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Camera size={18} />}
          {cameraOn ? 'Analyze' : 'Open camera'}
        </button>
        <label className="np-btn-outline">
          <ImagePlus size={18} />
          Gallery
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
        </label>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          disabled={busy}
          style={{ display: 'none' }}
          aria-hidden="true"
        />
      </div>

    </GlassCard>
  );
}

function MacroResult({ label, value, pct }) {
  return (
    <div className="mt-3 grid grid-cols-[80px_70px_1fr] items-center gap-2 text-xs">
      <span className="font-bold text-white/55">{label}</span>
      <strong className="text-white">{value}</strong>
      <span className="h-2 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full rounded-full bg-[#CCFF00]" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function ScannerDebugPanel({ info }) {
  const rows = [
    ['Stage', info.stage],
    ['Gemini key loaded', info.keyLoaded === undefined ? 'not checked yet' : info.keyLoaded ? `yes (${info.keyLength} chars)` : 'no'],
    ['Model', info.model],
    ['Original MIME', info.originalMimeType],
    ['Sent MIME', info.mimeType],
    ['Image bytes', info.byteSize],
    ['Base64 length', info.base64Length],
    ['HTTP status', info.status ? `${info.status} ${info.statusText || ''}` : null],
    ['Exact error', info.exactError || info.errorMessage],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  return (
    <div className="mt-3 rounded-2xl border border-[#FF9500]/35 bg-[#FF9500]/10 p-3">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#FF9500]">Scanner Debug</p>
      <div className="mt-2 space-y-1">
        {rows.map(([label, value]) => (
          <p key={label} className="text-[11px] leading-5 text-white/65">
            <span className="font-black text-white/85">{label}:</span> {String(value)}
          </p>
        ))}
      </div>
      {info.rawText && (
        <p className="mt-2 max-h-24 overflow-auto rounded-xl bg-black/30 p-2 text-[10px] leading-4 text-white/45">
          Raw Gemini text: {info.rawText.slice(0, 500)}
        </p>
      )}
    </div>
  );
}
