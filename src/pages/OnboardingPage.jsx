import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const GOALS = [
  ['weight_loss', 'Weight Loss'],
  ['strength_gain', 'Strength Gain'],
  ['maintenance', 'Maintenance'],
];

const EXPERIENCE = [
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
];

const COACHES = [
  ['elias', 'Elias', 'Calm coach for steady progress.'],
  ['maya', 'Maya', 'High-energy coach for big momentum.'],
  ['rex', 'Rex', 'Military precision and strict structure.'],
];

export default function OnboardingPage() {
  const { user, setProfile } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    display_name: '',
    age: '',
    gender: 'male',
    goal: 'strength_gain',
    experience: 'beginner',
    days_per_week: '4',
    coach_persona: 'elias',
  });

  const updateField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const saveProfile = async () => {
    if (!user?.id || !supabase) return;
    setSaving(true);
    setError('');

    const payload = {
      id: user.id,
      display_name: form.display_name.trim() || user.email?.split('@')[0] || 'Athlete',
      age: form.age ? Number(form.age) : null,
      gender: form.gender,
      goal: form.goal,
      experience: form.experience,
      days_per_week: Number(form.days_per_week) || null,
      coach_persona: form.coach_persona,
      created_at: new Date().toISOString(),
    };

    const { data, error: saveError } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();

    if (saveError) {
      setError(saveError.message);
    } else {
      setProfile(data);
    }
    setSaving(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-5 py-10 text-white">
      <section className="w-full max-w-[390px] rounded-3xl border border-white/10 bg-[#141416] p-5">
        <div className="mb-5">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#CCFF00]">Step {step} of 3</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#CCFF00]" style={{ width: `${(step / 3) * 100}%` }} />
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">Welcome to DopaPeak</h1>
            <TextInput label="Display name" value={form.display_name} onChange={value => updateField('display_name', value)} />
            <TextInput label="Age" type="number" value={form.age} onChange={value => updateField('age', value)} />
            <OptionRow
              label="Gender"
              options={[
                ['male', 'Male'],
                ['female', 'Female'],
                ['non_binary', 'Non-binary'],
              ]}
              value={form.gender}
              onChange={value => updateField('gender', value)}
            />
            <PrimaryButton onClick={() => setStep(2)}>Continue</PrimaryButton>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">Your Goal</h1>
            <OptionRow label="Goal" options={GOALS} value={form.goal} onChange={value => updateField('goal', value)} />
            <OptionRow label="Experience" options={EXPERIENCE} value={form.experience} onChange={value => updateField('experience', value)} />
            <OptionRow
              label="Days per week"
              options={['3', '4', '5', '6'].map(value => [value, value])}
              value={form.days_per_week}
              onChange={value => updateField('days_per_week', value)}
            />
            <PrimaryButton onClick={() => setStep(3)}>Continue</PrimaryButton>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">Choose Your Coach</h1>
            <div className="space-y-3">
              {COACHES.map(([id, name, desc]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => updateField('coach_persona', id)}
                  className={`w-full rounded-3xl border p-4 text-left ${
                    form.coach_persona === id ? 'border-[#CCFF00] bg-[#CCFF00]/10' : 'border-white/10 bg-[#101012]'
                  }`}
                >
                  <p className="text-base font-black text-white">{name}</p>
                  <p className="mt-1 text-sm text-white/45">{desc}</p>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={saveProfile}
              disabled={saving}
              className="w-full rounded-2xl bg-[#CCFF00] px-4 py-4 text-sm font-black text-black disabled:opacity-60"
            >
              {saving ? 'Saving...' : '← Start Training'}
            </button>
            {error && <p className="text-center text-xs font-bold text-red-300">{error}</p>}
          </div>
        )}
      </section>
    </main>
  );
}

function TextInput({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-white/35">{label}</span>
      <input
        value={value}
        type={type}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-[#101012] px-4 py-3 text-sm text-white outline-none"
      />
    </label>
  );
}

function OptionRow({ label, options, value, onChange }) {
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

function PrimaryButton({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-2xl bg-[#CCFF00] px-4 py-4 text-sm font-black text-black">
      {children}
    </button>
  );
}
