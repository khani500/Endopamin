import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Scan, X } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import { analyzeFoodImage, blobToBase64 } from '../../../services/foodScanner';

export function FoodScanner({ onAnalyzed }) {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [coachTip, setCoachTip] = useState('');
  const abortRef = useRef(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setError('Camera access denied or unavailable. Use Gallery instead.');
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
    try {
      if (signal.aborted) return;
      const base64 = await blobToBase64(blob);
      const analyzed = await analyzeFoodImage(base64);
      if (!analyzed) throw new Error('Could not analyze food image.');
      setResult(analyzed);
      setCoachTip(analyzed.protein_g >= 30 ? 'Good protein choice!' : 'Add a lean protein to balance this meal.');
    } catch (e) {
      if (e.name !== 'AbortError') setError(String(e.message || e));
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

    if (supabase && user?.id) {
      await supabase.from('nutrition_logs').insert({
        user_id: user.id,
        meal_name: result.food_name,
        calories: Number(result.calories) || 0,
        protein_g: Number(result.protein_g) || 0,
        carbs_g: Number(result.carbs_g) || 0,
        fat_g: Number(result.fat_g) || 0,
        meal_type: 'snack',
      });
    }
  };

  const resetScan = () => {
    setResult(null);
    setCoachTip('');
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
        <video ref={videoRef} style={{ display: cameraOn ? 'block' : 'none' }} playsInline muted />
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
          <p className="mt-2 text-xs font-bold text-[#CCFF00]">Coach: {coachTip}</p>
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
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
        </label>
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
