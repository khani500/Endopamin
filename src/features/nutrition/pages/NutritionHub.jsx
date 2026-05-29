import { useState, useRef } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { askGeminiWithImage } from '../../../lib/gemini';
import { parseNutritionFromAiText, safeParseJson } from '../../../services/foodScanner';

const MACRO_GOALS = { calories: 2200, protein: 160, carbs: 220, fat: 65 };

const SUPPLEMENTS = [
  { name: 'Creatine', dose: '5g daily', benefit: 'Strength & power', color: '#CCFF00' },
  { name: 'Whey Protein', dose: '30g post-workout', benefit: 'Muscle recovery', color: '#5088FF' },
  { name: 'Vitamin D3', dose: '2000 IU daily', benefit: 'Immunity & hormones', color: '#FFA53C' },
  { name: 'Omega-3', dose: '1g daily', benefit: 'Joint & heart health', color: '#FF6B6B' },
  { name: 'Magnesium', dose: '400mg before bed', benefit: 'Sleep & recovery', color: '#A064FF' },
];

const FOOD_DB = [
  { id: 1, name: 'Chicken Breast', cal: 165, p: 31, c: 0, f: 3.6, color: '#CCFF00' },
  { id: 2, name: 'Brown Rice', cal: 216, p: 5, c: 45, f: 1.8, color: '#5088FF' },
  { id: 3, name: 'Egg Whites', cal: 52, p: 11, c: 0.7, f: 0.2, color: '#CCFF00' },
  { id: 4, name: 'Sweet Potato', cal: 103, p: 2.3, c: 24, f: 0.1, color: '#FFA53C' },
  { id: 5, name: 'Salmon', cal: 208, p: 20, c: 0, f: 13, color: '#FF6B6B' },
  { id: 6, name: 'Greek Yogurt', cal: 100, p: 17, c: 6, f: 0.7, color: '#A064FF' },
  { id: 7, name: 'Oats', cal: 389, p: 17, c: 66, f: 7, color: '#FFA53C' },
  { id: 8, name: 'Whey Protein', cal: 120, p: 25, c: 3, f: 1.5, color: '#CCFF00' },
];

function MacroBar({ label, current, goal, color }) {
  const pct = Math.min(100, Math.round((current / goal) * 100));
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] text-white/40 uppercase tracking-wider font-bold">{label}</span>
        <span className="text-[10px] font-bold" style={{ color }}>
          {current}<span className="text-white/30">/{goal}g</span>
        </span>
      </div>
      <div className="h-[5px] rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}66` }} />
      </div>
    </div>
  );
}

function SvgIcon({ d, viewBox = "0 0 24 24", fill = "none", className = "w-5 h-5" }) {
  return (
    <svg viewBox={viewBox} fill={fill} stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      {typeof d === 'string' ? <path d={d} /> : d}
    </svg>
  );
}

export default function NutritionHub() {
  const { profile } = useAuth() || {};
  const [activeTab, setActiveTab] = useState('log');
  const [searchQuery, setSearchQuery] = useState('');
  const [scannedImage, setScannedImage] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [macros, setMacros] = useState({ calories: 1240, protein: 89, carbs: 134, fat: 38 });
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const calDash = 226;
  const calOffset = calDash - (calDash * Math.min(100, Math.round((macros.calories / MACRO_GOALS.calories) * 100))) / 100;

  const filteredFood = FOOD_DB.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const processImage = async (file) => {
    if (!file) return;
    setScanning(true);
    setScanResult(null);
    const url = URL.createObjectURL(file);
    setScannedImage(url);

    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      const prompt = `You are a nutrition expert AI. Analyze this food image carefully.
Identify ALL food items visible on the plate/image separately.
For each food item, estimate the portion size and calculate macros.
Return ONLY a valid JSON object with this exact structure, no markdown:
{
  "items": [
    {"name": "Food Name", "weight": 150, "calories": 165, "protein": 31, "carbs": 0, "fat": 3.6}
  ],
  "total": {"calories": 165, "protein": 31, "carbs": 0, "fat": 3.6},
  "confidence": "high"
}`;

      const response = await askGeminiWithImage(base64, prompt);
      if (response) {
        let data = safeParseJson(response);
        if (!data?.total) {
          const single = parseNutritionFromAiText(response);
          if (single) {
            data = {
              items: [{
                name: single.food_name,
                weight: 0,
                calories: single.calories,
                protein: single.protein_g,
                carbs: single.carbs_g,
                fat: single.fat_g,
              }],
              total: {
                calories: single.calories,
                protein: single.protein_g,
                carbs: single.carbs_g,
                fat: single.fat_g,
              },
              confidence: single.confidence,
            };
          }
        }
        if (!data?.total) {
          setScanResult({ error: 'Could not analyze image. Try again.' });
          return;
        }
        setScanResult(data);
        setMacros(prev => ({
          calories: prev.calories + data.total.calories,
          protein: prev.protein + data.total.protein,
          carbs: prev.carbs + data.total.carbs,
          fat: prev.fat + data.total.fat,
        }));
      }
    } catch (err) {
      console.error('Scan error:', err);
      setScanResult({ error: 'Could not analyze image. Try again.' });
    } finally {
      setScanning(false);
    }
  };

  const ITEM_COLORS = ['#CCFF00', '#5088FF', '#FFA53C', '#FF6B6B', '#A064FF'];

  const TABS = [
    {
      id: 'log', label: 'Daily Log',
      icon: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01"/></>
    },
    {
      id: 'scan', label: 'Scanner',
      icon: <><path d="M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M20 7V5a1 1 0 00-1-1h-2M20 17v2a1 1 0 01-1 1h-2"/><line x1="4" y1="12" x2="20" y2="12"/></>
    },
    {
      id: 'foods', label: 'Food Bank',
      icon: <><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></>
    },
    {
      id: 'supps', label: 'Supplements',
      icon: <><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18"/></>
    },
  ];

  return (
    <main className="min-h-screen bg-[#080808] text-white pb-28 overflow-x-hidden">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-[#CCFF00] opacity-[0.03] blur-3xl" />

      {/* Header */}
      <div className="px-6 pt-14 pb-4">
        <div className="font-['Orbitron',monospace] font-black text-[16px] tracking-[3px] mb-1">
          <span className="text-[#CCFF00]">∃</span>NDO <span className="text-white/40 text-[12px]">/ Nutrition</span>
        </div>
        <h1 className="text-[28px] font-bold tracking-tight">Fuel Your Body</h1>
        <p className="text-[12px] text-white/35 mt-1 italic font-light">Track. Scan. Optimize.</p>
      </div>

      {/* Tabs */}
      <div className="px-6 mb-5">
        <div className="flex gap-1.5 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
          {TABS.map(tab => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-all duration-200"
              style={{
                background: activeTab === tab.id ? 'rgba(204,255,0,0.1)' : 'transparent',
                border: activeTab === tab.id ? '1px solid rgba(204,255,0,0.25)' : '1px solid transparent',
                color: activeTab === tab.id ? '#CCFF00' : 'rgba(255,255,255,0.3)',
              }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                {tab.icon}
              </svg>
              <span className="text-[8px] font-bold uppercase tracking-wider">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── DAILY LOG ── */}
      {activeTab === 'log' && (
        <div className="px-6 space-y-4">
          {/* Calorie ring + macros */}
          <div className="rounded-[24px] border border-white/[0.07] p-5"
            style={{ background: 'linear-gradient(145deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))', boxShadow: '0 8px 28px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-5 mb-5">
              <div className="relative w-[88px] h-[88px] flex-shrink-0">
                <svg className="-rotate-90 w-full h-full" viewBox="0 0 88 88">
                  <circle cx="44" cy="44" r="36" fill="none" stroke="rgba(204,255,0,0.07)" strokeWidth="7"/>
                  <circle cx="44" cy="44" r="36" fill="none" stroke="#CCFF00" strokeWidth="7"
                    strokeLinecap="round" strokeDasharray={calDash} strokeDashoffset={calOffset}
                    style={{ filter: 'drop-shadow(0 0 6px #CCFF00)', transition: 'stroke-dashoffset 1s ease' }}/>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[18px] font-extrabold leading-none">{macros.calories}</span>
                  <span className="text-[8px] text-white/40 mt-0.5">kcal</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-wider font-bold mb-1">Today's Calories</p>
                <p className="text-[22px] font-bold">{macros.calories} <span className="text-white/30 text-[14px]">/ {MACRO_GOALS.calories}</span></p>
                <p className="text-[11px] text-white/40 mt-1">{Math.max(0, MACRO_GOALS.calories - macros.calories)} kcal remaining</p>
              </div>
            </div>
            <div className="space-y-3">
              <MacroBar label="Protein" current={macros.protein} goal={MACRO_GOALS.protein} color="#CCFF00" />
              <MacroBar label="Carbs" current={macros.carbs} goal={MACRO_GOALS.carbs} color="#5088FF" />
              <MacroBar label="Fat" current={macros.fat} goal={MACRO_GOALS.fat} color="#FFA53C" />
            </div>
          </div>

          {/* Meal Plan */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <p className="text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold">Meal Plan</p>
              <button type="button" className="text-[10px] text-[#CCFF00] font-bold">+ Add Meal</button>
            </div>
            <div className="space-y-2">
              {[
                { id: 'breakfast', label: 'Breakfast', time: '8:00 AM', items: ['Oats + egg whites', 'Black coffee'], cal: 380, done: true },
                { id: 'lunch', label: 'Lunch', time: '1:00 PM', items: ['Chicken + sweet potato', 'Mixed greens'], cal: 520, done: true },
                { id: 'dinner', label: 'Dinner', time: '7:00 PM', items: ['Salmon + brown rice'], cal: 480, done: false },
                { id: 'snack', label: 'Snack', time: 'Anytime', items: [], cal: 0, done: false },
              ].map(meal => (
                <div key={meal.id} className="rounded-[18px] border p-4 flex items-center justify-between transition-all"
                  style={{
                    background: meal.done ? 'rgba(204,255,0,0.04)' : 'rgba(255,255,255,0.025)',
                    borderColor: meal.done ? 'rgba(204,255,0,0.15)' : 'rgba(255,255,255,0.07)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
                  }}>
                  <div className="flex items-center gap-3">
                    {/* Meal icon */}
                    <div className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
                      style={{
                        background: meal.done ? 'rgba(204,255,0,0.12)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${meal.done ? 'rgba(204,255,0,0.25)' : 'rgba(255,255,255,0.08)'}`
                      }}>
                      <svg viewBox="0 0 24 24" fill="none"
                        stroke={meal.done ? '#CCFF00' : 'rgba(255,255,255,0.3)'}
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        {meal.id === 'breakfast' && <><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></>}
                        {meal.id === 'lunch' && <><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></>}
                        {meal.id === 'dinner' && <><path d="M3 11l19-9-9 19-2-8-8-2z"/></>}
                        {meal.id === 'snack' && <><path d="M12 2a10 10 0 110 20 10 10 0 010-20z"/><path d="M12 6v6l4 2"/></>}
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-bold text-white">{meal.label}</p>
                        {meal.done && (
                          <span className="text-[8px] bg-[#CCFF00]/15 text-[#CCFF00] border border-[#CCFF00]/25 px-1.5 py-0.5 rounded-full font-bold">
                            ✓ Done
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-white/35 mt-0.5">
                        {meal.items.length > 0 ? meal.items.join(' · ') : meal.time}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {meal.cal > 0 ? (
                      <>
                        <p className="text-[14px] font-black" style={{ color: meal.done ? '#CCFF00' : 'rgba(255,255,255,0.6)' }}>{meal.cal}</p>
                        <p className="text-[9px] text-white/30">kcal</p>
                      </>
                    ) : (
                      <span className="text-[11px] text-white/20 font-medium border border-white/[0.08] px-2 py-1 rounded-full">
                        + Add
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Water intake */}
          <div className="rounded-[20px] border border-white/[0.07] p-4"
            style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="#5088FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                  <path d="M12 6v6M8 10c0 2.21 1.79 4 4 4s4-1.79 4-4"/>
                </svg>
                <p className="text-[11px] font-bold text-white">Water Intake</p>
              </div>
              <span className="text-[11px] font-black text-[#5088FF]">6 <span className="text-white/30 font-normal text-[9px]">/ 8 glasses</span></span>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex-1 h-[6px] rounded-full transition-all duration-300"
                  style={{
                    background: i < 6 ? '#5088FF' : 'rgba(255,255,255,0.07)',
                    boxShadow: i < 6 ? '0 0 6px rgba(80,136,255,0.5)' : 'none'
                  }} />
              ))}
            </div>
          </div>

          {/* Last scan result preview */}
          {scanResult && !scanResult.error && (
            <div className="rounded-[20px] border border-[#CCFF00]/20 p-4"
              style={{ background: 'rgba(204,255,0,0.05)', boxShadow: '0 0 20px rgba(204,255,0,0.06)' }}>
              <p className="text-[10px] tracking-[2px] uppercase text-[#CCFF00] font-bold mb-3">Last Scan Added</p>
              <div className="space-y-2">
                {scanResult.items?.map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: ITEM_COLORS[i % ITEM_COLORS.length] }} />
                      <span className="text-[12px] text-white/80">{item.name}</span>
                      <span className="text-[10px] text-white/30">{item.weight}g</span>
                    </div>
                    <span className="text-[12px] font-bold" style={{ color: ITEM_COLORS[i % ITEM_COLORS.length] }}>{item.calories} kcal</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SCANNER ── */}
      {activeTab === 'scan' && (
        <div className="px-6 space-y-4">
          {/* Camera area */}
          <div className="rounded-[24px] border border-white/[0.07] overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 8px 28px rgba(0,0,0,0.5)' }}>
            <div className="relative h-[220px] flex items-center justify-center"
              style={{ background: scannedImage ? 'none' : 'rgba(204,255,0,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {scannedImage
                ? <img src={scannedImage} alt="scanned" className="w-full h-full object-cover" />
                : (
                  <div className="text-center">
                    <div className="absolute top-4 left-4 w-5 h-5 border-t-2 border-l-2 border-[#CCFF00] rounded-tl opacity-50" />
                    <div className="absolute top-4 right-4 w-5 h-5 border-t-2 border-r-2 border-[#CCFF00] rounded-tr opacity-50" />
                    <div className="absolute bottom-4 left-4 w-5 h-5 border-b-2 border-l-2 border-[#CCFF00] rounded-bl opacity-50" />
                    <div className="absolute bottom-4 right-4 w-5 h-5 border-b-2 border-r-2 border-[#CCFF00] rounded-br opacity-50" />
                    <div className="w-14 h-14 rounded-full bg-[#CCFF00]/10 border border-[#CCFF00]/20 flex items-center justify-center mx-auto mb-3"
                      style={{ boxShadow: '0 0 20px rgba(204,255,0,0.1)' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#CCFF00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                    </div>
                    <p className="text-[13px] font-bold text-white/70">Point camera at your food</p>
                    <p className="text-[11px] text-white/30 mt-1">AI detects multiple items automatically</p>
                  </div>
                )}
              {scanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center"
                  style={{ background: 'rgba(8,8,8,0.85)' }}>
                  <div className="w-12 h-12 rounded-full border-2 border-[#CCFF00]/30 border-t-[#CCFF00] animate-spin mb-3" />
                  <p className="text-[13px] font-bold text-[#CCFF00]">Analyzing food...</p>
                  <p className="text-[11px] text-white/40 mt-1">Detecting items & calculating macros</p>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3 p-4">
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => processImage(e.target.files?.[0])} />
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => processImage(e.target.files?.[0])} />
              <button type="button" onClick={() => cameraInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-[14px] font-bold text-[12px] transition-all active:scale-95"
                style={{ background: '#CCFF00', color: '#000' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                Camera
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-[14px] font-bold text-[12px] border transition-all active:scale-95"
                style={{ background: 'rgba(204,255,0,0.08)', borderColor: 'rgba(204,255,0,0.2)', color: '#CCFF00' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Gallery
              </button>
            </div>
          </div>

          {/* Always visible macro chart */}
          <div className="rounded-[24px] border border-white/[0.07] p-5"
            style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}>
            <p className="text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold mb-4">Today's Macros</p>
            <div className="flex items-center gap-6">
              {/* Donut chart */}
              <div className="relative flex-shrink-0 w-[110px] h-[110px]">
                <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
                  {/* Background */}
                  <circle cx="55" cy="55" r="42" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14"/>
                  {/* Protein - neon green */}
                  <circle cx="55" cy="55" r="42" fill="none" stroke="#CCFF00" strokeWidth="14"
                    strokeLinecap="butt"
                    strokeDasharray={`${(macros.protein / (macros.protein + macros.carbs + macros.fat)) * 264} 264`}
                    strokeDashoffset="0"
                    style={{ filter: 'drop-shadow(0 0 4px rgba(204,255,0,0.5))' }}/>
                  {/* Carbs - blue */}
                  <circle cx="55" cy="55" r="42" fill="none" stroke="#5088FF" strokeWidth="14"
                    strokeLinecap="butt"
                    strokeDasharray={`${(macros.carbs / (macros.protein + macros.carbs + macros.fat)) * 264} 264`}
                    strokeDashoffset={`-${(macros.protein / (macros.protein + macros.carbs + macros.fat)) * 264}`}
                    style={{ filter: 'drop-shadow(0 0 4px rgba(80,136,255,0.5))' }}/>
                  {/* Fat - orange */}
                  <circle cx="55" cy="55" r="42" fill="none" stroke="#FFA53C" strokeWidth="14"
                    strokeLinecap="butt"
                    strokeDasharray={`${(macros.fat / (macros.protein + macros.carbs + macros.fat)) * 264} 264`}
                    strokeDashoffset={`-${((macros.protein + macros.carbs) / (macros.protein + macros.carbs + macros.fat)) * 264}`}
                    style={{ filter: 'drop-shadow(0 0 4px rgba(255,165,60,0.5))' }}/>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[18px] font-black text-white">{macros.protein + macros.carbs + macros.fat}g</span>
                  <span className="text-[8px] text-white/40 uppercase tracking-wider">total</span>
                </div>
              </div>
              {/* Legend */}
              <div className="flex-1 space-y-3">
                {[
                  { label: 'Protein', val: macros.protein, goal: MACRO_GOALS.protein, color: '#CCFF00' },
                  { label: 'Carbs', val: macros.carbs, goal: MACRO_GOALS.carbs, color: '#5088FF' },
                  { label: 'Fat', val: macros.fat, goal: MACRO_GOALS.fat, color: '#FFA53C' },
                ].map(m => {
                  const pct = Math.min(100, Math.round((m.val / m.goal) * 100));
                  return (
                    <div key={m.label}>
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: m.color, boxShadow: `0 0 6px ${m.color}` }}/>
                          <span className="text-[10px] text-white/50 font-medium">{m.label}</span>
                        </div>
                        <span className="text-[11px] font-black" style={{ color: m.color }}>
                          {m.val}g <span className="text-white/25 font-normal text-[9px]">/ {m.goal}g</span>
                        </span>
                      </div>
                      <div className="h-[4px] rounded-full bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: m.color, boxShadow: `0 0 6px ${m.color}66` }}/>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
                  <span className="text-[10px] text-white/35">Calories</span>
                  <span className="text-[13px] font-black text-[#CCFF00]">{macros.calories} <span className="text-white/30 text-[9px] font-normal">/ {MACRO_GOALS.calories}</span></span>
                </div>
              </div>
            </div>
          </div>

          {/* Scan Results */}
          {scanResult && !scanResult.error && (
            <div className="rounded-[24px] border border-white/[0.07] p-5"
              style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 8px 28px rgba(0,0,0,0.4)' }}>
              <div className="flex justify-between items-center mb-4">
                <p className="text-[10px] tracking-[2px] uppercase text-[#CCFF00] font-bold">Scan Results</p>
                <span className="text-[9px] text-white/30 bg-white/[0.05] px-2 py-1 rounded-full">
                  {scanResult.confidence === 'high' ? '✓ High confidence' : 'Estimated'}
                </span>
              </div>

              {/* Items detected */}
              <div className="space-y-3 mb-4">
                {scanResult.items?.map((item, i) => {
                  const color = ITEM_COLORS[i % ITEM_COLORS.length];
                  return (
                    <div key={i} className="rounded-[16px] p-3 border"
                      style={{ background: `${color}0D`, borderColor: `${color}25` }}>
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-6 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} />
                          <div>
                            <p className="text-[12px] font-bold text-white">{item.name}</p>
                            <p className="text-[10px] text-white/35">~{item.weight}g</p>
                          </div>
                        </div>
                        <p className="text-[16px] font-black" style={{ color }}>{item.calories}</p>
                      </div>
                      <div className="flex gap-2">
                        {[{ l: 'P', v: item.protein, c: '#CCFF00' }, { l: 'C', v: item.carbs, c: '#5088FF' }, { l: 'F', v: item.fat, c: '#FFA53C' }].map(m => (
                          <div key={m.l} className="flex-1 rounded-[8px] py-1 text-center"
                            style={{ background: `${m.c}14`, border: `1px solid ${m.c}25` }}>
                            <p className="text-[8px] font-bold" style={{ color: m.c }}>{m.l}</p>
                            <p className="text-[10px] font-black text-white">{m.v}g</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Total */}
              <div className="rounded-[16px] p-4 border border-[#CCFF00]/20"
                style={{ background: 'rgba(204,255,0,0.07)' }}>
                <p className="text-[10px] tracking-wider uppercase text-[#CCFF00]/60 font-bold mb-2">Total Meal</p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-3">
                    {[
                      { l: 'Protein', v: scanResult.total?.protein, c: '#CCFF00' },
                      { l: 'Carbs', v: scanResult.total?.carbs, c: '#5088FF' },
                      { l: 'Fat', v: scanResult.total?.fat, c: '#FFA53C' },
                    ].map(m => (
                      <div key={m.l}>
                        <p className="text-[9px] text-white/35">{m.l}</p>
                        <p className="text-[13px] font-black" style={{ color: m.c }}>{m.v}g</p>
                      </div>
                    ))}
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-white/35">Total</p>
                    <p className="text-[22px] font-black text-[#CCFF00]">{scanResult.total?.calories}</p>
                    <p className="text-[9px] text-white/35">kcal</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {scanResult?.error && (
            <div className="rounded-[20px] border border-red-500/20 p-4 text-center"
              style={{ background: 'rgba(255,100,100,0.05)' }}>
              <p className="text-[13px] text-red-400">{scanResult.error}</p>
            </div>
          )}
        </div>
      )}

      {/* ── FOOD BANK ── */}
      {activeTab === 'foods' && (
        <div className="px-6 space-y-4">
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <input type="text" placeholder="Search foods..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 rounded-[16px] text-[13px] text-white placeholder-white/25 outline-none border"
              style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }} />
          </div>
          <div className="space-y-2">
            {filteredFood.map(food => (
              <div key={food.id} className="rounded-[18px] border border-white/[0.06] p-4"
                style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 4px 14px rgba(0,0,0,0.3)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 rounded-full" style={{ background: food.color, boxShadow: `0 0 8px ${food.color}66` }} />
                    <div>
                      <p className="text-[13px] font-bold text-white">{food.name}</p>
                      <p className="text-[10px] text-white/35">per 100g</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[15px] font-black" style={{ color: food.color }}>{food.cal}</p>
                    <p className="text-[9px] text-white/30">kcal</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {[{ l: 'P', v: food.p, c: '#CCFF00' }, { l: 'C', v: food.c, c: '#5088FF' }, { l: 'F', v: food.f, c: '#FFA53C' }].map(m => (
                    <div key={m.l} className="flex-1 rounded-[10px] py-1.5 text-center"
                      style={{ background: `${m.c}14`, border: `1px solid ${m.c}25` }}>
                      <p className="text-[9px] font-bold" style={{ color: m.c }}>{m.l}</p>
                      <p className="text-[11px] font-black text-white">{m.v}g</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SUPPLEMENTS ── */}
      {activeTab === 'supps' && (
        <div className="px-6 space-y-4">
          <div className="rounded-[20px] border border-white/[0.07] p-4"
            style={{ background: 'rgba(255,255,255,0.025)' }}>
            <p className="text-[10px] tracking-[2px] uppercase text-white/40 font-bold mb-1">Based on your profile</p>
            <p className="text-[13px] text-white/70">Goal: <span className="text-[#CCFF00] font-bold">Strength Gain</span> · Level: <span className="text-[#CCFF00] font-bold">Intermediate</span></p>
          </div>
          <div className="space-y-3">
            {SUPPLEMENTS.map((supp, i) => (
              <div key={i} className="rounded-[20px] border border-white/[0.06] p-4 flex items-center gap-4"
                style={{ background: 'rgba(255,255,255,0.025)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
                  style={{ background: `${supp.color}14`, border: `1px solid ${supp.color}25` }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke={supp.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-bold text-white">{supp.name}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">{supp.benefit}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                    style={{ background: `${supp.color}14`, color: supp.color, border: `1px solid ${supp.color}25` }}>
                    {supp.dose}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </main>
  );
}
