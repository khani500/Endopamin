import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, ChevronRight } from 'lucide-react';
import { DailyCheckIn } from '../components/checkin/DailyCheckIn';
import { DopaScore } from '../components/progress/DopaScore';
import { ProPaywall } from '../components/paywall/ProPaywall';
import { CoachCard } from '../components/coach/CoachCard';
import { CoachChat } from '../components/coach/CoachChat';
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
    jobType: 'mixed',
    coach: 'maya',
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
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Your lifestyle</p>
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
                    padding: '12px 8px',
                    borderRadius: 12,
                    border: `1px solid ${form.jobType === opt.id ? t.accentBorder : 'rgba(255,255,255,0.08)'}`,
                    background: form.jobType === opt.id ? t.gradBtn : 'rgba(255,255,255,0.04)',
                    color: form.jobType === opt.id ? t.btnTextColor : '#fff',
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{opt.emoji}</div>
                  <div>{opt.label}</div>
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
  const { user, setProfile } = useAuth() || {};
  const [phase, setPhase] = useState('dashboard'); // 'onboard' | 'loading' | 'dashboard'
  const [gender, setGender] = useState('male');
  const [, setUserData] = useState({});
  const [streak, setStreak] = useState(12);
  const [activeTab, setActiveTab] = useState('home');
  const [checkIn, setCheckIn] = useState(null);
  const [todayWorkout, setTodayWorkout] = useState({ completed: false });
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('DopaPeak Pro');
  const [coachChatOpen, setCoachChatOpen] = useState(false);
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
        job_type: form.jobType,
        coach_persona: form.coach,
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

  const openCoachChat = () => {
    if (userTier === 'free' && !FREE_LIMITS.coachChat) {
      setPaywallFeature('AI Coach Chat');
      setShowPaywall(true);
      return;
    }
    setCoachChatOpen(true);
  };

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
    { icon: '🏃‍♂️', name: 'Cardio', sub: '20–45 min' },
    { icon: '🏋️', name: 'Strength', sub: '30–60 min' },
    { icon: '🧘', name: 'Mobility', sub: '15–30 min' },
    { icon: '⚡', name: 'HIIT', sub: '20–40 min' },
  ];

  const DAYS = ['S','M','T','W','T','F','S'];

  const glass = {
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.08)',
  };

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
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Good morning, Taher</p>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${t.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: t.accent }}>TK</div>
      </div>

      {/* Streak Hero */}
      <div style={{ padding: '0 20px', marginBottom: 16 }}>
        <div style={{ borderRadius: 24, padding: '30px 24px 26px', border: `1px solid ${t.accentBorder}`, background: t.gradHero }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -4, lineHeight: 0.95, color: t.accent }}>{streak}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4, marginBottom: 16 }}>Day Streak · Don't break the chain</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Dopa Level</div>
              <div style={{ fontSize: 36, fontWeight: 800 }}>Lv.4</div>
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

      <CoachCard onOpenChat={openCoachChat} />

      {/* Quick Start */}
      <div style={{ padding: '0 20px', marginBottom: 12 }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Quick Start</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {QUICK.map((q, i) => (
            <button
              key={i}
              onClick={() => startSession(q.name)}
              style={{
                background: i === 0 ? t.accentDim : 'rgba(255,255,255,0.04)',
                border: `1px solid ${i === 0 ? t.accentBorder : 'rgba(255,255,255,0.08)'}`,
                borderRadius: gender === 'female' ? 18 : 14,
                padding: '14px 8px',
                textAlign: 'center',
                cursor: 'pointer',
                color: '#fff',
                fontFamily: "'Space Grotesk', sans-serif",
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>{q.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{q.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{q.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Core Stats + Activity Log */}
      <div style={{ padding: '0 20px', marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ ...glass, borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>This Week</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }}>5</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, marginBottom: 12 }}>workouts logged</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1,1,1,1,1,0,0].map((v, i) => (
                <div key={i} style={{ flex: 1, height: 3, borderRadius: 99, background: v ? t.accent : 'rgba(255,255,255,0.1)' }} />
              ))}
            </div>
          </div>
          <div style={{ ...glass, borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Today's Goal</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }}>65%</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, marginBottom: 12 }}>of daily target</div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 99 }}>
              <div style={{ height: '100%', width: '65%', background: t.gradFill, borderRadius: 99 }} />
            </div>
          </div>
          <div
            onClick={() => {
              setPaywallFeature('DopaPeak Pro');
              setShowPaywall(true);
            }}
            style={{ ...glass, borderRadius: 18, padding: 16, gridColumn: 'span 2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          >
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Dopa Premium</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Unlock Elite Mode</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>AI Coach · Unlimited plans · Analytics</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: t.accent }}>$99</span>
              <ChevronRight size={16} color="rgba(255,255,255,0.3)" />
            </div>
          </div>
        </div>
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
        <ChevronRight size={22} style={{ color: '#39FF14', flexShrink: 0 }} />
      </Link>

      {/* World Tabs */}
      <div style={{ padding: '0 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 4 }}>
          {['home', 'gym', 'outdoor'].map(tab => (
            tab === 'gym' ? (
              <Link
                key={tab}
                to="/gym"
                style={{
                  flex: 1, padding: '10px 6px', textAlign: 'center', borderRadius: 10,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.3,
                  fontFamily: "'Space Grotesk', sans-serif",
                  background: activeTab === tab ? t.accentDim : 'transparent',
                  border: activeTab === tab ? `1px solid ${t.accentBorder}` : '1px solid transparent',
                  color: activeTab === tab ? t.accent : 'rgba(255,255,255,0.4)',
                  transition: 'all 0.2s',
                  textDecoration: 'none',
                }}
              >
                🏋️ Gym
              </Link>
            ) : (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: '10px 6px', textAlign: 'center', borderRadius: 10,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.3,
                  fontFamily: "'Space Grotesk', sans-serif",
                  background: activeTab === tab ? t.accentDim : 'transparent',
                  border: activeTab === tab ? `1px solid ${t.accentBorder}` : '1px solid transparent',
                  color: activeTab === tab ? t.accent : 'rgba(255,255,255,0.4)',
                  transition: 'all 0.2s',
                }}
              >
                {tab === 'home' ? '🏠 Home' : '🌲 Outdoor'}
              </button>
            )
          ))}
        </div>
      </div>

      {/* Week Row */}
      <div style={{ padding: '0 20px', marginBottom: 12 }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>This Week</p>
        <div style={{ ...glass, borderRadius: 18, padding: '16px 12px', display: 'flex', justifyContent: 'space-between' }}>
          {DAYS.map((d, i) => {
            const isToday = i === 5;
            const isDone = i < 5;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>{d}</span>
                <div style={{
                  width: 32, height: 32, borderRadius: gender === 'female' ? '50%' : 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                  background: isToday ? t.accent : isDone ? t.accentDim : 'rgba(255,255,255,0.06)',
                  border: !isToday && isDone ? `1px solid ${t.accentBorder}` : 'none',
                  color: isToday ? t.btnTextColor : isDone ? t.accent : 'rgba(255,255,255,0.2)',
                }}>
                  {isDone || isToday ? <Flame size={14} /> : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '0 20px' }}>
        <button
          onClick={() => startSession('plan')}
          style={{ width: '100%', padding: 18, borderRadius: t.borderRadius, border: 'none', background: t.gradBtn, color: t.btnTextColor, fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 }}
        >
          {gender === 'male' ? '⚡' : '✦'} Start Today's Session
        </button>
      </div>

      <DailyCheckIn onSubmit={handleCheckInSubmit} />
      <CoachChat isOpen={coachChatOpen} onClose={() => setCoachChatOpen(false)} />
      <ProPaywall
        featureName={paywallFeature}
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={() => console.log('Payment integration coming soon')}
      />
    </div>
  );
}
