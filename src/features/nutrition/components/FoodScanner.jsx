import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Scan, X } from 'lucide-react';
import { GlassCard } from './GlassCard';
import {
  SCAN_PROGRESS,
  SCAN_PROGRESS_LABELS,
  getScanErrorMessage,
  imageToGeminiPayload,
  scaleFoodByPortion,
  scanFood,
} from '../../../lib/foodScanner';

export function FoodScanner({ onConfirm }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanPhase, setScanPhase] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pendingResult, setPendingResult] = useState(null);
  const [portionGrams, setPortionGrams] = useState(100);
  const abortRef = useRef(null);

  const scaledResult = useMemo(() => {
    if (!pendingResult) return null;
    return scaleFoodByPortion(pendingResult, portionGrams);
  }, [pendingResult, portionGrams]);

  const progressLabel = scanPhase ? SCAN_PROGRESS_LABELS[scanPhase] : null;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setPendingResult(null);

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
    setPendingResult(null);
    setScanPhase(SCAN_PROGRESS.IDENTIFYING);

    try {
      if (signal.aborted) return;
      await imageToGeminiPayload(blob);

      const analyzed = await scanFood(blob, {
        onProgress: phase => {
          if (!signal.aborted) setScanPhase(phase);
        },
      });

      if (!analyzed) throw new Error('No food detected');

      const baseGrams = analyzed.base_portion_grams || analyzed.portion_grams || 100;
      setPortionGrams(Math.round(baseGrams));
      setPendingResult(analyzed);
      setScanPhase(SCAN_PROGRESS.DONE);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Food scan failed:', e);
        setError(getScanErrorMessage(e));
      }
    } finally {
      setBusy(false);
      setTimeout(() => setScanPhase(null), 1200);
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

  const handleConfirm = () => {
    if (!scaledResult || !onConfirm) return;
    onConfirm(scaledResult);
    resetScan();
  };

  const resetScan = () => {
    setPendingResult(null);
    setPortionGrams(100);
    setScanPhase(null);
    setError(null);
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const portionPresets = useMemo(() => {
    const base = pendingResult?.base_portion_grams || 100;
    return [
      { label: '½×', grams: Math.max(10, Math.round(base * 0.5)) },
      { label: '1×', grams: Math.round(base) },
      { label: '1.5×', grams: Math.round(base * 1.5) },
      { label: '2×', grams: Math.round(base * 2) },
    ];
  }, [pendingResult]);

  return (
    <GlassCard>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Scan size={20} color="#CCFF00" />
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
          <div className="np-camera-overlay np-scan-overlay">
            <div className="np-scan-radar" aria-hidden="true" />
            <Loader2
              size={32}
              color="#CCFF00"
              style={{ animation: 'spin 1s linear infinite', position: 'relative', zIndex: 1 }}
            />
            <span className="np-scan-progress-label">{progressLabel || 'Scanning…'}</span>
          </div>
        )}
      </div>

      {error && <p className="np-error">{error}</p>}

      {scaledResult && !busy && (
        <div className="mt-4 rounded-2xl border border-[#CCFF00]/35 bg-[#0A0A0A] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#CCFF00]">Confirm meal</p>
          <p className="mt-2 text-sm font-black text-white">{scaledResult.food_name}</p>
          <p className="mt-1 text-xs text-white/45">{scaledResult.serving_size}</p>

          {scaledResult.warning && (
            <p className="mt-2 rounded-lg border border-[#FF9500]/30 bg-[#FF9500]/10 px-3 py-2 text-xs font-bold text-[#FF9500]">
              {scaledResult.warning}
            </p>
          )}

          {Array.isArray(scaledResult.foods) && scaledResult.foods.length > 1 && (
            <ul className="mt-2 space-y-1 text-xs text-white/50">
              {scaledResult.foods.map((item, i) => (
                <li key={`${item.name}-${i}`}>
                  {item.name} · {item.portion}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <MacroChip label="Calories" value={`${scaledResult.calories} kcal`} />
            <MacroChip label="Protein" value={`${scaledResult.protein_g}g`} />
            <MacroChip label="Carbs" value={`${scaledResult.carbs_g}g`} />
            <MacroChip label="Fat" value={`${scaledResult.fat_g}g`} />
          </div>

          <div className="mt-4">
            <label className="text-[10px] font-black uppercase tracking-wider text-white/45">
              Portion size (grams)
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="range"
                min={10}
                max={800}
                step={5}
                value={portionGrams}
                onChange={e => setPortionGrams(Number(e.target.value))}
                className="flex-1 accent-[#CCFF00]"
              />
              <input
                type="number"
                min={10}
                max={2000}
                value={portionGrams}
                onChange={e => setPortionGrams(Math.max(10, Number(e.target.value) || 10))}
                className="w-16 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-center text-xs font-bold text-white"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {portionPresets.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPortionGrams(p.grams)}
                  className="rounded-full border px-3 py-1 text-[10px] font-black"
                  style={{
                    borderColor: portionGrams === p.grams ? '#CCFF00' : 'rgba(255,255,255,0.12)',
                    color: portionGrams === p.grams ? '#CCFF00' : 'rgba(255,255,255,0.45)',
                    background: portionGrams === p.grams ? 'rgba(204,255,0,0.12)' : 'transparent',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-xl bg-[#CCFF00] py-3 text-xs font-black text-black"
            >
              Add to today
            </button>
            <button
              type="button"
              onClick={resetScan}
              className="rounded-xl border border-white/10 bg-white/[0.06] py-3 text-xs font-black text-white/60"
            >
              Re-scan
            </button>
          </div>
        </div>
      )}

      <div className="np-btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="np-btn-primary"
          onClick={cameraOn ? onShutter : startCamera}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Camera size={18} />}
          {cameraOn ? 'Analyze' : 'Open camera'}
        </button>
        <label
          className="np-btn-outline"
          style={{
            opacity: busy ? 0.45 : 1,
            pointerEvents: busy ? 'none' : 'auto',
          }}
        >
          <ImagePlus size={18} />
          Gallery
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
            disabled={busy}
            style={{ display: 'none' }}
          />
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

function MacroChip({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-0.5 text-sm font-black text-[#CCFF00]">{value}</p>
    </div>
  );
}
