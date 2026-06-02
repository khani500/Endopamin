import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const PROFILE_STORAGE_KEY = 'endopamin_profile';
const LOADING_DELAY_MS = 2500;

// ── SVG Icons ──────────────────────────────────────────────────────────────
const IconMale = ({ color = '#888' }) => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <circle cx="14" cy="10" r="5.5" stroke={color} strokeWidth="1.5"/>
    <path d="M14 15.5v8M10 20h8" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconFemale = ({ color = '#888' }) => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <circle cx="14" cy="10" r="5.5" stroke={color} strokeWidth="1.5"/>
    <path d="M14 15.5v8M10 20h8M7 13.5l-3 3M21 13.5l3 3" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconFlame = ({ color = '#888' }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2C10 2 13 6 13 9c0 1.5-1 2.5-1 2.5S14 10.5 14 8c1.5 2 2 4 2 5.5C16 16.5 13.3 18 10 18s-6-1.5-6-4.5C4 10 7 6 10 2Z" stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
    <path d="M10 14c-1.1 0-2-.7-2-1.5C8 11.5 10 10 10 10s2 1.5 2 2.5c0 .8-.9 1.5-2 1.5Z" stroke={color} strokeWidth="1.2"/>
  </svg>
);

const IconMuscle = ({ color = '#888' }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 10h2M15 10h2M5 10c0-2.8 2-5 5-5s5 2.2 5 5-2 5-5 5-5-2.2-5-5Z" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M8 10c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2Z" stroke={color} strokeWidth="1.2"/>
  </svg>
);

const IconTarget = ({ color = '#888' }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke={color} strokeWidth="1.4"/>
    <circle cx="10" cy="10" r="4" stroke={color} strokeWidth="1.2"/>
    <circle cx="10" cy="10" r="1.5" fill={color}/>
    <path d="M10 3V1M10 19v-2M3 10H1M19 10h-2" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const IconClock = ({ color = '#888' }) => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="12" r="7.5" stroke={color} strokeWidth="1.4"/>
    <path d="M11 8v4l2.5 2" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M9 2.5h4" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

const IconLeaf = ({ color = '#888' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 3C7 3 4 5 4 9c0 3 2 5 5 5 2 0 4-1 5-3-1 0-3-.5-4-2C9 7.5 9 4 9 3Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M9 14v2" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const IconNoDairy = ({ color = '#888' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M6 4h6l1.5 4v5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8L6 4Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M3 3l12 12" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const IconGluten = ({ color = '#888' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 3C7.5 5 6 7.5 6 10c0 2 1.3 4 3 4s3-2 3-4c0-2.5-1.5-5-3-7Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M6.5 7.5C5 7 3.5 7.5 3 9M11.5 7.5C13 7 14.5 7.5 15 9" stroke={color} strokeWidth="1.1" strokeLinecap="round"/>
    <path d="M3 3l12 12" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const IconEverything = ({ color = '#888' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="6.5" stroke={color} strokeWidth="1.3"/>
    <path d="M6 9l2 2 4-4" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconStar = ({ color = '#888' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 2l1.8 4.5H15l-3.6 2.7 1.4 4.3L9 11.2l-3.8 2.3 1.4-4.3L3 6.5h4.2L9 2Z" stroke={color} strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
);

const IconTrophy = ({ color = '#888' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M6 3h6v5a3 3 0 0 1-6 0V3Z" stroke={color} strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M6 5H4a2 2 0 0 0 0 4h2M12 5h2a2 2 0 0 0 0 4h-2" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M9 11v3M7 15h4" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const IconLightning = ({ color = '#888' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M11 2L6 10h5l-1 6 6-8h-5l1-6Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);

const IconGym = ({ color = '#888' }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="3" y="8.5" width="14" height="3" rx="1.5" stroke={color} strokeWidth="1.3"/>
    <rect x="1" y="7" width="2.5" height="6" rx="1.25" stroke={color} strokeWidth="1.2"/>
    <rect x="16.5" y="7" width="2.5" height="6" rx="1.25" stroke={color} strokeWidth="1.2"/>
  </svg>
);

const IconHome = ({ color = '#888' }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 9.5L10 3l7 6.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
    <path d="M7 18v-6h6v6" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);

const IconArrow = ({ color = '#0a0a0a' }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M4 9h10M10 5l4 4-4 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconCheck = () => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
    <circle cx="22" cy="22" r="20" stroke="#CCFF00" strokeWidth="1.5"/>
    <path d="M13 22l6 6 12-12" stroke="#CCFF00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ── Reusable Components ────────────────────────────────────────────────────
const cardBase = {
  background: '#111',
  border: '0.5px solid #2a2a2a',
  borderRadius: '12px',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};
const cardSel = {
  borderColor: '#CCFF00',
  background: '#141f00',
};

function SelectCard({ selected, onClick, children, style = {} }) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{ ...cardBase, ...(selected ? cardSel : {}), ...style }}
    >
      {children}
    </motion.div>
  );
}

function NumInput({ label, value, onChange, placeholder, unit, unitOptions, onUnitChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <div style={{ display: 'flex', background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', alignItems: 'center' }}>
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, padding: '10px 10px', width: '100%', outline: 'none', fontFamily: 'inherit' }}
        />
        {unitOptions && (
          <div style={{ display: 'flex', borderLeft: '0.5px solid #2a2a2a' }}>
            {unitOptions.map(u => (
              <button
                key={u}
                onClick={() => onUnitChange(u)}
                style={{
                  fontSize: 10, padding: '6px 8px', background: 'transparent', border: 'none',
                  color: unit === u ? '#CCFF00' : '#444', fontWeight: unit === u ? 700 : 400,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, marginTop: 16 }}>
      {children}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
const STEPS = ['Body Stats', 'Goal & Lifestyle', 'Diet & Health'];

const DEFAULT = {
  display_name: '',
  age: '',
  gender: 'male',
  height: '',
  height_unit: 'cm',
  weight: '',
  weight_unit: 'kg',
  target_weight: '',
  goal: 'fat_loss',
  activity: 'moderate',
  location: 'gym',
  equipment: 'full_gym',
  experience: 'intermediate',
  last_workout: 'this_week',
  session_duration: 45,
  diet: 'none',
  injuries: '',
};

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, setProfile, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(DEFAULT);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!profile || form.display_name) return;
    setForm(prev => ({
      ...prev,
      display_name: profile.display_name || '',
      age: profile.age ? String(profile.age) : '',
      gender: profile.gender || 'male',
      height: profile.height ? String(profile.height) : '',
      weight: profile.weight ? String(profile.weight) : '',
      target_weight: profile.target_weight ? String(profile.target_weight) : '',
      goal: profile.goal || 'fat_loss',
      experience: profile.experience || 'intermediate',
      injuries: profile.injuries || '',
      session_duration: profile.session_duration || 45,
      diet: profile.diet || 'none',
      location: profile.location || 'gym',
      equipment: profile.equipment || 'full_gym',
      activity: profile.activity || 'moderate',
      last_workout: profile.last_workout || 'this_week',
    }));
  }, [profile]);

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const buildPayload = () => ({
    id: user?.id,
    onboarding_completed: true,
    display_name: form.display_name || 'Athlete',
    age: form.age ? Number(form.age) : null,
    gender: form.gender,
    height: form.height ? Number(form.height) : null,
    height_unit: form.height_unit,
    weight: form.weight ? Number(form.weight) : null,
    weight_unit: form.weight_unit,
    target_weight: form.target_weight ? Number(form.target_weight) : null,
    goal: form.goal,
    activity: form.activity,
    location: form.location,
    equipment: form.equipment,
    experience: form.experience,
    last_workout: form.last_workout,
    session_duration: form.session_duration,
    diet: form.diet,
    injuries: form.injuries,
  });

  const persistProfile = async () => {
    const payload = buildPayload();
    let savedProfile = null;

    if (user?.id && supabase) {
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })
        .select('*')
        .single();

      if (error) {
        console.error('Profile save failed:', error);
      } else {
        savedProfile = data;
      }
    }

    const profileData = savedProfile || { ...(profile || {}), ...payload };
    setProfile(profileData);

    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileData));
    } catch (error) {
      console.error('Failed to cache profile locally:', error);
    }

    return profileData;
  };

  const buildPlan = async () => {
    if (isLoading) return;

    setIsLoading(true);

    try {
      await persistProfile();
      localStorage.setItem('onboarding_done', 'true');
    } catch (err) {
      console.error('Profile save failed:', err);
    }

    navigate('/coach', { replace: true });
  };

  const next = async () => {
    if (isLoading) return;
    const payload = buildPayload();
    console.log('[ProfilePage] Continue/save clicked', {
      step,
      isFinalStep: step >= STEPS.length - 1,
      equipment: form.equipment,
      payload,
    });
    if (step < STEPS.length - 1) {
      void persistProfile();
      setStep(s => s + 1);
    } else {
      void buildPlan();
    }
  };
  const back = () => {
    if (isLoading) return;
    setStep(s => s - 1);
  };

  // ── Step 1: Body Stats ───────────────────────────────────────────────────
  const Step1 = (
    <motion.div key="s1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
      {/* Name */}
      <SectionLabel>Your Name</SectionLabel>
      <div style={{ background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 10, overflow: 'hidden' }}>
        <input
          type="text"
          value={form.display_name}
          onChange={e => set('display_name', e.target.value)}
          placeholder="Athlete name"
          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, padding: '11px 12px', width: '100%', outline: 'none', fontFamily: 'inherit' }}
        />
      </div>

      {/* Height + Age */}
      <SectionLabel>Measurements</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <NumInput
          label="Height"
          value={form.height}
          onChange={v => set('height', v)}
          placeholder={form.height_unit === 'cm' ? '175' : '69'}
          unit={form.height_unit}
          unitOptions={['cm', 'in']}
          onUnitChange={u => set('height_unit', u)}
        />
        <NumInput
          label="Age"
          value={form.age}
          onChange={v => set('age', v)}
          placeholder="28"
        />
      </div>

      {/* Weight + Target */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <NumInput
          label="Current Weight"
          value={form.weight}
          onChange={v => set('weight', v)}
          placeholder={form.weight_unit === 'kg' ? '80' : '176'}
          unit={form.weight_unit}
          unitOptions={['kg', 'lb']}
          onUnitChange={u => set('weight_unit', u)}
        />
        <NumInput
          label="Target Weight"
          value={form.target_weight}
          onChange={v => set('target_weight', v)}
          placeholder={form.weight_unit === 'kg' ? '72' : '158'}
          unit={form.weight_unit}
          unitOptions={['kg', 'lb']}
          onUnitChange={u => set('weight_unit', u)}
        />
      </div>

      {/* Gender */}
      <SectionLabel>Gender</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { val: 'male', label: 'Male', Icon: IconMale },
          { val: 'female', label: 'Female', Icon: IconFemale },
        ].map(({ val, label, Icon }) => (
          <SelectCard key={val} selected={form.gender === val} onClick={() => set('gender', val)}
            style={{ padding: '14px 8px', textAlign: 'center' }}>
            <Icon color={form.gender === val ? '#CCFF00' : '#555'} />
            <div style={{ fontSize: 12, color: form.gender === val ? '#CCFF00' : '#666', marginTop: 6 }}>{label}</div>
          </SelectCard>
        ))}
      </div>
    </motion.div>
  );

  // ── Step 2: Goal & Lifestyle ─────────────────────────────────────────────
  const Step2 = (
    <motion.div key="s2" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
      {/* Goal */}
      <SectionLabel>Primary Goal</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[
          { val: 'fat_loss', label: 'Burn Fat & Lose Weight', Icon: IconFlame },
          { val: 'muscle', label: 'Build Muscle & Gain Mass', Icon: IconMuscle },
          { val: 'endurance', label: 'Athletic Endurance & Fitness', Icon: IconTarget },
        ].map(({ val, label, Icon }) => (
          <SelectCard key={val} selected={form.goal === val} onClick={() => set('goal', val)}
            style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon color={form.goal === val ? '#CCFF00' : '#555'} />
            <span style={{ fontSize: 13, color: form.goal === val ? '#CCFF00' : '#888' }}>{label}</span>
          </SelectCard>
        ))}
      </div>

      {/* Training Location */}
      <SectionLabel>Where Do You Train?</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { val: 'gym', label: 'Gym', Icon: IconGym },
          { val: 'home', label: 'Home', Icon: IconHome },
        ].map(({ val, label, Icon }) => (
          <SelectCard key={val} selected={form.location === val} onClick={() => set('location', val)}
            style={{ padding: '14px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon color={form.location === val ? '#CCFF00' : '#555'} />
            <span style={{ fontSize: 13, color: form.location === val ? '#CCFF00' : '#888' }}>{label}</span>
          </SelectCard>
        ))}
      </div>

      <SectionLabel>Available Equipment</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {[
          { id: 'full_gym', label: 'Full Gym', icon: '🏋️' },
          { id: 'home_basic', label: 'Home Setup', icon: '🏠' },
          { id: 'bodyweight', label: 'Bodyweight', icon: '💪' },
          { id: 'home_full', label: 'Home + Weights', icon: '🔧' },
        ].map(e => {
          const sel = form.equipment === e.id;
          return (
            <motion.div
              key={e.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => set('equipment', e.id)}
              style={{
                background: sel ? '#111900' : '#0e0e0e',
                border: `0.5px solid ${sel ? '#CCFF00' : '#1e1e1e'}`,
                borderRadius: 14, padding: '12px 14px',
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 18 }}>{e.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: sel ? '#CCFF00' : '#888' }}>{e.label}</span>
            </motion.div>
          );
        })}
      </div>

      {/* Activity Level */}
      <SectionLabel>Daily Activity Level</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[
          { val: 'sedentary', label: 'Desk Job — mostly sitting' },
          { val: 'moderate', label: 'Moderate — some movement daily' },
          { val: 'active', label: 'Very Active — physical work or daily training' },
        ].map(({ val, label }) => (
          <SelectCard key={val} selected={form.activity === val} onClick={() => set('activity', val)}
            style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: form.activity === val ? '#CCFF00' : '#888' }}>{label}</span>
            {form.activity === val && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#CCFF00" strokeWidth="1.2"/>
                <path d="M5 8l2 2 4-4" stroke="#CCFF00" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            )}
          </SelectCard>
        ))}
      </div>

      {/* Experience */}
      <SectionLabel>Training Experience</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {[
          { val: 'beginner', label: 'Beginner', sub: 'Just starting out', color: '#555', Icon: IconStar },
          { val: 'intermediate', label: 'Intermediate', sub: '6 mo – 2 years', color: '#FFA53C', Icon: IconStar },
          { val: 'advanced', label: 'Advanced', sub: '2+ years', color: '#FF6B6B', Icon: IconTrophy },
          { val: 'athlete', label: 'Athlete', sub: 'Competitive level', color: '#CCFF00', Icon: IconLightning },
        ].map(({ val, label, sub, color, Icon }) => (
          <SelectCard key={val} selected={form.experience === val} onClick={() => set('experience', val)}
            style={{ padding: '11px 10px' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: form.experience === val ? color : '#333', marginBottom: 6 }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: form.experience === val ? color : '#888' }}>{label}</div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{sub}</div>
          </SelectCard>
        ))}
      </div>

      {/* Last Workout */}
      <SectionLabel>Last Time You Trained</SectionLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { val: 'this_week', label: 'This week' },
          { val: 'this_month', label: 'This month' },
          { val: 'months_ago', label: 'Months ago' },
          { val: 'over_a_year', label: '1yr+' },
        ].map(({ val, label }) => (
          <motion.button
            key={val}
            whileTap={{ scale: 0.96 }}
            onClick={() => set('last_workout', val)}
            style={{
              padding: '7px 14px', borderRadius: 20, fontSize: 12, border: '0.5px solid',
              borderColor: form.last_workout === val ? '#CCFF00' : '#2a2a2a',
              background: form.last_workout === val ? '#141f00' : '#111',
              color: form.last_workout === val ? '#CCFF00' : '#666',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {label}
          </motion.button>
        ))}
      </div>

      {/* Session Duration */}
      <SectionLabel>Workout Duration Per Session</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[
          { val: 15, label: '15 min', sub: 'Quick' },
          { val: 30, label: '30 min', sub: 'Standard' },
          { val: 45, label: '45 min', sub: 'Focused' },
          { val: 60, label: '60 min', sub: 'Full' },
        ].map(({ val, label, sub }) => (
          <SelectCard key={val} selected={form.session_duration === val} onClick={() => set('session_duration', val)}
            style={{ padding: '10px 4px', textAlign: 'center' }}>
            <IconClock color={form.session_duration === val ? '#CCFF00' : '#555'} />
            <div style={{ fontSize: 11, fontWeight: 600, color: form.session_duration === val ? '#CCFF00' : '#888', marginTop: 5 }}>{label}</div>
            <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>{sub}</div>
          </SelectCard>
        ))}
      </div>
      {/* 60+ */}
      <SelectCard selected={form.session_duration === 90} onClick={() => set('session_duration', 90)}
        style={{ marginTop: 6, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconClock color={form.session_duration === 90 ? '#CCFF00' : '#555'} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: form.session_duration === 90 ? '#CCFF00' : '#888' }}>60+ min</div>
          <div style={{ fontSize: 10, color: '#444' }}>Beast mode — no limits</div>
        </div>
      </SelectCard>
    </motion.div>
  );

  // ── Step 3: Diet & Health ────────────────────────────────────────────────
  const Step3 = (
    <motion.div key="s3" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
      <SectionLabel>Diet & Food Restrictions</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {[
          { val: 'none', label: 'No restrictions', Icon: IconEverything },
          { val: 'vegetarian', label: 'Vegetarian', Icon: IconLeaf },
          { val: 'no_dairy', label: 'No dairy', Icon: IconNoDairy },
          { val: 'gluten_free', label: 'Gluten free', Icon: IconGluten },
        ].map(({ val, label, Icon }) => (
          <SelectCard key={val} selected={form.diet === val} onClick={() => set('diet', val)}
            style={{ padding: '12px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon color={form.diet === val ? '#CCFF00' : '#555'} />
            <span style={{ fontSize: 12, color: form.diet === val ? '#CCFF00' : '#888' }}>{label}</span>
          </SelectCard>
        ))}
      </div>

      <SectionLabel>Injuries or Health Conditions</SectionLabel>
      <textarea
        value={form.injuries}
        onChange={e => set('injuries', e.target.value)}
        placeholder="e.g. knee pain, lower back disc, shoulder injury — or leave blank"
        rows={3}
        style={{
          width: '100%', background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 10,
          color: '#fff', fontSize: 13, padding: '11px 12px', fontFamily: 'inherit',
          outline: 'none', resize: 'none', lineHeight: 1.6, color: '#aaa',
        }}
      />

      {/* Summary */}
      <div style={{ marginTop: 20, background: '#0d1a00', border: '0.5px solid #2a3a00', borderRadius: 14, padding: 14 }}>
        <div style={{ fontSize: 10, color: '#667a00', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          Your Coach Will Know
        </div>
        {[
          { label: 'Goal', val: form.goal.replace('_', ' ') },
          { label: 'Experience', val: form.experience },
          { label: 'Location', val: form.location },
          { label: 'Session', val: `${form.session_duration === 90 ? '60+' : form.session_duration} min` },
          { label: 'Diet', val: form.diet.replace('_', ' ') || 'no restrictions' },
        ].map(({ label, val }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid #1a2a00' }}>
            <span style={{ fontSize: 12, color: '#555' }}>{label}</span>
            <span style={{ fontSize: 12, color: '#CCFF00', textTransform: 'capitalize' }}>{val}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );

  const steps = [Step1, Step2, Step3];

  return (
    <main style={{ minHeight: '100vh', background: '#0A0A0A', color: '#fff', padding: '52px 20px 110px', fontFamily: 'inherit' }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, color: '#CCFF00', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700 }}>Profile</div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.04em', marginTop: 4, textTransform: 'uppercase' }}>
            Athlete Setup
          </h1>
          <p style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
            Your coach reads this data — no more repeated questions.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => { await signOut(); navigate('/auth', { replace: true }); }}
          style={{
            background: 'transparent', border: '0.5px solid #2a2a2a', borderRadius: 10,
            color: '#555', fontSize: 11, padding: '8px 12px', cursor: 'pointer',
            fontFamily: 'inherit', fontWeight: 600, letterSpacing: '0.05em',
            textTransform: 'uppercase', marginTop: 4,
          }}
        >
          Log out
        </button>
      </div>

      {/* Progress Bar */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 24 }}>
        {STEPS.map((s, i) => (
          <div key={i} style={{ flex: 1 }}>
            <div style={{ height: 3, borderRadius: 2, background: i <= step ? '#CCFF00' : '#222', transition: 'background 0.3s' }} />
            <div style={{ fontSize: 9, color: i === step ? '#CCFF00' : '#444', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Step Content */}
      <AnimatePresence mode="wait">
        {steps[step]}
      </AnimatePresence>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
        {step > 0 && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={back}
            disabled={isLoading}
            style={{
              flex: 1, padding: '15px', borderRadius: 14, border: '0.5px solid #2a2a2a',
              background: '#111', color: '#888', fontSize: 14, fontWeight: 700,
              cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            Back
          </motion.button>
        )}
        <motion.button
          whileTap={{ scale: isLoading ? 1 : 0.97 }}
          onClick={next}
          disabled={isLoading}
          style={{
            flex: 2, padding: '15px', borderRadius: 14, border: 'none',
            background: '#CCFF00',
            color: '#0a0a0a', fontSize: 14, fontWeight: 900,
            cursor: isLoading ? 'wait' : 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          {isLoading
            ? 'Building your plan...'
            : step === STEPS.length - 1
              ? "LET'S BUILD YOUR PLAN"
              : 'Continue'}
          {!isLoading && <IconArrow />}
        </motion.button>
      </div>

      {createPortal(
        <AnimatePresence>
          {isLoading && (
            <motion.div
              key="plan-loading-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(10, 10, 10, 0.96)',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 10 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                style={{
                  width: '100%',
                  maxWidth: 320,
                  background: '#111',
                  border: '0.5px solid #2a2a2a',
                  borderRadius: 20,
                  padding: '32px 24px',
                  textAlign: 'center',
                  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)',
                }}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                  style={{
                    width: 56,
                    height: 56,
                    margin: '0 auto 20px',
                    borderRadius: '50%',
                    border: '3px solid #222',
                    borderTopColor: '#CCFF00',
                  }}
                />
                <motion.p
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: '#CCFF00',
                    letterSpacing: '-0.02em',
                    marginBottom: 8,
                  }}
                >
                  AI is customizing your plan...
                </motion.p>
                <p style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
                  Syncing your stats with your coaches
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </main>
  );
}
