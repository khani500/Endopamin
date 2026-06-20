import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { ProPaywall } from '../../../components/paywall/ProPaywall';
import { useScanLimit } from '../../../hooks/useScanLimit';
import {
  lookupBarcodeProduct,
  normalizeBarcode,
  scaleFoodItem,
  toScanResult,
} from '../../../services/barcodeScanner';

export function BarcodeScanner({ onResult, onClose }) {
  const { canScan, incrementScan } = useScanLimit();
  const [showPaywall, setShowPaywall] = useState(false);
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const lookupLockRef = useRef(false);

  const [status, setStatus] = useState('starting');
  const [error, setError] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [grams, setGrams] = useState('100');

  const lookupBarcode = useCallback(async (code) => {
    const normalized = normalizeBarcode(code);
    if (!normalized || lookupLockRef.current) return;

    if (!canScan) {
      setShowPaywall(true);
      return;
    }

    incrementScan();
    lookupLockRef.current = true;
    setLoading(true);
    setError('');

    try {
      readerRef.current?.reset();
      const result = await lookupBarcodeProduct(normalized);
      setLookupResult(result);
      setGrams(String(result.items?.[0]?.weight || 100));
      setStatus('found');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Product not found for barcode: ${normalized}. Try another product.`,
      );
      setStatus('manual');
      lookupLockRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [canScan, incrementScan]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    reader
      .decodeFromVideoDevice(null, videoRef.current, async (result, err) => {
        if (result) {
          await lookupBarcode(result.getText());
        }
        if (err && !(err instanceof NotFoundException)) {
          // ignore not-found errors during scanning
        }
      })
      .catch(() => {
        setStatus('manual');
        setError('Camera access denied. Enter barcode manually.');
      });

    setStatus('scanning');

    return () => {
      reader.reset();
    };
  }, [lookupBarcode]);

  const handleManualSubmit = async () => {
    const code = manualBarcode.trim();
    if (!code) return;
    lookupLockRef.current = false;
    await lookupBarcode(code);
  };

  const handleLog = () => {
    if (!lookupResult?.items?.[0]) return;
    const g = Number(grams) || lookupResult.items[0].weight || 100;
    const scaled = scaleFoodItem(lookupResult.items[0], g);
    const payload = toScanResult([scaled], lookupResult.confidence, {
      barcode: lookupResult.barcode,
      source: lookupResult.source,
      imageUrl: lookupResult.imageUrl,
    });
    onResult?.(payload);
    onClose?.();
  };

  const accent = '#CCFF00';
  const previewItem = lookupResult?.items?.[0];
  const per100 = lookupResult?.per100;
  const gramCount = Number(grams) || previewItem?.weight || 100;
  const scaledPreview = previewItem ? scaleFoodItem(previewItem, gramCount) : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: '#0A0A0A', display: 'flex', flexDirection: 'column',
      color: '#fff', fontFamily: 'sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #222' }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent }}>Barcode Scanner</p>
          <h2 style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 900 }}>Scan a product</h2>
        </div>
        <button type="button" onClick={onClose} style={{ background: '#222', border: 'none', color: '#fff', borderRadius: 12, padding: '8px 14px', cursor: 'pointer', fontWeight: 700 }}>
          Close
        </button>
      </div>

      <div style={{ position: 'relative', background: '#111', overflow: 'hidden', height: 260, flexShrink: 0 }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline autoPlay />

        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: 220, height: 100, border: `2px solid ${accent}`, borderRadius: 12, boxShadow: '0 0 0 1000px rgba(0,0,0,0.45)' }} />
        </div>

        {status === 'scanning' && !loading && (
          <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center' }}>
            <span style={{ background: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: '6px 14px', fontSize: 12, color: accent, fontWeight: 700 }}>
              Point at barcode
            </span>
          </div>
        )}

        {loading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
            <div style={{ width: 36, height: 36, border: `3px solid ${accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13, color: accent, fontWeight: 700 }}>Looking up product...</span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {error && (
          <div style={{ background: '#FF3B3020', border: '1px solid #FF3B3060', borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#FF6B6B' }}>{error}</p>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#ffffff60', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Or enter barcode manually
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              value={manualBarcode}
              onChange={e => setManualBarcode(e.target.value)}
              placeholder="e.g. 3017620422003"
              style={{ flex: 1, background: '#141416', border: '1px solid #333', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
              onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
            />
            <button
              type="button"
              onClick={handleManualSubmit}
              style={{ background: accent, border: 'none', borderRadius: 12, padding: '10px 16px', fontWeight: 900, color: '#000', cursor: 'pointer', fontSize: 13 }}
            >
              Search
            </button>
          </div>
        </div>

        {previewItem && !loading && (
          <div style={{ background: '#141416', border: `1px solid ${accent}40`, borderRadius: 18, padding: 16 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {lookupResult?.imageUrl && (
                <img src={lookupResult.imageUrl} alt={previewItem.name} style={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 10, background: '#fff' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 15, lineHeight: 1.3 }}>{previewItem.name}</p>
                {lookupResult?.source && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ffffff50' }}>
                    Source: {lookupResult.source === 'openfoodfacts' ? 'Open Food Facts' : 'AI estimate'}
                  </p>
                )}
              </div>
            </div>

            {per100 && (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#ffffff50', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Per 100g
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
                  {[
                    { label: 'Calories', value: per100.calories, unit: 'kcal', color: accent },
                    { label: 'Protein', value: per100.protein, unit: 'g', color: '#4FC3F7' },
                    { label: 'Carbs', value: per100.carbs, unit: 'g', color: '#FFB74D' },
                    { label: 'Fat', value: per100.fat, unit: 'g', color: '#EF9A9A' },
                  ].map(m => (
                    <div key={m.label} style={{ background: '#0A0A0A', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: m.color }}>{m.value}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 9, fontWeight: 700, color: '#ffffff50', textTransform: 'uppercase' }}>{m.unit}</p>
                      <p style={{ margin: '1px 0 0', fontSize: 9, color: '#ffffff40' }}>{m.label}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#ffffff50', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              How many grams?
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                type="number"
                value={grams}
                onChange={e => setGrams(e.target.value)}
                min="1"
                style={{ width: 80, background: '#0A0A0A', border: `1px solid ${accent}60`, borderRadius: 10, padding: '8px 12px', color: '#fff', fontSize: 15, fontWeight: 700, outline: 'none', textAlign: 'center' }}
              />
              <div style={{ flex: 1, background: '#0A0A0A', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#ffffff80' }}>
                = <strong style={{ color: '#fff' }}>{scaledPreview?.calories ?? 0}</strong> kcal ·{' '}
                P<strong style={{ color: '#4FC3F7' }}>{scaledPreview?.protein ?? 0}g</strong> ·{' '}
                C<strong style={{ color: '#FFB74D' }}>{scaledPreview?.carbs ?? 0}g</strong> ·{' '}
                F<strong style={{ color: '#EF9A9A' }}>{scaledPreview?.fat ?? 0}g</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLog}
              style={{ width: '100%', background: accent, border: 'none', borderRadius: 14, padding: '14px', fontWeight: 900, color: '#000', cursor: 'pointer', fontSize: 15 }}
            >
              Add to Scan Results
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <ProPaywall
        featureName="Barcode Scanner"
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
      />
    </div>
  );
}
