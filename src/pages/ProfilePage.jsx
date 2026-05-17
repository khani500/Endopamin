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
  injuries: '',
  gender: 'male',
  job_type: 'mixed',
};

const EXPERIENCE_OPTIONS = [
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
];

const GENDER_OPTIONS = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['non_binary', 'Non-binary'],
];

const GOAL_OPTIONS = [
  ['weight_loss', 'Weight Loss'],
  ['strength_gain', 'Strength Gain'],
  ['maintenance', 'Maintenance'],
];

const JOB_TYPE_OPTIONS = [
  ['desk_worker', 'Desk Job'],
  ['active', 'Active Job'],
  ['mixed', 'Mixed'],
];

export default function ProfilePage() {
  const { user, profile, loading, setProfile } = useAuth();
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
    profile?.injuries,
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
      gender: form.gender,
      goal: form.goal,
      days_per_week: Number(form.days_per_week) || null,
      injuries: form.injuries.trim(),
      job_type: form.job_type,
      plan_setup: {
        days_per_week: Number(form.days_per_week) || null,
        goal: form.goal,
        injuries: form.injuries.trim(),
        job_type: form.job_type,
      },
    };

    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      console.error('Profile save failed:', error);
      const fallbackPayload = {
        id: user.id,
        display_name: payload.display_name,
        age: payload.age,
        experience: payload.experience,
        goal: payload.goal,
        days_per_week: payload.days_per_week,
      };
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('profiles')
        .upsert(fallbackPayload, { onConflict: 'id' })
        .select('*')
        .single();

      if (fallbackError) {
        setStatus('Could not save profile. Check Supabase RLS and profile columns.');
      } else {
        setProfile(fallbackData);
        setStatus('Core profile saved. Run the latest migration to save injuries, gender, and job type.');
      }
    } else {
      setProfile(data);
      setStatus('Profile saved.');
    }

    setSaving(false);
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-28 pt-10 text-white">
      <header className="mb-5">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#CCFF00]">Profile</p>
        <h1 className="mt-2 text-3xl font-black uppercase tracking-[-0.04em]">Athlete Settings</h1>
        <p className="mt-2 text-sm text-white/45">One profile for coach guidance, training plans, and reminders.</p>
      </header>

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#CCFF00]">Database & Account</p>
            <h2 className="mt-1 text-lg font-black text-white">Supabase status</h2>
            <p className="mt-2 text-sm leading-6 text-white/45">
              Saved profile data syncs through Supabase when the account session is active.
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
        <div className="space-y-5">
          <TextInput
            label="Display Name"
            value={form.display_name}
            onChange={value => updateField('display_name', value)}
            placeholder="Taher"
          />

          <TextInput
            label="Age"
            type="number"
            value={form.age}
            onChange={value => updateField('age', value)}
            placeholder="48"
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

          <OptionGrid
            label="Goal"
            options={GOAL_OPTIONS}
            value={form.goal}
            onChange={value => updateField('goal', value)}
          />

          <OptionGrid
            label="Days Per Week"
            options={['3', '4', '5', '6'].map(value => [value, value])}
            value={form.days_per_week}
            onChange={value => updateField('days_per_week', value)}
          />

          <TextArea
            label="Injuries / Restrictions"
            value={form.injuries}
            onChange={value => updateField('injuries', value)}
            placeholder="Optional"
          />

          <OptionGrid
            label="Job Type"
            options={JOB_TYPE_OPTIONS}
            value={form.job_type}
            onChange={value => updateField('job_type', value)}
          />

          <button
            type="button"
            onClick={saveProfile}
            disabled={saving || !user}
            className="w-full rounded-2xl bg-[#CCFF00] px-4 py-4 text-sm font-black text-black disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>

          {status && <p className="text-center text-xs font-bold text-white/50">{status}</p>}
        </div>
      </section>

      <section className="mb-5 rounded-3xl border border-white/10 bg-[#141416] p-5">
        <NotificationSettings showDeskBreaks={form.job_type === 'desk_worker'} showGroupSession={false} />
      </section>

      {user && (
        <button
          type="button"
          onClick={() => void signOut()}
          className="w-full rounded-2xl bg-white/[0.06] px-4 py-4 text-sm font-black text-white/60"
        >
          Sign Out
        </button>
      )}
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

function TextArea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-white/35">{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-none rounded-2xl border border-white/10 bg-[#101012] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
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
