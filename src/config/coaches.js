import { COACH_SYSTEM_PROMPTS } from './coachPrompts';

/** Legacy onboarding / profile IDs → current coach IDs */
export const COACH_ID_ALIASES = {
  elias: 'aria',
  rex: 'kane',
  maya: 'blaze',
};

export function resolveCoachId(coachId) {
  const id = String(coachId || DEFAULT_COACH_ID).trim();
  return COACH_ID_ALIASES[id] || id;
}

const COACH_META = {
  aria: {
    name: 'Aria',
    fullName: 'Coach Aria',
    title: 'Science Coach',
    description: 'Data-driven · Precise · Proven',
    avatar: '🧬',
    voiceStyle: 'clinical, precise, evidence-based',
    speechRate: 1.0,
    pitch: 1.0,
    voiceName: 'calm',
    color: '#CCFF00',
  },
  kane: {
    name: 'Kane',
    fullName: 'Coach Kane',
    title: 'Hardcore Trainer',
    description: 'No excuses · Only results',
    avatar: '💀',
    voiceStyle: 'aggressive, direct, intense',
    speechRate: 1.05,
    pitch: 1.15,
    voiceName: 'strict',
    color: '#FFA53C',
  },
  blaze: {
    name: 'Blaze',
    fullName: 'Coach Blaze',
    title: 'Hype Coach',
    description: 'High energy · Push limits',
    avatar: '🔥',
    voiceStyle: 'energetic, fast, celebratory',
    speechRate: 1.15,
    pitch: 1.1,
    voiceName: 'energetic',
    color: '#FF6B6B',
  },
  nova: {
    name: 'Nova',
    fullName: 'Coach Nova',
    title: 'Mindset Coach',
    description: 'Train your mind · Body follows',
    avatar: '🌙',
    voiceStyle: 'calm, measured, mindful',
    speechRate: 0.95,
    pitch: 1.0,
    voiceName: 'calm',
    color: '#A064FF',
  },
  zara: {
    name: 'Zara',
    fullName: 'Coach Zara',
    title: 'Strength Coach',
    description: 'Built different · Trained different',
    avatar: '⚡',
    voiceStyle: 'precise, focused, technical',
    speechRate: 1.05,
    pitch: 1.05,
    voiceName: 'motivational',
    color: '#C084FC',
  },
};

function buildCoachRecord(id) {
  const meta = COACH_META[id] || COACH_META.aria;
  return {
    id,
    ...meta,
    personality: COACH_SYSTEM_PROMPTS[id] || COACH_SYSTEM_PROMPTS.aria,
  };
}

export const COACHES = Object.fromEntries(
  Object.keys(COACH_META).map(id => [id, buildCoachRecord(id)]),
);

export const DEFAULT_COACH_ID = 'aria';

export const getCoach = coachId => {
  const id = resolveCoachId(coachId);
  return COACHES[id] || COACHES[DEFAULT_COACH_ID];
};
