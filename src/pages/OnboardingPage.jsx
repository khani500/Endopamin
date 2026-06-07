import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  fetchTrainingKnowledgeForOnboarding,
  generateOnboardingNutritionPlan,
  generateOnboardingWorkoutPlan,
  getFallbackWorkoutPlan,
} from '../lib/gemini';

const LOADING_PHASES = [
  { until: 3, text: 'Analyzing your profile...' },
  { until: 6, text: 'Applying NASM & NSCA protocols...' },
  { until: 9, text: 'Building your workout plan...' },
  { until: 12, text: 'Calculating your nutrition...' },
  { until: Infinity, text: 'Almost ready...' },
];

function getLoadingMessage(elapsedSec) {
  return LOADING_PHASES.find(phase => elapsedSec < phase.until)?.text || 'Almost ready...';
}

function toKg(weight, unit) {
  const w = Number(weight);
  if (!w || w <= 0) return null;
  return unit === 'kg' ? w : w * 0.453592;
}

function toCm(height, unit) {
  const h = Number(height);
  if (!h || h <= 0) return null;
  return unit === 'cm' ? h : h * 2.54;
}

function calcBmi(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

function buildAthleteProfile(form, savedProfile = {}) {
  const heightCm = toCm(form.height || savedProfile.height, form.height_unit || savedProfile.height_unit || 'cm');
  const weightKg = toKg(form.weight || savedProfile.weight, form.weight_unit || savedProfile.weight_unit || 'kg');
  const targetWeightKg = toKg(
    form.target_weight || savedProfile.target_weight || form.weight || savedProfile.weight,
    form.weight_unit || savedProfile.weight_unit || 'kg',
  );

  return {
    display_name: form.display_name || savedProfile.display_name || 'Athlete',
    age: form.age ? Number(form.age) : savedProfile.age,
    gender: String(form.gender || savedProfile.gender || 'male').toLowerCase(),
    height_cm: heightCm,
    weight_kg: weightKg ? Math.round(weightKg * 10) / 10 : null,
    target_weight_kg: targetWeightKg ? Math.round(targetWeightKg * 10) / 10 : null,
    bmi: calcBmi(heightCm, weightKg),
    goal: form.goal || savedProfile.goal || 'fat_loss',
    experience_level: form.experience || savedProfile.experience || 'intermediate',
    activity_level: savedProfile.activity || 'moderate',
    location: savedProfile.location || 'gym',
    equipment: savedProfile.equipment || 'full_gym',
    days_per_week: savedProfile.days_per_week || 4,
    injuries: form.injuries || savedProfile.injuries || 'none',
    coach_persona: form.coach_persona || savedProfile.coach_persona || 'aria',
  };
}

const FALLBACK_NUTRITION = {
  daily_calories: 2200,
  protein_g: 150,
  carbs_g: 220,
  fat_g: 65,
  meals: [
    { name: 'Breakfast', time: '8:00 AM', calories: 500, foods: ['Eggs', 'Oats', 'Berries'], protein_g: 30, carbs_g: 55, fat_g: 15 },
    { name: 'Lunch', time: '1:00 PM', calories: 650, foods: ['Chicken', 'Rice', 'Vegetables'], protein_g: 45, carbs_g: 70, fat_g: 18 },
    { name: 'Dinner', time: '7:00 PM', calories: 600, foods: ['Fish', 'Potato', 'Salad'], protein_g: 40, carbs_g: 55, fat_g: 20 },
  ],
  water_glasses: 8,
  notes: 'Balanced plan based on your profile. Adjust portions as you track progress.',
};

// ── Coaches ────────────────────────────────────────────────────────────────
const COACHES = [
  {
    id: 'aria',
    name: 'Aria',
    role: 'Wellness · Science',
    color: '#CCFF00',
    bg: '#0d1a00',
    img: '/coaches/aria.jpg',
    tagline: 'Data-driven. Warm. Always on your side.',
    badge: 'FREE',
    badgeBg: '#0d1a00',
  },
  {
    id: 'kane',
    name: 'Kane',
    role: 'Elite · Demanding',
    color: '#FFA53C',
    bg: '#1f0e00',
    img: '/coaches/kane.jpg',
    tagline: 'No excuses. Brutal honesty. Real results.',
    badge: 'FREE',
    badgeBg: '#1f0e00',
  },
  {
    id: 'blaze',
    name: 'Blaze',
    role: 'Gen-Z · Hype',
    color: '#FF6B6B',
    bg: '#1f0808',
    img: '/coaches/blaze.png',
    tagline: 'Hyped up. High energy. Never boring.',
    badge: 'LV 5',
    badgeBg: '#1f0808',
  },
  {
    id: 'nova',
    name: 'Nova',
    role: 'Balance · Flow',
    color: '#A064FF',
    bg: '#120a1f',
    img: '/coaches/nova.jpg',
    tagline: 'Mind-body balance. Sustainable growth.',
    badge: '7-DAY STK',
    badgeBg: '#120a1f',
  },
  {
    id: 'zara',
    name: 'Zara',
    role: 'Fierce · Warm',
    color: '#FF4DBA',
    bg: '#1f0015',
    img: '/coaches/zara.png',
    tagline: 'Fierce outside. Warm inside. Gets results.',
    badge: '10 WRK',
    badgeBg: '#1f0015',
  },
];

const GOALS = [
  { id: 'fat_loss', label: 'Burn Fat & Lose Weight', icon: '🔥' },
  { id: 'muscle', label: 'Build Muscle & Get Bigger', icon: '💪' },
  { id: 'endurance', label: 'Athletic Performance', icon: '⚡' },
  { id: 'health', label: 'Stay Healthy & Feel Better', icon: '✨' },
];

const EXPERIENCE = [
  { id: 'beginner', label: 'Beginner', sub: 'Just starting out', color: '#666' },
  { id: 'intermediate', label: 'Intermediate', sub: '6 mo – 2 years', color: '#FFA53C' },
  { id: 'advanced', label: 'Advanced', sub: '2+ years', color: '#FF6B6B' },
  { id: 'athlete', label: 'Athlete', sub: 'Competitive level', color: '#CCFF00' },
];

const ONBOARDING_CSS = `
  @keyframes onboarding-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes onboarding-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes onboarding-fade-up {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes onboarding-fade-down {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes onboarding-msg-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes onboarding-pulse-dot {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.3); }
  }
  @keyframes onboarding-progress {
    0% { width: 0%; }
    50% { width: 85%; }
    100% { width: 92%; }
  }
  @keyframes onboarding-success-in {
    from { opacity: 0; transform: scale(0.92); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes onboarding-check-pop {
    from { transform: scale(0); }
    to { transform: scale(1); }
  }
  @keyframes onboarding-slide-forward {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes onboarding-slide-back {
    from { transform: translateX(-100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes onboarding-tagline-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .onboarding-step-forward {
    animation: onboarding-slide-forward 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  }
  .onboarding-step-back {
    animation: onboarding-slide-back 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  }
  .onboarding-fade-in { animation: onboarding-fade-in 0.4s ease both; }
  .onboarding-fade-up { animation: onboarding-fade-up 0.4s ease 0.2s both; }
  .onboarding-fade-down { animation: onboarding-fade-down 0.4s ease 0.3s both; }
  .onboarding-tap:active { transform: scale(0.97); }
  .onboarding-tap-sm:active { transform: scale(0.96); }
  .onboarding-init-spinner {
    animation: onboarding-spin 1s linear infinite;
  }
  .onboarding-init-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #0A0A0A;
    padding: 40px 24px;
    text-align: center;
  }
  .onboarding-init-progress-fill {
    height: 100%;
    background: #fff;
    border-radius: 1px;
    transition: width 0.4s ease;
  }
  .onboarding-init-progress-fill--active {
    animation: onboarding-progress 12s ease-in-out infinite alternate;
  }
  .onboarding-msg {
    animation: onboarding-msg-in 0.3s ease both;
  }
  .onboarding-dot {
    animation: onboarding-pulse-dot 0.8s ease infinite;
  }
  .onboarding-progress-fill {
    height: 100%;
    background: #CCFF00;
    border-radius: 1px;
    transition: width 0.4s ease;
  }
  .onboarding-progress-fill--active {
    animation: onboarding-progress 12s ease-in-out infinite alternate;
  }
  .onboarding-success {
    animation: onboarding-success-in 0.4s ease-out both;
  }
  .onboarding-check {
    animation: onboarding-check-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .onboarding-tagline {
    animation: onboarding-tagline-in 0.25s ease both;
  }
`;

// ── Main Component ─────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, setProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [saving, setSaving] = useState(false);
  const [initDone, setInitDone] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_PHASES[0].text);
  const [generatingPlans, setGeneratingPlans] = useState(false);
  const [planSummary, setPlanSummary] = useState({ dailyCalories: null });
  const loadingTimerRef = useRef(null);
  const generationStartedRef = useRef(null);
  const [form, setForm] = useState({
    display_name: '',
    age: '',
    gender: 'male',
    weight: '',
    weight_unit: 'kg',
    height: '',
    height_unit: 'cm',
    goal: 'fat_loss',
    experience: 'intermediate',
    coach_persona: 'aria',
    injuries: '',
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const next = () => { setDir(1); setStep(s => s + 1); };
  const back = () => { setDir(-1); setStep(s => s - 1); };

  useEffect(() => {
    if (step === 4) console.log('InitScreen shown, step === 4');
  }, [step]);

  useEffect(() => {
    if (!initDone) return;
    console.log('SUCCESS SCREEN');

    const timer = window.setTimeout(async () => {
      sessionStorage.removeItem('onboarding_init_active');
      localStorage.setItem('onboarding_done', 'true');

      if (user?.id && supabase) {
        const { data } = await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id)
          .select('*')
          .single();
        if (data) setProfile(data);
      }

      navigate('/', { replace: true });
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [initDone, navigate, user?.id, setProfile]);

  useEffect(() => () => {
    if (loadingTimerRef.current) window.clearInterval(loadingTimerRef.current);
  }, []);

  const startLoadingTimer = () => {
    generationStartedRef.current = Date.now();
    setLoadingMessage(LOADING_PHASES[0].text);
    if (loadingTimerRef.current) window.clearInterval(loadingTimerRef.current);
    loadingTimerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - generationStartedRef.current) / 1000;
      setLoadingMessage(getLoadingMessage(elapsed));
    }, 400);
  };

  const stopLoadingTimer = () => {
    if (loadingTimerRef.current) {
      window.clearInterval(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  };

  const generateAndSavePlans = async (profileData) => {
    if (!user?.id || !supabase) return null;

    const athlete = buildAthleteProfile(form, profileData);
    const coachId = athlete.coach_persona;

    let knowledgeContent = '';
    try {
      knowledgeContent = await fetchTrainingKnowledgeForOnboarding(20);
    } catch (err) {
      console.warn('Training knowledge fetch failed:', err);
    }

    let workoutPlan;
    try {
      workoutPlan = await generateOnboardingWorkoutPlan(athlete, knowledgeContent);
    } catch (err) {
      console.error('Workout plan generation failed, using fallback:', err);
      workoutPlan = getFallbackWorkoutPlan(coachId, athlete.gender);
    }

    let nutritionPlan;
    try {
      nutritionPlan = await generateOnboardingNutritionPlan(athlete);
    } catch (err) {
      console.error('Nutrition plan generation failed, using fallback:', err);
      nutritionPlan = FALLBACK_NUTRITION;
    }

    await supabase
      .from('workout_plans')
      .update({ is_active: false })
      .eq('user_id', user.id);

    const { error: workoutInsertError } = await supabase.from('workout_plans').insert({
      user_id: user.id,
      coach_id: coachId,
      plan_data: { ...workoutPlan, gender: athlete.gender },
      week_start: new Date().toISOString().split('T')[0],
      is_active: true,
    });

    if (workoutInsertError) {
      console.error('Workout plan save failed:', workoutInsertError);
    }

    await supabase
      .from('nutrition_plans')
      .update({ is_active: false })
      .eq('user_id', user.id);

    const { error: nutritionInsertError } = await supabase.from('nutrition_plans').insert({
      user_id: user.id,
      plan_data: nutritionPlan,
      is_active: true,
    });

    if (nutritionInsertError) {
      console.warn('Nutrition plan save failed (run nutrition_plans migration):', nutritionInsertError.message);
    }

    return { nutritionPlan };
  };

  const save = async () => {
    if (!user || !supabase) { next(); return; }
    sessionStorage.setItem('onboarding_init_active', 'true');
    setSaving(true);
    const payload = {
      id: user.id,
      onboarding_completed: false,
      display_name: form.display_name || 'Athlete',
      age: form.age ? Number(form.age) : null,
      gender: form.gender,
      weight: form.weight ? Number(form.weight) : null,
      weight_unit: form.weight_unit,
      height: form.height ? Number(form.height) : null,
      height_unit: form.height_unit,
      goal: form.goal,
      experience: form.experience,
      coach_persona: form.coach_persona,
      injuries: form.injuries,
    };
    const { data, error } = await supabase
      .from('profiles').upsert(payload, { onConflict: 'id' }).select('*').single();
    setSaving(false);

    if (error) {
      console.error('Profile save failed:', error);
    }

    const profileData = data || { ...payload };
    // Defer setProfile until success screen completes so OnboardingRoute stays mounted.

    next();
    setGeneratingPlans(true);
    startLoadingTimer();

    try {
      const result = await generateAndSavePlans(profileData);
      if (result?.nutritionPlan?.daily_calories) {
        setPlanSummary({ dailyCalories: result.nutritionPlan.daily_calories });
      } else {
        setPlanSummary({ dailyCalories: FALLBACK_NUTRITION.daily_calories });
      }
    } catch (err) {
      console.error('Plan generation failed:', err);
      setPlanSummary({ dailyCalories: FALLBACK_NUTRITION.daily_calories });
    } finally {
      stopLoadingTimer();
      setGeneratingPlans(false);
      setInitDone(true);
    }
  };

  const STEPS = [
    <SplashScreen onStart={next} key="splash" />,
    <CoachScreen form={form} set={set} onNext={next} onBack={back} key="coach" />,
    <GoalScreen form={form} set={set} onNext={next} onBack={back} key="goal" />,
    <StatsScreen form={form} set={set} onNext={save} onBack={back} saving={saving} key="stats" />,
  ];

  return (
    <div style={{
      minHeight: '100vh', background: '#060608', color: '#fff',
      overflow: 'hidden', position: 'relative',
    }}>
      <style>{ONBOARDING_CSS}</style>
      {step < 4 && (
        <div
          key={step}
          className={dir > 0 ? 'onboarding-step-forward' : 'onboarding-step-back'}
          style={{ minHeight: '100vh' }}
        >
          {STEPS[step]}
        </div>
      )}
      {step === 4 && (
        <InitScreen
          done={initDone}
          loadingMessage={loadingMessage}
          generating={generatingPlans}
          dailyCalories={planSummary.dailyCalories}
        />
      )}
    </div>
  );
}

// ── Screen 1: Splash ───────────────────────────────────────────────────────
function SplashScreen({ onStart }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      {/* Hero Image */}
      <div style={{ position: 'relative', flex: 1, minHeight: 420 }}>
        <img
          src="/coaches/athlete-couple.jpg"
          alt="athletes"
          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
          onError={e => { e.target.style.display = 'none'; }}
        />
        {/* Gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(6,6,8,0.3) 0%, rgba(6,6,8,0.1) 40%, rgba(6,6,8,0.95) 85%, #060608 100%)',
        }} />
        {/* Logo */}
        <div style={{ position: 'absolute', top: 56, left: 0, right: 0, textAlign: 'center' }}>
          <div className="onboarding-fade-down">
            <div style={{ fontSize: 11, color: '#CCFF00', letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
              ∃NDOPAMIN
            </div>
            <div style={{ fontSize: 10, color: '#444', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Endorphin · Dopamine
            </div>
          </div>
        </div>
      </div>

      {/* Bottom content */}
      <div style={{ padding: '0 24px 48px', background: '#060608' }}>
        <div className="onboarding-fade-up">
          <h1 style={{
            fontSize: 36, fontWeight: 900, letterSpacing: '-0.05em',
            textTransform: 'uppercase', lineHeight: 1.0, marginBottom: 8,
          }}>
            UNLOCK YOUR<br /><span style={{ color: '#CCFF00' }}>INNER ATHLETE</span>
          </h1>
          <p style={{ fontSize: 13, color: '#555', marginBottom: 28, lineHeight: 1.6 }}>
            Your dopamine. Your discipline. Your evolution.
          </p>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 24 }}>
            {[['47k', 'Athletes'], ['4.9★', 'Rating'], ['92%', 'Streak']].map(([n, l]) => (
              <div key={l} style={{ background: '#0e0e0e', borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#CCFF00' }}>{n}</div>
                <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>

          <button
            className="onboarding-tap"
            onClick={onStart}
            style={{
              width: '100%', background: '#CCFF00', color: '#060608',
              fontSize: 14, fontWeight: 900, padding: '15px', borderRadius: 14,
              border: 'none', cursor: 'pointer', letterSpacing: '0.05em',
              fontFamily: 'inherit', transition: 'transform 0.1s',
            }}
          >
            I'M READY →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Screen 2: Coach ────────────────────────────────────────────────────────
function CoachScreen({ form, set, onNext, onBack }) {
  const selected = COACHES.find(c => c.id === form.coach_persona);
  return (
    <div style={{ minHeight: '100vh', padding: '52px 20px 40px', display: 'flex', flexDirection: 'column' }}>
      <StepHeader step={1} total={3} label="Choose Your Coach" sub="Your AI coach — always available, always honest" />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {COACHES.map(coach => {
          const sel = form.coach_persona === coach.id;
          return (
            <div
              key={coach.id}
              className="onboarding-tap"
              onClick={() => set('coach_persona', coach.id)}
              style={{
                background: sel ? coach.bg : '#0e0e0e',
                border: `0.5px solid ${sel ? coach.color : '#1e1e1e'}`,
                borderRadius: 14,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
                transition: 'all 0.15s, transform 0.1s',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                border: `1.5px solid ${sel ? coach.color : '#2a2a2a'}`,
              }}>
                <img
                  src={coach.img}
                  alt={coach.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => {
                    e.target.style.display = 'none';
                    e.target.parentNode.style.background = coach.bg;
                    e.target.parentNode.style.display = 'flex';
                    e.target.parentNode.style.alignItems = 'center';
                    e.target.parentNode.style.justifyContent = 'center';
                    e.target.parentNode.innerHTML = `<span style="font-size:18px;font-weight:900;color:${coach.color}">${coach.name[0]}</span>`;
                  }}
                />
              </div>
              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: sel ? coach.color : '#fff' }}>{coach.name}</span>
                  <span style={{
                    fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: sel ? coach.color : '#1e1e1e', color: sel ? '#060608' : '#555',
                  }}>{coach.badge}</span>
                </div>
                <div style={{ fontSize: 10, color: sel ? coach.color : '#555', opacity: 0.8, marginBottom: 2 }}>{coach.role}</div>
                {sel && (
                  <div className="onboarding-tagline"
                    style={{ fontSize: 10, color: '#888' }}>
                    "{coach.tagline}"
                  </div>
                )}
              </div>
              {/* Check */}
              {sel && (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="9" cy="9" r="8" stroke={coach.color} strokeWidth="1"/>
                  <path d="M5.5 9l2.5 2.5 4.5-4.5" stroke={coach.color} strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              )}
            </div>
          );
        })}
      </div>

      <Buttons onNext={onNext} onBack={onBack} showBack={false} label="CHOOSE & NEXT →" />
    </div>
  );
}

// ── Screen 3: Goal ─────────────────────────────────────────────────────────
function GoalScreen({ form, set, onNext, onBack }) {
  return (
    <div style={{ minHeight: '100vh', padding: '52px 20px 40px', display: 'flex', flexDirection: 'column' }}>
      <StepHeader step={2} total={3} label="What's Your Mission?" sub="Pick one — your coach adapts everything around it" />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
        {GOALS.map(g => {
          const sel = form.goal === g.id;
          return (
            <div
              key={g.id}
              className="onboarding-tap"
              onClick={() => set('goal', g.id)}
              style={{
                background: sel ? '#111900' : '#0e0e0e',
                border: `0.5px solid ${sel ? '#CCFF00' : '#1e1e1e'}`,
                borderRadius: 14, padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
                transition: 'transform 0.1s',
              }}
            >
              <div style={{ fontSize: 22 }}>{g.icon}</div>
              <span style={{ fontSize: 14, fontWeight: 600, color: sel ? '#CCFF00' : '#888' }}>{g.label}</span>
              {sel && (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                  <circle cx="8" cy="8" r="7" stroke="#CCFF00" strokeWidth="1"/>
                  <path d="M5 8l2 2 4-4" stroke="#CCFF00" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              )}
            </div>
          );
        })}

        {/* Experience */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Training Experience
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {EXPERIENCE.map(e => {
              const sel = form.experience === e.id;
              return (
                <div
                  key={e.id}
                  className="onboarding-tap-sm"
                  onClick={() => set('experience', e.id)}
                  style={{
                    background: sel ? '#111900' : '#0e0e0e',
                    border: `0.5px solid ${sel ? e.color : '#1e1e1e'}`,
                    borderRadius: 12, padding: '10px 10px', cursor: 'pointer',
                    transition: 'transform 0.1s',
                  }}
                >
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: sel ? e.color : '#333', marginBottom: 5 }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: sel ? e.color : '#888' }}>{e.label}</div>
                  <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>{e.sub}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Buttons onNext={onNext} onBack={onBack} label="CONTINUE →" />
    </div>
  );
}

// ── Screen 4: Stats ────────────────────────────────────────────────────────
function StatsScreen({ form, set, onNext, onBack, saving }) {
  return (
    <div style={{ minHeight: '100vh', padding: '52px 20px 40px', display: 'flex', flexDirection: 'column' }}>
      <StepHeader step={3} total={3} label="Initialize Biometrics" sub="Your coach uses this to personalize everything" />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Name */}
        <div>
          <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Your Name</div>
          <div style={{ background: '#0e0e0e', border: '0.5px solid #1e1e1e', borderRadius: 10 }}>
            <input
              type="text" value={form.display_name}
              onChange={e => set('display_name', e.target.value)}
              placeholder="Athlete name"
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, padding: '11px 12px', width: '100%', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Age + Gender */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Age</div>
            <div style={{ background: '#0e0e0e', border: '0.5px solid #1e1e1e', borderRadius: 10 }}>
              <input
                type="number" value={form.age}
                onChange={e => set('age', e.target.value)}
                placeholder="28"
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, padding: '11px 12px', width: '100%', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Gender</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['male', 'M'], ['female', 'F']].map(([v, l]) => (
                <button key={v} className="onboarding-tap-sm" onClick={() => set('gender', v)}
                  style={{
                    flex: 1, padding: '11px 4px', borderRadius: 10, border: '0.5px solid',
                    borderColor: form.gender === v ? '#CCFF00' : '#1e1e1e',
                    background: form.gender === v ? '#111900' : '#0e0e0e',
                    color: form.gender === v ? '#CCFF00' : '#666',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'transform 0.1s',
                  }}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Weight */}
        <UnitInput
          label="Current Weight" value={form.weight} onChange={v => set('weight', v)}
          placeholder={form.weight_unit === 'kg' ? '80' : '176'}
          unit={form.weight_unit} unitOptions={['kg', 'lb']}
          onUnitChange={u => set('weight_unit', u)}
        />

        {/* Height */}
        <UnitInput
          label="Height" value={form.height} onChange={v => set('height', v)}
          placeholder={form.height_unit === 'cm' ? '175' : '69'}
          unit={form.height_unit} unitOptions={['cm', 'in']}
          onUnitChange={u => set('height_unit', u)}
        />

        {/* Injuries */}
        <div>
          <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Injuries / Health Notes <span style={{ color: '#333' }}>(optional)</span>
          </div>
          <textarea
            value={form.injuries} onChange={e => set('injuries', e.target.value)}
            placeholder="e.g. knee pain, back disc — or leave blank"
            rows={2}
            style={{
              width: '100%', background: '#0e0e0e', border: '0.5px solid #1e1e1e',
              borderRadius: 10, color: '#aaa', fontSize: 12, padding: '10px 12px',
              fontFamily: 'inherit', outline: 'none', resize: 'none', lineHeight: 1.6,
            }}
          />
        </div>
      </div>

      <Buttons onNext={onNext} onBack={onBack} label={saving ? 'INITIALIZING...' : "LET'S BUILD YOUR PLAN →"} disabled={saving} />
    </div>
  );
}

// ── Screen 5: Init ─────────────────────────────────────────────────────────
function InitScreen({ done, loadingMessage, generating, dailyCalories }) {
  const caloriesLabel = dailyCalories ? `${dailyCalories} kcal daily target` : 'Personalized daily target';

  return (
    <div className="onboarding-init-overlay">
      {!done ? (
        <div className="onboarding-fade-in" style={{ width: '100%', maxWidth: 320 }}>
          <div
            className="onboarding-init-spinner"
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: '3px solid rgba(255,255,255,0.2)',
              borderTopColor: '#fff',
              margin: '0 auto 32px',
            }}
          />

          <p style={{
            color: '#fff',
            fontSize: 20,
            fontWeight: 700,
            margin: '0 0 12px',
            letterSpacing: '-0.02em',
          }}
          >
            Building your plan...
          </p>

          <p
            key={loadingMessage}
            className="onboarding-msg"
            style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, margin: '0 0 32px' }}
          >
            {loadingMessage}
          </p>

          <div style={{
            width: '100%',
            maxWidth: 280,
            height: 2,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 1,
            margin: '0 auto',
            overflow: 'hidden',
          }}
          >
            <div
              className={`onboarding-init-progress-fill${generating ? ' onboarding-init-progress-fill--active' : ''}`}
              style={generating ? undefined : { width: '100%' }}
            />
          </div>
        </div>
      ) : (
        <div className="onboarding-success" style={{ width: '100%', maxWidth: 340 }}>
          <div
            className="onboarding-check"
            style={{
              width: 88,
              height: 88,
              borderRadius: '50%',
              border: '2px solid #fff',
              margin: '0 auto 28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#111',
            }}
          >
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <path d="M12 22l7 7 13-14" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <h2 style={{
            margin: '0 0 24px',
            fontSize: 26,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            color: '#fff',
          }}
          >
            Your Plan is Ready!
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            <div style={{
              background: '#111',
              border: '0.5px solid #2a2a2a',
              borderRadius: 14,
              padding: '14px 16px',
              textAlign: 'left',
            }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: '#CCFF00', marginBottom: 4 }}>
                Workout Plan
              </div>
              <div style={{ fontSize: 13, color: '#888' }}>
                7-day personalized program
              </div>
            </div>

            <div style={{
              background: '#111',
              border: '0.5px solid #2a2a2a',
              borderRadius: 14,
              padding: '14px 16px',
              textAlign: 'left',
            }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: '#CCFF00', marginBottom: 4 }}>
                Nutrition Plan
              </div>
              <div style={{ fontSize: 13, color: '#888' }}>
                {caloriesLabel}
              </div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
            Taking you home...
          </p>
        </div>
      )}
    </div>
  );
}

// ── Shared Components ──────────────────────────────────────────────────────
function StepHeader({ step, total, label, sub }) {
  return (
    <div style={{ marginBottom: 24 }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: 2, borderRadius: 1,
            background: i < step ? '#CCFF00' : i === step - 1 ? '#CCFF00' : '#1a1a1a',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#CCFF00', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
        Step {step} of {total}
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </h1>
      <p style={{ fontSize: 12, color: '#555' }}>{sub}</p>
    </div>
  );
}

function UnitInput({ label, value, onChange, placeholder, unit, unitOptions, onUnitChange }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', background: '#0e0e0e', border: '0.5px solid #1e1e1e', borderRadius: 10, overflow: 'hidden', alignItems: 'center' }}>
        <input
          type="number" value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, padding: '11px 12px', width: '100%', outline: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', borderLeft: '0.5px solid #1e1e1e' }}>
          {unitOptions.map(u => (
            <button key={u} onClick={() => onUnitChange(u)}
              style={{
                fontSize: 10, padding: '6px 9px', background: 'transparent', border: 'none',
                color: unit === u ? '#CCFF00' : '#444',
                fontWeight: unit === u ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >{u}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Buttons({ onNext, onBack, showBack = true, label = 'CONTINUE →', disabled = false }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
      {showBack && (
        <button className="onboarding-tap" onClick={onBack}
          style={{
            flex: 1, padding: '14px', borderRadius: 14, border: '0.5px solid #1e1e1e',
            background: '#0e0e0e', color: '#666', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'transform 0.1s',
          }}>Back</button>
      )}
      <button className="onboarding-tap" onClick={onNext} disabled={disabled}
        style={{
          flex: 2, padding: '14px', borderRadius: 14, border: 'none',
          background: '#CCFF00', color: '#060608', fontSize: 13, fontWeight: 900,
          cursor: 'pointer', fontFamily: 'inherit', opacity: disabled ? 0.6 : 1,
          letterSpacing: '0.03em', transition: 'transform 0.1s',
        }}>{label}</button>
    </div>
  );
}
