import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { deleteUserAccount } from '../lib/accountDeletion';
import {
  fetchTrainingKnowledgeForOnboarding,
  generateOnboardingNutritionPlan,
  generateOnboardingWorkoutPlan,
  getFallbackNutritionPlan,
  getFallbackWorkoutPlan,
  normalizeAthleteGoal,
} from '../lib/gemini';
import PlanPreviewScreen from '../components/PlanPreviewScreen';

const PROFILE_STORAGE_KEY = 'endopamin_profile';

function avatarUrlStorageKey(userId) {
  return `endopamin_avatar_url_${userId}`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const PLAN_LOADING_PHASES = [
  { until: 3, text: 'Analyzing your profile...' },
  { until: 6, text: 'Applying NASM & NSCA protocols...' },
  { until: 9, text: 'Building your workout plan...' },
  { until: 12, text: 'Calculating your nutrition...' },
  { until: Infinity, text: 'Almost ready...' },
];

function getPlanLoadingMessage(elapsedSec) {
  return PLAN_LOADING_PHASES.find(phase => elapsedSec < phase.until)?.text || 'Almost ready...';
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

function mapGoalForSave(goal) {
  const g = String(goal || '').trim().toLowerCase();
  if (g === 'fat_loss' || g.includes('burn fat') || g.includes('lose weight')) return 'fat_loss';
  if (g === 'muscle' || g === 'muscle_gain' || g.includes('build muscle') || g.includes('gain mass')) {
    return 'muscle_gain';
  }
  if (g === 'endurance' || g.includes('athletic') || g.includes('endurance')) return 'endurance';
  return g || 'fat_loss';
}

function buildAthleteFromProfile(profileRow = {}) {
  const heightCm = toCm(profileRow.height, profileRow.height_unit || 'cm');
  const weightKg = toKg(profileRow.weight, profileRow.weight_unit || 'kg');
  const targetWeightKg = toKg(
    profileRow.target_weight || profileRow.weight,
    profileRow.weight_unit || 'kg',
  );

  return {
    display_name: profileRow.display_name || 'Athlete',
    age: profileRow.age != null ? Number(profileRow.age) : null,
    gender: String(profileRow.gender || 'male').toLowerCase(),
    height_cm: heightCm,
    weight_kg: weightKg ? Math.round(weightKg * 10) / 10 : null,
    target_weight_kg: targetWeightKg ? Math.round(targetWeightKg * 10) / 10 : null,
    bmi: calcBmi(heightCm, weightKg),
    goal: normalizeAthleteGoal(profileRow.goal || 'fat_loss'),
    experience_level: profileRow.experience || 'intermediate',
    activity_level: profileRow.activity || profileRow.activity_level || 'moderate',
    location: profileRow.location || 'gym',
    equipment: profileRow.equipment || 'full_gym',
    days_per_week: profileRow.days_per_week || 4,
    session_duration: profileRow.session_duration || 45,
    injuries: profileRow.injuries || 'none',
    diet: profileRow.diet || 'none',
    coach_persona: profileRow.coach_persona || 'aria',
  };
}

function buildAthleteFromForm(form, profileRow = {}) {
  return buildAthleteFromProfile({
    ...profileRow,
    display_name: form.display_name || profileRow.display_name,
    age: form.age ? Number(form.age) : profileRow.age,
    gender: form.gender || profileRow.gender,
    height: form.height ? Number(form.height) : profileRow.height,
    height_unit: form.height_unit || profileRow.height_unit,
    weight: form.weight ? Number(form.weight) : profileRow.weight,
    weight_unit: form.weight_unit || profileRow.weight_unit,
    target_weight: form.target_weight ? Number(form.target_weight) : profileRow.target_weight,
    goal: form.goal || profileRow.goal,
    experience: form.experience || profileRow.experience,
    activity: form.activity || profileRow.activity,
    location: form.location || profileRow.location,
    equipment: form.equipment || profileRow.equipment,
    session_duration: form.session_duration || profileRow.session_duration,
    injuries: form.injuries ?? profileRow.injuries,
    diet: form.diet || profileRow.diet,
    coach_persona: profileRow.coach_persona || 'aria',
    days_per_week: profileRow.days_per_week || 4,
  });
}

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

const IconBarbell = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="3" y="8.5" width="14" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
    <rect x="1" y="7" width="2.5" height="6" rx="1.25" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="16.5" y="7" width="2.5" height="6" rx="1.25" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);

const IconDumbbell = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="2" y="8" width="3" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="15" y="8" width="3" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M5 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <rect x="4" y="9" width="1.5" height="2" rx="0.4" stroke="currentColor" strokeWidth="1"/>
    <rect x="14.5" y="9" width="1.5" height="2" rx="0.4" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const IconPushup = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="14.5" cy="6" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M12.8 7.2L7 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M7 10.5L4.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M9 9.8L6 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M3 13.5h14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const IconHomeWeights = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 10.5L10 6l7 4.5V16H3v-5.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M8 16v-3.5h4V16" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <rect x="6.5" y="11.5" width="1.2" height="2" rx="0.3" stroke="currentColor" strokeWidth="0.9"/>
    <rect x="12.3" y="11.5" width="1.2" height="2" rx="0.3" stroke="currentColor" strokeWidth="0.9"/>
    <path d="M7.7 12.5h4.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
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

function NumInput({ label, value, onChange, placeholder, unit, unitOptions, onUnitChange, inputMode = 'decimal' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <div style={{ display: 'flex', background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', alignItems: 'center' }}>
        <input
          type="text"
          inputMode={inputMode}
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

function SectionLabel({ children, style = {} }) {
  return (
    <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, marginTop: 16, ...style }}>
      {children}
    </div>
  );
}

function getBmiCategory(bmi) {
  if (bmi < 18.5) {
    return { bmi: Math.round(bmi * 10) / 10, category: 'Underweight', color: '#4DA6FF' };
  }
  if (bmi < 25) {
    return { bmi: Math.round(bmi * 10) / 10, category: 'Normal', color: '#CCFF00' };
  }
  if (bmi < 30) {
    return { bmi: Math.round(bmi * 10) / 10, category: 'Overweight', color: '#FFA53C' };
  }
  return { bmi: Math.round(bmi * 10) / 10, category: 'Obese', color: '#FF4444' };
}

function getBmiFromForm(form) {
  const height = Number(form.height);
  const weight = Number(form.weight);
  if (!height || !weight || height <= 0 || weight <= 0) return null;

  const heightCm = form.height_unit === 'cm' ? height : height * 2.54;
  const weightKg = form.weight_unit === 'kg' ? weight : weight * 0.453592;
  const bmi = weightKg / ((heightCm / 100) * (heightCm / 100));

  return getBmiCategory(bmi);
}

function IconCamera({ size = 11, color = '#CCFF00' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4h6l1.5 3H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5L9 4Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

function ProfileAvatar({ name, user, avatarUrl, onAvatarUrlChange }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const letter = (String(name || 'A').trim().charAt(0) || 'A').toUpperCase();

  const openFilePicker = () => {
    if (!uploading) fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id || !supabase) return;

    setUploading(true);
    try {
      await readFileAsBase64(file);

      const path = `${user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, {
          upsert: true,
          contentType: file.type || 'image/jpeg',
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;

      localStorage.setItem(avatarUrlStorageKey(user.id), publicUrl);
      onAvatarUrlChange(publicUrl);
    } catch (err) {
      console.error('Avatar upload failed:', err);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
      <div
        style={{
          position: 'relative',
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: '#CCFF00',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Profile"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: 28, fontWeight: 900, color: '#000', lineHeight: 1 }}>
            {letter}
          </span>
        )}
        <button
          type="button"
          aria-label="Upload profile photo"
          disabled={uploading}
          onClick={openFilePicker}
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: '#111',
            border: '2px solid #CCFF00',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: uploading ? 'wait' : 'pointer',
            padding: 0,
            fontFamily: 'inherit',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <IconCamera />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
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
  const [loadingMessage, setLoadingMessage] = useState(PLAN_LOADING_PHASES[0].text);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [generatedPlans, setGeneratedPlans] = useState(null);
  const [showPlanPreview, setShowPlanPreview] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const loadingTimerRef = useRef(null);
  const generationStartedRef = useRef(null);
  const pageMountedRef = useRef(true);

  useEffect(() => {
    if (!profile || profileLoaded) return;
    setForm(prev => ({
      ...prev,
      display_name: profile.display_name || '',
      age: profile.age ? String(profile.age) : '',
      gender: profile.gender || 'male',
      height: profile.height ? String(profile.height) : '',
      height_unit: profile.height_unit || 'cm',
      weight: profile.weight ? String(profile.weight) : '',
      weight_unit: profile.weight_unit || 'kg',
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
    setProfileLoaded(true);
  }, [profile, profileLoaded]);

  useEffect(() => () => {
    pageMountedRef.current = false;
    if (loadingTimerRef.current) window.clearInterval(loadingTimerRef.current);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const cached = localStorage.getItem(avatarUrlStorageKey(user.id));
      if (cached) setAvatarUrl(cached);
    } catch (err) {
      console.error('Failed to load cached avatar URL:', err);
    }
  }, [user?.id]);

  const bmiInfo = useMemo(
    () => getBmiFromForm(form),
    [form.height, form.weight, form.height_unit, form.weight_unit],
  );

  const startLoadingTimer = () => {
    generationStartedRef.current = Date.now();
    setLoadingMessage(PLAN_LOADING_PHASES[0].text);
    if (loadingTimerRef.current) window.clearInterval(loadingTimerRef.current);
    loadingTimerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - generationStartedRef.current) / 1000;
      setLoadingMessage(getPlanLoadingMessage(elapsed));
    }, 400);
  };

  const stopLoadingTimer = () => {
    if (loadingTimerRef.current) {
      window.clearInterval(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  };

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
    goal: mapGoalForSave(form.goal),
    activity: form.activity,
    location: form.location,
    equipment: form.equipment,
    experience: form.experience,
    last_workout: form.last_workout,
    session_duration: form.session_duration,
    diet: form.diet,
    injuries: form.injuries,
    coach_persona: profile?.coach_persona || 'aria',
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

  const deleteUserPlans = async () => {
    if (!user?.id || !supabase) return;

    const { error: workoutDeleteError } = await supabase
      .from('workout_plans')
      .delete()
      .eq('user_id', user.id);
    if (workoutDeleteError) {
      console.error('Failed to delete workout plans:', workoutDeleteError);
      throw workoutDeleteError;
    }

    const { error: nutritionDeleteError } = await supabase
      .from('nutrition_plans')
      .delete()
      .eq('user_id', user.id);
    if (nutritionDeleteError) {
      console.error('Failed to delete nutrition plans:', nutritionDeleteError);
      throw nutritionDeleteError;
    }
  };

  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    const confirmed = window.confirm('Are you sure? This will permanently delete your account and all data. This cannot be undone.');
    if (!confirmed) return;

    setDeletingAccount(true);
    try {
      await deleteUserAccount(user.id);
      navigate('/auth', { replace: true });
    } catch (err) {
      window.alert(err?.message || 'Could not delete your account. Please try again.');
    } finally {
      setDeletingAccount(false);
    }
  };

  const generatePlans = async (athlete) => {
    if (!user?.id) return null;

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
      workoutPlan = getFallbackWorkoutPlan(
        coachId,
        athlete.gender,
        athlete.session_duration,
        athlete.equipment,
        athlete.location,
      );
    }

    let nutritionPlan;
    try {
      nutritionPlan = await generateOnboardingNutritionPlan(athlete);
    } catch (err) {
      console.error('Nutrition plan generation failed, using fallback:', err);
      nutritionPlan = getFallbackNutritionPlan(athlete);
    }

    if (!workoutPlan || !nutritionPlan) return null;

    return { workoutPlan, nutritionPlan, coachId, athlete };
  };

  const saveNewPlans = async ({ workoutPlan, nutritionPlan, coachId, athlete }) => {
    if (!user?.id || !supabase) return false;

    const { error: workoutInsertError } = await supabase.from('workout_plans').insert({
      user_id: user.id,
      coach_id: coachId,
      plan_data: { ...workoutPlan, gender: athlete.gender },
      week_start: new Date().toISOString().split('T')[0],
      is_active: true,
    });
    if (workoutInsertError) {
      console.error('Workout plan save failed:', workoutInsertError);
      return false;
    }

    const { error: nutritionInsertError } = await supabase.from('nutrition_plans').insert({
      user_id: user.id,
      plan_data: nutritionPlan,
      is_active: true,
    });
    if (nutritionInsertError) {
      console.error('Nutrition plan save failed:', nutritionInsertError);
      return false;
    }

    return true;
  };

  const buildPlan = async () => {
    if (isLoading) return;

    setPlanError(null);
    setIsLoading(true);
    startLoadingTimer();

    try {
      const athlete = buildAthleteFromForm(form, profile);
      const generated = await generatePlans(athlete);
      if (!pageMountedRef.current) return;

      if (!generated) {
        setPlanError('Could not generate your plans. Your existing plans were kept.');
        return;
      }

      await deleteUserPlans();
      if (!pageMountedRef.current) return;

      const saved = await saveNewPlans(generated);
      if (!pageMountedRef.current) return;

      if (!saved) {
        setPlanError('Plans were generated but could not be saved. Please try again.');
        return;
      }

      await persistProfile();
      localStorage.setItem('onboarding_done', 'true');

      setGeneratedPlans(generated);
      setShowPlanPreview(true);
    } catch (err) {
      console.error('Profile save or plan generation failed:', err);
      if (pageMountedRef.current) {
        setPlanError('Something went wrong. Your existing plans were kept.');
      }
    } finally {
      stopLoadingTimer();
      setIsLoading(false);
    }
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
      <ProfileAvatar
        name={form.display_name}
        user={user}
        avatarUrl={avatarUrl}
        onAvatarUrlChange={setAvatarUrl}
      />

      <SectionLabel style={{ marginTop: 0 }}>Your Name</SectionLabel>
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

      {bmiInfo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', background: '#111', border: '0.5px solid #2a2a2a', borderRadius: 10, padding: '10px 12px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={bmiInfo.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <span style={{ fontSize: 12, color: '#666' }}>BMI</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: bmiInfo.color }}>{bmiInfo.bmi}</span>
          <span style={{ fontSize: 11, color: bmiInfo.color, background: `${bmiInfo.color}18`, border: `1px solid ${bmiInfo.color}33`, borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>{bmiInfo.category}</span>
        </div>
      )}

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
          { id: 'full_gym', label: 'Full Gym', Icon: IconBarbell },
          { id: 'home_basic', label: 'Home Setup', Icon: IconDumbbell },
          { id: 'bodyweight', label: 'Bodyweight', Icon: IconPushup },
          { id: 'home_full', label: 'Home + Weights', Icon: IconHomeWeights },
        ].map(e => {
          const sel = form.equipment === e.id;
          const { Icon } = e;
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
              <span style={{ color: sel ? '#CCFF00' : '#888', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <Icon />
              </span>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
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
          <button
            type="button"
            onClick={handleDeleteAccount}
            disabled={deletingAccount}
            style={{
              background: 'transparent', border: '0.5px solid rgba(255,68,68,0.45)', borderRadius: 10,
              color: 'rgba(255,68,68,0.8)', fontSize: 11, padding: '8px 12px',
              cursor: deletingAccount ? 'wait' : 'pointer', opacity: deletingAccount ? 0.6 : 1,
              fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {deletingAccount ? 'Deleting...' : 'Delete Account'}
          </button>
        </div>
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

      {planError && (
        <p style={{
          marginTop: 16,
          fontSize: 13,
          color: '#FF6B6B',
          textAlign: 'center',
          lineHeight: 1.5,
        }}
        >
          {planError}
        </p>
      )}

      <div style={{ marginTop: 28, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => navigate('/privacy')}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 12,
            color: 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#CCFF00'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}
        >
          Privacy Policy
        </button>
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
                  {loadingMessage}
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {showPlanPreview && generatedPlans && createPortal(
        <PlanPreviewScreen
          coachId={generatedPlans.coachId}
          workoutPlan={generatedPlans.workoutPlan}
          nutritionPlan={generatedPlans.nutritionPlan}
          onComplete={() => setShowPlanPreview(false)}
        />,
        document.body,
      )}
    </main>
  );
}
