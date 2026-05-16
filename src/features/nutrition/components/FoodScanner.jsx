import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Scan, X } from 'lucide-react';
import { analyzeFoodImage, analyzeFoodImageDemo } from '../api/nutritionApi';
import { GlassCard } from './GlassCard';

export function FoodScanner({ onAnalyzed }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
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
      let result;
      try {
        result = await analyzeFoodImage(blob, signal);
      } catch {
        result = await analyzeFoodImageDemo(blob, signal);
      }
      onAnalyzed?.(result);
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

      <div className="np-camera-box">
        {previewUrl && !cameraOn && <img src={previewUrl} alt="Preview" />}
        <video ref={videoRef} style={{ display: cameraOn ? 'block' : 'none' }} playsInline muted />
        {!cameraOn && !previewUrl && (
          <div className="np-camera-empty">
            <Camera size={40} color="#39ff14" style={{ opacity: 0.5 }} />
            <p>Open the camera or pick an image from your gallery.</p>
          </div>
        )}
        {busy && (
          <div className="np-camera-overlay">
            <Loader2 size={32} color="#39ff14" className="spin" style={{ animation: 'spin 1s linear infinite' }} />
            <span>Estimating portion & macros…</span>
          </div>
        )}
      </div>

      {error && <p className="np-error">{error}</p>}

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

      <p className="np-hint" style={{ marginTop: 12 }}>
        Wire <strong style={{ color: '#39ff14' }}>analyzeFoodImage</strong> in nutritionApi.js. Demo mode runs if the API fails.
      </p>
    </GlassCard>
  );
}
