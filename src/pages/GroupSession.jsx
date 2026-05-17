import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const ACTIVE_SESSIONS = [
  {
    id: 'powerlifting',
    name: 'Powerlifting',
    people: 'Sarah, Mike, + 2 more',
    coach: 'Rex (Military)',
    time: 'Started 12 min ago',
    action: 'Join Now',
    live: true,
  },
  {
    id: 'cardio',
    name: 'Morning Cardio',
    people: 'Team Delta · 4 members',
    coach: 'Maya (Hype)',
    time: 'Tomorrow 7 AM',
    action: 'RSVP',
    live: false,
  },
];

export default function GroupSession() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [form, setForm] = useState({
    name: 'Team Strength',
    workout_type: 'strength',
    schedule: 'now',
    max_members: 6,
    coach_persona: profile?.coach_persona || 'rex',
  });
  const [inviteCode] = useState(() => Math.floor(100000 + Math.random() * 900000).toString());

  const createSession = async () => {
    const payload = {
      code: inviteCode,
      name: form.name,
      workout_type: form.workout_type,
      coach_persona: form.coach_persona,
      host_id: user?.id || null,
      scheduled_at: new Date().toISOString(),
      is_active: form.schedule === 'now',
    };
    if (supabase && user?.id) {
      const { data } = await supabase.from('group_sessions').insert(payload).select('*').single();
      if (data) setActiveSession(data);
    } else {
      setActiveSession(payload);
    }
    setShowCreate(false);
  };

  if (activeSession) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
        <button type="button" onClick={() => setActiveSession(null)} className="mb-5 flex h-8 w-8 items-center justify-center text-gray-400">←</button>
        <h1 className="text-xl font-black uppercase">Live Group Session</h1>
        <p className="mt-1 text-sm text-white/45">Code {activeSession.code}</p>
        <section className="mt-5 rounded-3xl border border-[#CCFF00]/25 bg-[#141416] p-4">
          <p className="text-sm font-black text-[#CCFF00]">Synced Exercise</p>
          <div className="mt-4 text-center">
            <div className="text-6xl">🏋️</div>
            <h2 className="mt-3 text-lg font-black">Bench Press</h2>
            <p className="text-sm text-white/45">Everyone sees this exercise · shared timer 01:42</p>
          </div>
          <div className="mt-4 rounded-2xl bg-black/35 p-3 text-sm text-white/65">Coach: Same cue sent to all members. Brace, breathe, press.</div>
        </section>
        <section className="mt-4 rounded-3xl border border-white/10 bg-[#141416] p-4">
          <p className="text-sm font-black">Group Chat</p>
          <p className="mt-3 rounded-2xl bg-white/[0.06] p-3 text-xs text-white/60">Mike just crushed set 3! 💪</p>
          <input placeholder="Message the team..." className="mt-3 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white outline-none" />
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white">
      <header className="mb-5 flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center text-gray-400">←</button>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#CCFF00]">Group Training</p>
          <h1 className="text-xl font-black">Train Together</h1>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setShowCreate(true)} className="rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black">+ Create Session</button>
        <button type="button" className="rounded-2xl border border-white/10 bg-white/[0.06] py-3 text-sm font-black text-white/70">Join with Code</button>
      </div>

      <section className="rounded-3xl border border-white/10 bg-[#141416] p-4">
        <p className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-white/40">Active Sessions</p>
        <div className="space-y-3">
          {ACTIVE_SESSIONS.map(session => (
            <div key={session.id} className="rounded-2xl bg-black/30 p-4">
              <p className="font-black">{session.live ? '🟢' : '📅'} Session: {session.name}</p>
              <p className="mt-1 text-sm text-white/50">{session.people}</p>
              <p className="text-sm text-white/50">Coach: {session.coach}</p>
              <p className="text-xs text-white/35">{session.time}</p>
              <button type="button" onClick={() => setActiveSession({ ...session, code: inviteCode })} className="mt-3 rounded-xl bg-[#CCFF00] px-4 py-2 text-xs font-black text-black">
                {session.action}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-white/10 bg-[#141416] p-4">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-white/40">My Sessions</p>
        <button type="button" onClick={() => setShowCreate(true)} className="mt-3 w-full rounded-2xl border border-[#CCFF00]/30 bg-[#CCFF00]/10 py-3 text-sm font-black text-[#CCFF00]">
          Create a new group workout
        </button>
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/70">
          <div className="mx-auto w-full max-w-[430px] rounded-t-3xl border border-white/10 bg-[#111] p-4">
            <h2 className="text-lg font-black">Create Session</h2>
            <input value={form.name} onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} className="mt-4 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white outline-none" />
            <select value={form.workout_type} onChange={event => setForm(prev => ({ ...prev, workout_type: event.target.value }))} className="mt-3 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white">
              <option value="strength">Strength</option>
              <option value="cardio">Cardio</option>
              <option value="mobility">Mobility</option>
              <option value="hiit">HIIT</option>
            </select>
            <select value={form.coach_persona} onChange={event => setForm(prev => ({ ...prev, coach_persona: event.target.value }))} className="mt-3 w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white">
              <option value="elias">Elias</option>
              <option value="maya">Maya</option>
              <option value="rex">Rex</option>
            </select>
            <label className="mt-3 block text-xs font-bold text-white/45">
              Max members: {form.max_members}
              <input type="range" min="2" max="20" value={form.max_members} onChange={event => setForm(prev => ({ ...prev, max_members: Number(event.target.value) }))} className="mt-2 w-full" />
            </label>
            <p className="mt-3 text-sm text-white/50">Invite code: <span className="font-black text-[#CCFF00]">{inviteCode}</span></p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-2xl bg-white/[0.06] py-3 text-sm font-black text-white/60">Cancel</button>
              <button type="button" onClick={() => void createSession()} className="rounded-2xl bg-[#CCFF00] py-3 text-sm font-black text-black">Create</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
