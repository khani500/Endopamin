import { supabase } from './supabase';

const COACH_MEMORY_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function createDefaultCoachMemory() {
  return {
    workoutHistory: [],
    userStats: { level: 'intermediate', equipment: [], injuries: [] },
    preferences: { preferredDays: [], sessionLength: 60 },
    lastSession: null,
  };
}

export function normalizeCoachMemory(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultCoachMemory();
  const defaults = createDefaultCoachMemory();
  return {
    workoutHistory: Array.isArray(raw.workoutHistory) ? raw.workoutHistory.slice(-20) : defaults.workoutHistory,
    userStats: { ...defaults.userStats, ...(raw.userStats || {}) },
    preferences: { ...defaults.preferences, ...(raw.preferences || {}) },
    lastSession: raw.lastSession && typeof raw.lastSession === 'object' ? raw.lastSession : defaults.lastSession,
  };
}

function extractWorkoutHistoryEntry(messages) {
  const assistantText = messages
    .filter(msg => msg.role === 'assistant' && msg.text)
    .map(msg => msg.text)
    .join(' ');

  const prescriptions = [...assistantText.matchAll(/\b(\d+)\s*[x×]\s*(\d+)\s+([a-z][a-z\s-]{2,40})/gi)]
    .map(match => ({
      name: match[3].trim(),
      sets: Number(match[1]),
      reps: Number(match[2]),
      weight: null,
    }));

  const weights = [...assistantText.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:kg|lb|lbs|pounds?)\b/gi)]
    .map(match => match[0]);

  if (prescriptions.length) {
    prescriptions.forEach((entry, index) => {
      entry.weight = weights[index] || null;
    });
  }

  return {
    date: new Date().toISOString(),
    exercises: prescriptions.length
      ? prescriptions.map(entry => entry.name)
      : ['session logged'],
    sets: prescriptions.map(entry => entry.sets),
    reps: prescriptions.map(entry => entry.reps),
    weight: prescriptions.map(entry => entry.weight).filter(Boolean),
  };
}

export function buildCoachMemory(existingMemory, profile, workoutTime, equipment, messages) {
  const base = normalizeCoachMemory(existingMemory);
  const userMessageCount = messages.filter(msg => msg.role === 'user').length;
  const assistantMessages = messages.filter(msg => msg.role === 'assistant' && msg.text);
  const summary = assistantMessages.slice(-3).map(msg => msg.text).join(' ').slice(0, 600);

  const profileEquipment = Array.isArray(profile?.equipment)
    ? profile.equipment
    : (profile?.equipment ? [profile.equipment] : []);

  const injuries = profile?.injuries
    ? (Array.isArray(profile.injuries) ? profile.injuries : [String(profile.injuries)])
    : base.userStats.injuries;

  const preferredDays = profile?.days_per_week
    ? COACH_MEMORY_DAYS.slice(0, Math.min(Number(profile.days_per_week) || 0, 7))
    : base.preferences.preferredDays;

  const memory = {
    ...base,
    userStats: {
      level: profile?.experience || base.userStats.level || 'intermediate',
      equipment: Array.isArray(equipment) && equipment.length ? equipment : (profileEquipment.length ? profileEquipment : base.userStats.equipment),
      injuries,
    },
    preferences: {
      preferredDays,
      sessionLength: workoutTime || Number(profile?.time_available) || base.preferences.sessionLength || 60,
    },
    lastSession: summary
      ? { date: new Date().toISOString(), summary }
      : base.lastSession,
  };

  if (userMessageCount > 0) {
    memory.workoutHistory = [
      ...(base.workoutHistory || []),
      extractWorkoutHistoryEntry(messages),
    ].slice(-20);
  }

  return memory;
}

export async function fetchCoachMemory(userId, coachId) {
  if (!supabase || !userId || !coachId) return createDefaultCoachMemory();

  const { data, error } = await supabase
    .from('coach_memory')
    .select('memory')
    .eq('user_id', userId)
    .eq('coach_id', coachId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to load ${coachId} coach memory:`, error);
    return createDefaultCoachMemory();
  }

  return normalizeCoachMemory(data?.memory);
}

export async function upsertCoachMemory(userId, coachId, memory) {
  if (!supabase || !userId || !coachId) return;

  const { error } = await supabase
    .from('coach_memory')
    .upsert(
      {
        user_id: userId,
        coach_id: coachId,
        memory,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,coach_id' },
    );

  if (error) {
    console.error(`Failed to save ${coachId} coach memory:`, error);
  }
}
