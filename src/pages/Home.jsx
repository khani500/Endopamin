import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DailyCheckIn } from '../components/checkin/DailyCheckIn';
import { DopaScore } from '../components/progress/DopaScore';
import { ProPaywall } from '../components/paywall/ProPaywall';
import { CoachCard } from '../components/coach/CoachCard';
import { useAuth } from '../context/AuthContext';
import { useDopaScore } from '../hooks/useDopaScore';
import { supabase } from '../lib/supabase';
import { requestNotificationPermission } from '../services/notifications';
import { FREE_LIMITS, userTier } from '../config/tiers';

// ─── Theme config ───────────────────────────────────────────────────────────
const THEMES = {
  male: {
    accent: '#C8FF00',
    accentDim: 'rgba(200,255,0,0.12)',
    accentBorder: 'rgba(200,255,0,0.25)',
    accentText: '#0A0A0A',
    gradHero: 'linear-gradient(135deg, rgba(200,255,0,0.08) 0%, rgba(200,255,0,0.02) 100%)',
    gradBtn: '#C8FF00',
    gradFill: 'linear-gradient(90deg, #7BFF00, #C8FF00, #FFFF00)',
    dopaLabel: 'XP → LV.5',
    cardLabel: 'VOLT MEMBER',
    btnTextColor: '#0A0A0A',
    borderRadius: '14px',
  },
  female: {
    accent: '#FF2D9B',
    accentDim: 'rgba(255,45,155,0.12)',
    accentBorder: 'rgba(255,45,155,0.25)',
    accentText: '#ffffff',
    gradHero: 'linear-gradient(135deg, rgba(255,45,155,0.10) 0%, rgba(255,45,155,0.02) 100%)',
    gradBtn: '#FF2D9B',
    gradFill: 'linear-gradient(90deg, #FF2D9B, #FF7AC6, #FF2DB8)',
    dopaLabel: 'XP → LV.5',
    cardLabel: 'PINK MEMBER',
    btnTextColor: '#ffffff',
    borderRadius: '22px',
  },
};

const coachMessages = [
  "You're on a {streak}-day streak — elite territory.",
  'Your upper body pull shows a 14% strength gain.',
  'Recovery score looks good. Time to push.',
  'Consistency is your superpower. {streak} days strong.',
  'Based on last session, try adding 2.5kg today.',
];

function getDayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function MultiRing({ rings, centerText, centerLabel }) {
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const radii = [50, 40, 30];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel}>
      {rings.map((ring, index) => {
        const radius = radii[index];
        const circumference = 2 * Math.PI * radius;
        const offset = circumference * (1 - ring.progress);
        return (
          <g key={ring.label}>
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#2a2a2a" strokeWidth="6" />
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={ring.color}
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </g>
        );
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="18" fontWeight="bold">
        {centerText}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#888" fontSize="8">
        {centerLabel}
      </text>
    </svg>
  );
}

function MultiRingCard({ title, rings, centerText, centerLabel }) {
  return (
    <div style={{ borderRadius: 18, padding: 12, background: '#1E1E1E', border: '1px solid rgba(204,255,0,0.22)' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <MultiRing rings={rings} centerText={centerText} centerLabel={centerLabel} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {rings.map(ring => (
          <span key={ring.label} style={{ fontSize: 9, color: 'rgba(255,255,255,0.48)', fontWeight: 700 }}>
            <span style={{ color: ring.color }}>●</span> {ring.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function IconShell({ children, accent = '#C8FF00' }) {
  return (
    <div style={{ width: 38, height: 38, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'rgba(200,255,0,0.08)', border: `1px solid ${accent}44` }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {children}
      </svg>
    </div>
  );
}

function PlanIcon({ accent = '#C8FF00' }) {
  return (
    <IconShell accent={accent}>
      <path d="M7 5h8l3 3v11H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke={accent} strokeWidth="1.8" />
      <path d="M15 5v4h4M8 12h7M8 16h5" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
    </IconShell>
  );
}

function RunnerIcon({ accent = '#C8FF00' }) {
  return (
    <IconShell accent={accent}>
      <circle cx="14.5" cy="4.5" r="2" fill={accent} />
      <path d="M12 8l-3 4 4 2 2-3 3 2" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 15l-3 5M15 14l3 5M8 12H5" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
    </IconShell>
  );
}

function BarbellIcon({ accent = '#C8FF00' }) {
  return (
    <IconShell accent={accent}>
      <path d="M3 12h18M6 8v8M9 10v4M15 10v4M18 8v8" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 18c1.4 1.4 4.6 1.4 6 0" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
    </IconShell>
  );
}

function YogaIcon({ accent = '#C8FF00' }) {
  return (
    <IconShell accent={accent}>
      <circle cx="12" cy="5" r="2" fill={accent} />
      <path d="M12 8v5M8 12l4 2 4-2M7 18h10M9 18l3-4 3 4" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </IconShell>
  );
}

function HiiTIcon({ accent = '#C8FF00' }) {
  return (
    <IconShell accent={accent}>
      <path d="M13 2L6 13h5l-1 9 8-13h-5l1-7Z" fill={accent} opacity="0.9" />
      <circle cx="17" cy="17" r="4" stroke={accent} strokeWidth="1.6" />
      <path d="M17 15v2l1.4 1" stroke="#0A0A0A" strokeWidth="1.4" strokeLinecap="round" />
    </IconShell>
  );
}

const quickIconMap = {
  Cardio: RunnerIcon,
  Strength: BarbellIcon,
  Mobility: YogaIcon,
  HIIT: HiiTIcon,
};

// ─── Onboarding ──────────────────────────────────────────────────────────────
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    displayName: 'Taher',
    age: '27',
    experience: 'Intermediate',
    goal: 'strength_gain',
    daysPerWeek: '4',
    timeAvailable: '30-45min',
    coach: 'maya',
    jobType: 'mixed',
  });

  const t = THEMES.male;
  const stepLabel = `Step ${step} of 3`;
  const next = () => {
    if (step < 3) {
      setStep(s => s + 1);
      return;
    }
    onComplete('male', form);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', color: '#fff', fontFamily: "'Space Grotesk', sans-serif", padding: '40px 20px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1, marginBottom: 4 }}>
        DOPA<span style={{ color: t.accent }}>PEAK</span>
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 36 }}>US High-Performance Fitness</p>

      <p style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>{stepLabel}</p>
      <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.08)', marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ width: `${(step / 3) * 100}%`, height: '100%', borderRadius: 99, background: t.gradFill }} />
      </div>

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px' }}>
            <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Display Name</label>
            <input
              value={form.displayName}
              onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 800, width: '100%' }}
            />
          </div>
          <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px' }}>
            <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Age</label>
            <input
              type="number"
              value={form.age}
              onChange={e => setForm(p => ({ ...p, age: e.target.value }))}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 800, width: '100%' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {['Beginner', 'Intermediate', 'Advanced'].map(exp => (
              <button key={exp} onClick={() => setForm(p => ({ ...p, experience: exp }))} style={{ padding: '12px 8px', borderRadius: 12, border: `1px solid ${form.experience === exp ? t.accentBorder : 'rgba(255,255,255,0.08)'}`, background: form.experience === exp ? t.accentDim : 'rgba(255,255,255,0.04)', color: form.experience === exp ? t.accent : '#fff', fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700 }}>
                {exp}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Goal</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[['weight_loss', 'Weight Loss'], ['strength_gain', 'Strength Gain'], ['maintenance', 'Maintenance']].map(([id, label]) => (
                <button key={id} onClick={() => setForm(p => ({ ...p, goal: id }))} style={{ padding: '12px 8px', borderRadius: 12, border: `1px solid ${form.goal === id ? t.accentBorder : 'rgba(255,255,255,0.08)'}`, background: form.goal === id ? t.accentDim : 'rgba(255,255,255,0.04)', color: form.goal === id ? t.accent : '#fff', fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700 }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Days per week</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {['3', '4', '5', '6'].map(days => (
                <button key={days} onClick={() => setForm(p => ({ ...p, daysPerWeek: days }))} style={{ padding: '12px 8px', borderRadius: 12, border: `1px solid ${form.daysPerWeek === days ? t.accentBorder : 'rgba(255,255,255,0.08)'}`, background: form.daysPerWeek === days ? t.accentDim : 'rgba(255,255,255,0.04)', color: form.daysPerWeek === days ? t.accent : '#fff', fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700 }}>
                  {days}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Time available</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {['<30min', '30-45min', '45-60min', '>60min'].map(time => (
                <button key={time} onClick={() => setForm(p => ({ ...p, timeAvailable: time }))} style={{ padding: '12px 8px', borderRadius: 12, border: `1px solid ${form.timeAvailable === time ? t.accentBorder : 'rgba(255,255,255,0.08)'}`, background: form.timeAvailable === time ? t.accentDim : 'rgba(255,255,255,0.04)', color: form.timeAvailable === time ? t.accent : '#fff', fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700 }}>
                  {time}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Your lifestyle:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { id: 'desk_worker', label: 'Desk Job', emoji: '💻' },
                { id: 'active', label: 'Active Job', emoji: '🏃' },
                { id: 'mixed', label: 'Mixed', emoji: '⚡' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setForm(p => ({ ...p, jobType: opt.id }))}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    textAlign: 'center',
                    border: `1px solid ${form.jobType === opt.id ? t.accentBorder : 'rgba(255,255,255,0.08)'}`,
                    background: form.jobType === opt.id ? t.gradBtn : '#1a1a1a',
                    color: form.jobType === opt.id ? t.btnTextColor : '#fff',
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{opt.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{opt.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {[
            { id: 'elias', name: 'Coach Elias', title: 'Calm Guide', desc: 'Steady recovery-aware guidance.' },
            { id: 'maya', name: 'Coach Maya', title: 'Hype Beast', desc: 'High-energy push and momentum.' },
            { id: 'rex', name: 'Coach Rex', title: 'Military Precision', desc: 'Direct structure and accountability.' },
          ].map(c => (
            <div key={c.id} style={{ background: form.coach === c.id ? t.accentDim : 'rgba(255,255,255,0.04)', border: `1px solid ${form.coach === c.id ? t.accentBorder : 'rgba(255,255,255,0.08)'}`, borderRadius: 16, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{c.name} — {c.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 6, marginBottom: 12 }}>{c.desc}</div>
              <button onClick={() => setForm(p => ({ ...p, coach: c.id }))} style={{ width: '100%', padding: 10, borderRadius: 12, border: `1px solid ${t.accentBorder}`, background: form.coach === c.id ? t.gradBtn : 'rgba(255,255,255,0.04)', color: form.coach === c.id ? t.btnTextColor : t.accent, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                Select
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1} style={{ flex: 1, padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', opacity: step === 1 ? 0.45 : 1, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 800 }}>
          ← Back
        </button>
        <button onClick={next} style={{ flex: 1, padding: 16, borderRadius: 14, border: 'none', background: t.gradBtn, color: t.btnTextColor, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 800 }}>
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Loading Screen ──────────────────────────────────────────────────────────
function LoadingScreen({ gender, onDone }) {
  const t = THEMES[gender];
  const [msgIdx, setMsgIdx] = useState(0);
  const msgs = ['Analyzing your biometrics', 'Calculating your 1RM baseline', 'Building your 12-week plan', 'Calibrating Dopamine Engine', 'Almost ready...'];

  useState(() => {
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i < msgs.length) setMsgIdx(i);
      else { clearInterval(iv); setTimeout(onDone, 500); }
    }, 500);
    return () => clearInterval(iv);
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', color: '#fff', fontFamily: "'Space Grotesk', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        border: `2px solid rgba(255,255,255,0.08)`,
        borderTop: `2px solid ${t.accent}`,
        animation: 'spin 1s linear infinite',
        marginBottom: 28,
      }} />
      <div style={{ fontSize: 22, fontWeight: 700, textAlign: 'center', marginBottom: 8, letterSpacing: -0.5 }}>
        Generating your<br />Dopamine-Core Plan...
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 28 }}>{msgs[msgIdx]}</div>
      <div style={{ width: 200, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: t.gradFill, borderRadius: 99, animation: 'fillbar 2.5s ease forwards' }} />
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fillbar { from { width: 0% } to { width: 100% } }
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700;800&display=swap');
      `}</style>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function Home() {
  const { user, profile, setProfile } = useAuth() || {};
  const navigate = useNavigate();
  const [phase, setPhase] = useState('dashboard'); // 'onboard' | 'loading' | 'dashboard'
  const [gender, setGender] = useState('male');
  const [, setUserData] = useState({});
  const [streak, setStreak] = useState(12);
  const [checkIn, setCheckIn] = useState(null);
  const [todayWorkout, setTodayWorkout] = useState({ completed: false });
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('DopaPeak Pro');
  const [notificationPermissionAsked, setNotificationPermissionAsked] = useState(() => {
    try {
      return localStorage.getItem('dopapeak_notification_permission_asked') === '1';
    } catch {
      return false;
    }
  });
  const t = THEMES[gender];
  const dopaScore = useDopaScore({
    checkIn,
    caloriesLogged: 2223,
    todayWorkout,
  });
  const dailyCoachMessage = coachMessages[getDayOfYear() % coachMessages.length].replace('{streak}', streak);
  const displayName = profile?.display_name || 'Taher';
  const showDeskBreakCard = profile?.job_type === 'desk_worker' || profile?.job_type === 'mixed';
  const initials = displayName
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'TA';

  const handleOnboardComplete = async (g, form) => {
    setGender(g);
    setUserData(form);
    if (supabase && user?.id) {
      const profileUpdate = {
        id: user.id,
        display_name: form.displayName,
        age: Number(form.age) || null,
        experience: form.experience.toLowerCase(),
        goal: form.goal,
        days_per_week: Number(form.daysPerWeek) || null,
        time_available: form.timeAvailable,
        coach_persona: form.coach,
        job_type: form.jobType,
      };
      const { data, error } = await supabase
        .from('profiles')
        .upsert(profileUpdate, { onConflict: 'id' })
        .select('*')
        .single();

      if (!error && data) {
        setProfile(data);
      }
    }
    setPhase('loading');
  };

  const handleLoadDone = () => setPhase('dashboard');

  const startSession = () => {
    if (userTier === 'free' && streak >= FREE_LIMITS.workoutsPerWeek) {
      setPaywallFeature('Weekly Workouts');
      setShowPaywall(true);
      return;
    }
    setStreak(p => p + 1);
    setTodayWorkout({ completed: true });
  };

  const handleCheckInSubmit = async payload => {
    setCheckIn(payload);
    if (payload.submitted && !notificationPermissionAsked) {
      await requestNotificationPermission();
      setNotificationPermissionAsked(true);
      try {
        localStorage.setItem('dopapeak_notification_permission_asked', '1');
      } catch {
        /* ignore */
      }
    }
  };

  const QUICK = [
    { name: 'Cardio', sub: '20–45 min' },
    { name: 'Strength', sub: '30–60 min' },
    { name: 'Mobility', sub: '15–30 min' },
    { name: 'HIIT', sub: '20–40 min' },
  ];

  if (phase === 'onboard') return <Onboarding onComplete={handleOnboardComplete} />;
  if (phase === 'loading') return <LoadingScreen gender={gender} onDone={handleLoadDone} />;

  // ── Dashboard ──
  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', color: '#fff', fontFamily: "'Space Grotesk', sans-serif", paddingBottom: 80 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700;800&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      {/* Header */}
      <div style={{ padding: '40px 20px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>
            DOPA<span style={{ color: t.accent }}>PEAK</span>
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Hi, {displayName}</p>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${t.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: t.accent, background: '#111' }}>{initials}</div>
      </div>

      {/* Streak + Level hero */}
      <div style={{ padding: '0 20px', marginBottom: 18 }}>
        <div style={{ borderRadius: 30, padding: 22, border: `1px solid ${t.accentBorder}`, background: '#111', boxShadow: `0 18px 40px ${t.accentDim}, inset 0 0 0 1px rgba(255,255,255,0.02)` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div style={{ borderRadius: 22, padding: 18, background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', marginBottom: 6 }}>Dopa Level</div>
              <div style={{ fontSize: 56, fontWeight: 950, letterSpacing: -2.5, color: '#fff', lineHeight: 1 }}>Lv.4</div>
            </div>
            <div style={{ borderRadius: 22, padding: 18, background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', marginBottom: 6 }}>Streak</div>
              <div style={{ fontSize: 56, fontWeight: 950, letterSpacing: -2.5, color: t.accent, lineHeight: 1 }}>{streak}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.36)', marginTop: 2 }}>days strong</div>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
              <span style={{ color: t.accent }}>{t.dopaLabel}</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>68% → Lv.5</span>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '68%', background: t.gradFill, borderRadius: 99 }} />
            </div>
          </div>
        </div>
      </div>

      <DopaScore score={dopaScore.score} color={dopaScore.color} breakdown={dopaScore.breakdown} />

      <CoachCard fallbackMessage={dailyCoachMessage} />

      {/* Quick Start */}
      <div style={{ padding: '0 20px', marginBottom: 12 }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Quick Start</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {QUICK.map(q => (
            <button
              key={q.name}
              onClick={() => navigate(`/workout/${q.name.toLowerCase()}`)}
              style={{
                background: '#1E1E1E',
                border: `1px solid ${t.accentBorder}`,
                borderRadius: gender === 'female' ? 18 : 14,
                padding: '10px 6px',
                textAlign: 'center',
                cursor: 'pointer',
                color: '#fff',
                fontFamily: "'Space Grotesk', sans-serif",
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                {(() => {
                  const Icon = quickIconMap[q.name];
                  return <Icon accent={t.accent} />;
                })()}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{q.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{q.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <Link
        to="/group"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '0 20px 14px',
          padding: 14,
          borderRadius: 18,
          background: '#141416',
          border: `1px solid ${t.accentBorder}`,
          color: '#fff',
          textDecoration: 'none',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', color: t.accent }}>👥 Train Together</div>
          <div style={{ marginTop: 3, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Workout with friends anywhere</div>
        </div>
        <span style={{ color: t.accent, fontSize: 20 }}>→</span>
      </Link>

      {/* Core Stats + Activity Log */}
      <div style={{ padding: '0 20px', marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <MultiRingCard
            title="This Week"
            centerText="5"
            centerLabel="workouts"
            rings={[
              { label: 'Workouts', progress: 5 / 6, color: '#CCFF00' },
              { label: 'Streak', progress: Math.min(streak / 14, 1), color: '#BF5AF2' },
              { label: 'XP', progress: 0.68, color: '#FFD60A' },
            ]}
          />
          <MultiRingCard
            title="Today's Goal"
            centerText="65%"
            centerLabel="complete"
            rings={[
              { label: 'Calories', progress: 0.72, color: '#CCFF00' },
              { label: 'Protein', progress: 0.64, color: '#32ADE6' },
              { label: 'Workout', progress: todayWorkout.completed ? 1 : 0.35, color: '#FF9500' },
            ]}
          />
        </div>
      </div>

      {/* Plan action card */}
      <div style={{ padding: '0 20px', marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { label: 'Workout Plan', sub: 'Today map', to: '/plan/workout', Icon: BarbellIcon },
          { label: 'Nutrition Plan', sub: "Today's meals", to: '/plan/nutrition', Icon: PlanIcon },
        ].map(({ label, sub, to, Icon }) => (
          <Link
            key={label}
            to={to}
            style={{
              textDecoration: 'none',
              color: '#fff',
              borderRadius: 20,
              padding: 14,
              background: '#1E1E1E',
              border: `1px solid ${t.accentBorder}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minHeight: 88,
            }}
          >
            <Icon accent={t.accent} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: -0.2 }}>{label}</div>
              <div style={{ marginTop: 3, fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{sub}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.32)', fontSize: 18 }}>›</span>
          </Link>
        ))}
      </div>

      {/* Nutrition + AI coach hub (see /log) */}
      <Link
        to="/log"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '0 20px 16px',
          padding: '14px 16px',
          borderRadius: 16,
          background: 'rgba(57,255,20,0.07)',
          border: '1px solid rgba(57,255,20,0.35)',
          color: '#fff',
          textDecoration: 'none',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#39FF14', letterSpacing: -0.3 }}>Smart Nutrition</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>Food scan · Daily overview · Meal plan</div>
        </div>
        <span style={{ color: '#39FF14', flexShrink: 0, fontSize: 22 }}>›</span>
      </Link>

      {/* CTA */}
      <div style={{ padding: '0 20px' }}>
        <button
          onClick={() => startSession('plan')}
          style={{ width: '100%', padding: 18, borderRadius: t.borderRadius, border: 'none', background: t.gradBtn, color: t.btnTextColor, fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 }}
        >
          {gender === 'male' ? '⚡' : '✦'} Start Today's Session
        </button>
      </div>

      {/* Workout choice cards */}
      <div style={{ padding: '16px 20px 0', marginBottom: 8 }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Choose Workout</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            type="button"
            onClick={() => navigate('/workout/mobility')}
            style={{
              textDecoration: 'none',
              color: '#fff',
              borderRadius: 20,
              padding: 14,
              background: '#1E1E1E',
              border: `1px solid ${t.accentBorder}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 116,
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <RunnerIcon accent={t.accent} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: -0.2 }}>🏠 Home Workout</div>
              <div style={{ marginTop: 3, fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>Bodyweight · quick</div>
            </div>
          </button>

          <Link
            to="/gym"
            style={{
              textDecoration: 'none',
              color: '#fff',
              borderRadius: 20,
              padding: 14,
              background: '#1E1E1E',
              border: `1px solid ${t.accentBorder}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 116,
            }}
          >
            <BarbellIcon accent={t.accent} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: -0.2 }}>🏋️ Gym Workout</div>
              <div style={{ marginTop: 3, fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>Machines · weights</div>
            </div>
          </Link>
        </div>
        {showDeskBreakCard && (
          <button
            type="button"
            onClick={() => navigate('/gym/desk-break/quick_5')}
            style={{
              width: '100%',
              marginTop: 10,
              border: `1px solid ${t.accentBorder}`,
              background: '#111',
              color: '#fff',
              borderRadius: 20,
              padding: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              textAlign: 'left',
              fontFamily: "'Space Grotesk', sans-serif",
              cursor: 'pointer',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: t.accent }}>🪑 Desk Break — Quick Reset 5min</div>
              <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Next break in 47 min</div>
            </div>
            <span style={{ borderRadius: 999, background: t.accent, color: t.btnTextColor, padding: '8px 12px', fontSize: 11, fontWeight: 900 }}>Start</span>
          </button>
        )}
      </div>

      <DailyCheckIn onSubmit={handleCheckInSubmit} />
      <ProPaywall
        featureName={paywallFeature}
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={() => console.log('Payment integration coming soon')}
      />
    </div>
  );
}
