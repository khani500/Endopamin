import { useEffect, useState } from 'react';
import { LifestyleSettings } from '../components/settings/LifestyleSettings';
import { NotificationSettings } from '../components/settings/NotificationSettings';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const DEFAULT_FORM = {
  display_name: '',
  age: '',
  experience: 'intermediate',
  goal: 'strength_gain',
  days_per_week: '4',
  injuries: '',
  gender: 'male',
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

const GENDER_OPTIONS = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['non_binary', 'Non-binary'],
];

export default function ProfilePage() {
  const { user, profile, setProfile } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
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
        injuries: profile?.injuries || '',
        gender: profile?.gender || DEFAULT_FORM.gender,
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
    profile?.injuries,
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
      injuries: form.injuries.trim(),
      gender: form.gender,
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

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-5">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#CCFF00]">Profile</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Athlete settings</h1>
        <p className="mt-2 text-sm text-white/45">Your coach, training plan, and reminders use this profile.</p>
      </header>

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <div className="space-y-4">
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
            label="Gender"
            options={GENDER_OPTIONS}
            value={form.gender}
            onChange={value => updateField('gender', value)}
          />

          <label className="block">
            <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-white/35">
              Injuries or restrictions
            </span>
            <textarea
              value={form.injuries}
              onChange={event => updateField('injuries', event.target.value)}
              placeholder="Shoulder pain, knee history, none..."
              className="min-h-24 w-full rounded-2xl border border-white/10 bg-[#101012] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
            />
          </label>

          <button
            type="button"
            onClick={saveProfile}
            disabled={saving}
            className="w-full rounded-2xl bg-[#CCFF00] px-4 py-4 text-sm font-black text-black disabled:opacity-70"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>

          {status && <p className="text-center text-xs font-bold text-white/50">{status}</p>}
        </div>
      </section>

      <LifestyleSettings />
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

