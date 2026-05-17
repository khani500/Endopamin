import { useEffect, useState } from 'react';
import { NotificationSettings } from '../components/settings/NotificationSettings';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import AuthPage from './AuthPage';

const DEFAULT_FORM = {
  display_name: '',
  age: '',
  experience: 'intermediate',
  goal: 'strength_gain',
  days_per_week: '4',
  time_available: '30-45min',
  injuries: '',
  gender: 'male',
  weight_kg: '74.8',
  height_cm: '175',
  weight_unit: 'lb',
  height_unit: 'inch',
  coach_persona: 'elias',
  job_type: 'mixed',
};

const EXPERIENCE_OPTIONS = [
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
];

const GOAL_OPTIONS = [
  ['weight_loss', 'Weight loss'],
  ['strength_gain', 'Strength gain'],
  ['maintenance', 'Maintenance'],
];

const TIME_OPTIONS = [
  ['<30min', '< 30 min'],
  ['30-45min', '30-45 min'],
  ['45-60min', '45-60 min'],
  ['>60min', '> 60 min'],
];

const GENDER_OPTIONS = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['non_binary', 'Non-binary'],
];

const COACH_OPTIONS = [
  ['elias', 'Coach Elias', 'Calm Guide'],
  ['maya', 'Coach Maya', 'Hype Beast'],
  ['rex', 'Coach Rex', 'Military Precision'],
];

const JOB_TYPE_OPTIONS = [
  ['desk_worker', 'Desk Job', '💻'],
  ['active', 'Active Job', '🏃'],
  ['mixed', 'Mixed', '⚡'],
];

const kgToLb = kg => kg * 2.2046226218;
const lbToKg = lb => lb / 2.2046226218;
const cmToIn = cm => cm / 2.54;
const inToCm = inches => inches * 2.54;

export default function ProfilePage() {
  const { user, profile, loading, setProfile } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setForm({
        display_name: profile?.display_name || '',
        age: profile?.age ? String(profile.age) : '',
        experience: profile?.experience || DEFAULT_FORM.experience,
        goal: profile?.goal || DEFAULT_FORM.goal,
        days_per_week: profile?.days_per_week ? String(profile.days_per_week) : DEFAULT_FORM.days_per_week,
        time_available: profile?.time_available || DEFAULT_FORM.time_available,
        injuries: profile?.injuries || '',
        gender: profile?.gender || DEFAULT_FORM.gender,
        weight_kg: profile?.weight_kg ? String(profile.weight_kg) : DEFAULT_FORM.weight_kg,
        height_cm: profile?.height_cm ? String(profile.height_cm) : DEFAULT_FORM.height_cm,
        weight_unit: profile?.weight_unit || DEFAULT_FORM.weight_unit,
        height_unit: profile?.height_unit === 'ft' ? 'inch' : profile?.height_unit || DEFAULT_FORM.height_unit,
        coach_persona: profile?.coach_persona || DEFAULT_FORM.coach_persona,
        job_type: profile?.job_type || DEFAULT_FORM.job_type,
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    profile?.age,
    profile?.days_per_week,
    profile?.display_name,
    profile?.experience,
    profile?.gender,
    profile?.goal,
    profile?.height_cm,
    profile?.height_unit,
    profile?.injuries,
    profile?.time_available,
    profile?.weight_kg,
    profile?.weight_unit,
    profile?.coach_persona,
    profile?.job_type,
  ]);

  const updateField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const saveProfile = async () => {
    if (!user?.id || !supabase) {
      setStatus('Sign in and configure Supabase to save your profile.');
      return;
    }

    setSaving(true);
    setStatus('');

    const payload = {
      id: user.id,
      display_name: form.display_name.trim() || 'Athlete',
      age: form.age ? Number(form.age) : null,
      experience: form.experience,
      goal: form.goal,
      days_per_week: Number(form.days_per_week) || null,
      time_available: form.time_available,
      injuries: form.injuries.trim(),
      gender: form.gender,
      weight_kg: Number(form.weight_kg) || null,
      height_cm: Number(form.height_cm) || null,
      weight_unit: form.weight_unit,
      height_unit: form.height_unit,
      coach_persona: form.coach_persona,
      job_type: form.job_type,
      plan_setup: {
        days_per_week: Number(form.days_per_week) || null,
        time_available: form.time_available,
        goal: form.goal,
      },
    };

    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      console.error('Profile save failed:', error);
      setStatus('Could not save profile. Check Supabase columns and RLS.');
    } else {
      setProfile(data);
      setStatus('Profile saved.');
    }

    setSaving(false);
  };

  const goNext = async () => {
    setStatus('');
    if (step < 3) {
      setStep(prev => prev + 1);
      return;
    }
    await saveProfile();
  };

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-5">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#CCFF00]">Profile</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Athlete settings</h1>
        <p className="mt-2 text-sm text-white/45">Your coach, training plan, and reminders use this profile.</p>
      </header>

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">Database & Account</p>
            <h2 className="mt-1 text-lg font-black text-white">Optional sync settings</h2>
            <p className="mt-2 text-sm leading-6 text-white/45">
              The app works offline-first. Connect Supabase here only when you want auth, saved profile data, and cloud sync.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[10px] font-black ${
            user ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/45'
          }`}
          >
            {user ? 'SIGNED IN' : loading ? 'CHECKING' : 'LOCAL'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold">
          <div className="rounded-2xl bg-black/30 p-3 text-white/55">
            Supabase: <span className={isSupabaseConfigured() ? 'text-[#CCFF00]' : 'text-white/35'}>
              {isSupabaseConfigured() ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <div className="rounded-2xl bg-black/30 p-3 text-white/55">
            Session: <span className={user ? 'text-[#CCFF00]' : 'text-white/35'}>{user ? 'Active' : 'None'}</span>
          </div>
        </div>
      </section>

      {!user && <div className="mb-5"><AuthPage embedded /></div>}

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <div className="mb-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">Step {step} of 3</p>
            <p className="text-xs font-bold text-white/35">
              {step === 1 ? 'Basic info' : step === 2 ? 'Goal and plan' : 'Choose coach'}
            </p>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#CCFF00]" style={{ width: `${(step / 3) * 100}%` }} />
          </div>
        </div>

        <div className="space-y-4">
          {step === 1 && (
            <>
              <TextInput
                label="Display name"
                value={form.display_name}
                onChange={value => updateField('display_name', value)}
                placeholder="Taher"
              />

              <TextInput
                label="Age"
                type="number"
                value={form.age}
                onChange={value => updateField('age', value)}
                placeholder="27"
              />

              <OptionGrid
                label="Experience"
                options={EXPERIENCE_OPTIONS}
                value={form.experience}
                onChange={value => updateField('experience', value)}
              />

              <OptionGrid
                label="Gender"
                options={GENDER_OPTIONS}
                value={form.gender}
                onChange={value => updateField('gender', value)}
              />

              <MeasurementInputs form={form} updateField={updateField} />
            </>
          )}

          {step === 2 && (
            <>
              <OptionGrid
                label="Goal"
                options={GOAL_OPTIONS}
                value={form.goal}
                onChange={value => updateField('goal', value)}
              />

              <OptionGrid
                label="Days per week"
                options={['3', '4', '5', '6'].map(value => [value, value])}
                value={form.days_per_week}
                onChange={value => updateField('days_per_week', value)}
              />

              <OptionGrid
                label="Time available"
                options={TIME_OPTIONS}
                value={form.time_available}
                onChange={value => updateField('time_available', value)}
              />

              <div className="mt-4">
                <p className="mb-3 text-sm font-bold text-white">Your lifestyle:</p>
                <div className="grid grid-cols-3 gap-2">
                  {JOB_TYPE_OPTIONS.map(([id, label, emoji]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateField('job_type', id)}
                      className={`rounded-xl p-3 text-center ${
                        form.job_type === id ? 'bg-[#CCFF00] text-black' : 'bg-[#1a1a1a] text-white'
                      }`}
                    >
                      <div className="mb-1 text-2xl">{emoji}</div>
                      <div className="text-xs font-medium">{label}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {COACH_OPTIONS.map(([id, name, description]) => (
                <div
                  key={id}
                  className={`rounded-3xl border p-4 ${
                    form.coach_persona === id
                      ? 'border-[#CCFF00]/50 bg-[#CCFF00]/10'
                      : 'border-white/10 bg-[#101012]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-black text-white">{name}</h2>
                      <p className="mt-1 text-sm text-white/45">{description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateField('coach_persona', id)}
                      className={`rounded-2xl px-4 py-2 text-xs font-black ${
                        form.coach_persona === id ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/60'
                      }`}
                    >
                      Select
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep(prev => Math.max(1, prev - 1))}
              disabled={step === 1 || saving}
              className="flex-1 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-4 text-sm font-black text-white disabled:opacity-40"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={saving}
              className="flex-1 rounded-2xl bg-[#CCFF00] px-4 py-4 text-sm font-black text-black disabled:opacity-70"
            >
              {saving ? 'Saving...' : 'Next →'}
            </button>
          </div>

          {status && <p className="text-center text-xs font-bold text-white/50">{status}</p>}
        </div>
      </section>

      <NotificationSettings />
    </main>
  );
}

function TextInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-white/35">{label}</span>
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-[#101012] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
      />
    </label>
  );
}

function MeasurementInputs({ form, updateField }) {
  const weightKg = Number(form.weight_kg) || 0;
  const heightCm = Number(form.height_cm) || 0;
  const weightValue = form.weight_unit === 'kg' ? weightKg : kgToLb(weightKg);
  const heightValue = form.height_unit === 'cm' ? heightCm : cmToIn(heightCm);

  const updateWeight = value => {
    const numeric = Number(value);
    if (!value || Number.isNaN(numeric)) {
      updateField('weight_kg', '');
      return;
    }
    updateField('weight_kg', (form.weight_unit === 'kg' ? numeric : lbToKg(numeric)).toFixed(1));
  };

  const updateHeight = value => {
    const numeric = Number(value);
    if (!value || Number.isNaN(numeric)) {
      updateField('height_cm', '');
      return;
    }
    updateField('height_cm', (form.height_unit === 'cm' ? numeric : inToCm(numeric)).toFixed(0));
  };

  return (
    <section className="rounded-3xl border border-[#CCFF00]/20 bg-[#101012] p-4">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">Height & Weight</p>
      <div className="space-y-4">
        <MeasurementField
          label="Weight"
          value={weightValue ? weightValue.toFixed(form.weight_unit === 'kg' ? 1 : 0) : ''}
          unit={form.weight_unit}
          units={['lb', 'kg']}
          onUnitChange={unit => updateField('weight_unit', unit)}
          onChange={updateWeight}
        />
        <MeasurementField
          label="Height"
          value={heightValue ? heightValue.toFixed(form.height_unit === 'cm' ? 0 : 1) : ''}
          unit={form.height_unit}
          units={['inch', 'cm']}
          onUnitChange={unit => updateField('height_unit', unit)}
          onChange={updateHeight}
        />
      </div>
    </section>
  );
}

function MeasurementField({ label, value, unit, units, onUnitChange, onChange }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white/35">{label}</span>
        <div className="flex rounded-full border border-white/10 bg-black/40 p-1">
          {units.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => onUnitChange(item)}
              className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${
                unit === item ? 'bg-[#CCFF00] text-black' : 'text-white/40'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-[#0A0A0A] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
      />
    </label>
  );
}

function OptionGrid({ label, options, value, onChange }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/35">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`rounded-2xl px-2 py-3 text-xs font-black ${
              value === id ? 'bg-[#CCFF00] text-black' : 'bg-white/[0.06] text-white/60'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

