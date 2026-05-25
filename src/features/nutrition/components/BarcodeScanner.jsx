import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';

// ─── Open Food Facts API ─────────────────────────────────────────────────────
async function fetchProductByBarcode(barcode) {
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
  );
  if (!res.ok) throw new Error('Product not found');
  const data = await res.json();
  if (data.status !== 1) throw new Error('Product not found');
  return data.product;
}

function normalizeProduct(product, barcode) {
  const n = product.nutriments || {};
  const per100 = {
    calories: Number(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
    protein:  Number(n['proteins_100g']    ?? n['proteins']    ?? 0),
    carbs:    Number(n['carbohydrates_100g'] ?? n['carbohydrates'] ?? 0),
    fat:      Number(n['fat_100g']         ?? n['fat']         ?? 0),
    fiber:    Number(n['fiber_100g']       ?? n['fiber']       ?? 0),
  };
  const servingG = Number(product.serving_quantity) || 100;
  const scale = servingG / 100;

  return {
    barcode,
    name:         product.product_name || product.product_name_en || 'Unknown product',
    brand:        product.brands || '',
    imageUrl:     product.image_front_small_url || product.image_url || '',
    servingSize:  `${servingG}g`,
    servingG,
    per100,
    perServing: {
      calories: Math.round(per100.calories * scale),
      protein:  Math.round(per100.protein  * scale * 10) / 10,
      carbs:    Math.round(per100.carbs    * scale * 10) / 10,
      fat:      Math.round(per100.fat      * scale * 10) / 10,
      fiber:    Math.round(per100.fiber    * scale * 10) / 10,
    },
    nutriscore: product.nutriscore_grade || '',
    ingredients: product.ingredients_text_en || product.ingredients_text || '',
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BarcodeScanner({ onResult, onClose }) {
  const videoRef  = useRef(null);
  const readerRef = useRef(null);
  const [status, setStatus]   = useState('starting'); // starting | scanning | found | error | manual
  const [error, setError]     = useState('');
  const [product, setProduct] = useState(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [grams, setGrams]     = useState('100');

  // Start camera + ZXing
  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    reader.decodeFromVideoDevice(null, videoRef.current, async (result, err) => {
      if (result) {
        reader.reset();
        const code = result.getText();
        setStatus('found');
        await lookupBarcode(code);
      }
      if (err && !(err instanceof NotFoundException)) {
        // ignore not-found errors (normal during scanning)
      }
    }).catch(e => {
      setStatus('error');
      setError('Camera access denied. Enter barcode manually.');
    });

    setStatus('scanning');

    return () => {
      reader.reset();
    };
  }, []);

  const lookupBarcode = async (code) => {
    setLoading(true);
    setError('');
    try {
      const raw = await fetchProductByBarcode(code);
      const normalized = normalizeProduct(raw, code);
      setProduct(normalized);
      setStatus('found');
    } catch (e) {
      setError(`Product not found for barcode: ${code}. Try another product.`);
      setStatus('scanning');
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = async () => {
    const code = manualBarcode.trim();
    if (!code) return;
    setStatus('found');
    await lookupBarcode(code);
  };

  const handleLog = () => {
    if (!product) return;
    const g = Number(grams) || 100;
    const scale = g / 100;
    onResult?.({
      name:    `${product.name}${product.brand ? ` (${product.brand})` : ''}`,
      kcal:    Math.round(product.per100.calories * scale),
      protein: Math.round(product.per100.protein  * scale * 10) / 10,
      carbs:   Math.round(product.per100.carbs    * scale * 10) / 10,
      fat:     Math.round(product.per100.fat      * scale * 10) / 10,
    });
    onClose?.();
  };

  const accent = '#CCFF00';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: '#0A0A0A', display: 'flex', flexDirection: 'column',
      color: '#fff', fontFamily: 'sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #222' }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent }}>Barcode Scanner</p>
          <h2 style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 900 }}>Scan a product</h2>
        </div>
        <button onClick={onClose} style={{ background: '#222', border: 'none', color: '#fff', borderRadius: 12, padding: '8px 14px', cursor: 'pointer', fontWeight: 700 }}>
          Close
        </button>
      </div>

      {/* Camera */}
      <div style={{ position: 'relative', background: '#111', overflow: 'hidden', height: 260, flexShrink: 0 }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline autoPlay />

        {/* Scan overlay */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: 220, height: 100, border: `2px solid ${accent}`, borderRadius: 12, boxShadow: `0 0 0 1000px rgba(0,0,0,0.45)` }} />
        </div>

        {status === 'scanning' && (
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

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {/* Error */}
        {error && (
          <div style={{ background: '#FF3B3020', border: '1px solid #FF3B3060', borderRadius: 14, padding: '12px 14px', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#FF6B6B' }}>{error}</p>
          </div>
        )}

        {/* Manual entry */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#ffffff60', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Or enter barcode manually
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              inputMode="numeric"
              value={manualBarcode}
              onChange={e => setManualBarcode(e.target.value)}
              placeholder="e.g. 3017620422003"
              style={{ flex: 1, background: '#141416', border: '1px solid #333', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
              onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
            />
            <button
              onClick={handleManualSubmit}
              style={{ background: accent, border: 'none', borderRadius: 12, padding: '10px 16px', fontWeight: 900, color: '#000', cursor: 'pointer', fontSize: 13 }}
            >
              Search
            </button>
          </div>
        </div>

        {/* Product result */}
        {product && !loading && (
          <div style={{ background: '#141416', border: `1px solid ${accent}40`, borderRadius: 18, padding: 16 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {product.imageUrl && (
                <img src={product.imageUrl} alt={product.name} style={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 10, background: '#fff' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 15, lineHeight: 1.3 }}>{product.name}</p>
                {product.brand && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#ffffff60' }}>{product.brand}</p>}
                {product.nutriscore && (
                  <span style={{ display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 900, background: '#333', color: accent }}>
                    Nutri-score: {product.nutriscore.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* Macros per 100g */}
            <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#ffffff50', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Per 100g
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
              {[
                { label: 'Calories', value: product.per100.calories, unit: 'kcal', color: accent },
                { label: 'Protein',  value: product.per100.protein,  unit: 'g',    color: '#4FC3F7' },
                { label: 'Carbs',    value: product.per100.carbs,    unit: 'g',    color: '#FFB74D' },
                { label: 'Fat',      value: product.per100.fat,      unit: 'g',    color: '#EF9A9A' },
              ].map(m => (
                <div key={m.label} style={{ background: '#0A0A0A', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: m.color }}>{m.value}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 9, fontWeight: 700, color: '#ffffff50', textTransform: 'uppercase' }}>{m.unit}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 9, color: '#ffffff40' }}>{m.label}</p>
                </div>
              ))}
            </div>

            {/* Grams input */}
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
                = <strong style={{ color: '#fff' }}>{Math.round(product.per100.calories * (Number(grams) || 0) / 100)}</strong> kcal ·{' '}
                P<strong style={{ color: '#4FC3F7' }}>{Math.round(product.per100.protein * (Number(grams) || 0) / 100 * 10) / 10}g</strong> ·{' '}
                C<strong style={{ color: '#FFB74D' }}>{Math.round(product.per100.carbs * (Number(grams) || 0) / 100 * 10) / 10}g</strong> ·{' '}
                F<strong style={{ color: '#EF9A9A' }}>{Math.round(product.per100.fat * (Number(grams) || 0) / 100 * 10) / 10}g</strong>
              </div>
            </div>

            <button
              onClick={handleLog}
              style={{ width: '100%', background: accent, border: 'none', borderRadius: 14, padding: '14px', fontWeight: 900, color: '#000', cursor: 'pointer', fontSize: 15 }}
            >
              Log This Product
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
