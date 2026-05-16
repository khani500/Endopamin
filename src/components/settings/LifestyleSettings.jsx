import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const JOB_TYPES = [
  { id: 'desk_worker', label: 'Desk Job', emoji: '💻' },
  { id: 'active', label: 'Active Job', emoji: '🏃' },
  { id: 'mixed', label: 'Mixed', emoji: '⚡' },
];

export function LifestyleSettings() {
  const { user, profile, setProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const currentJobType = profile?.job_type || 'mixed';

  const saveJobType = async jobType => {
    if (!user?.id || !supabase) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ job_type: jobType })
      .eq('id', user.id);

    if (!error) {
      setProfile(prev => ({ ...prev, job_type: jobType }));
    }
    setSaving(false);
  };

  if (!user) return null;

  return (
    <section className="mb-5 rounded-2xl border border-white/10 bg-[#111] p-4 text-left">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Lifestyle</h2>
          <p className="mt-1 text-xs text-white/45">Controls Desk Worker Mode and reminders.</p>
        </div>
        {saving && <span className="text-xs font-bold text-[#CCFF00]">Saving...</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {JOB_TYPES.map(option => (
          <button
            key={option.id}
            onClick={() => saveJobType(option.id)}
            className={`rounded-xl p-3 text-center ${
              currentJobType === option.id ? 'bg-[#CCFF00] text-black' : 'bg-[#1a1a1a] text-white'
            }`}
          >
            <div className="mb-1 text-2xl">{option.emoji}</div>
            <div className="text-xs font-medium">{option.label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

