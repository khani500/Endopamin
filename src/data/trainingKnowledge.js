/**
 * Curated training-science summaries for coach prompt injection.
 * Paraphrased principles aligned with NSCA, NASM, ACSM, and WHO guidelines —
 * not verbatim copyrighted material.
 */

export const TRAINING_KNOWLEDGE = [
  {
    id: 'nsca_periodization',
    source: 'NSCA',
    topics: ['periodization', 'programming', 'progressive_overload'],
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    goals: ['strength_gain', 'maintenance', 'weight_loss'],
    summary:
      'Use 4 to 6 week mesocycles with planned progression: accumulate volume, then intensity, then deload. Each session should advance a clear variable — load, reps, sets, tempo, or rest — not random exercise swaps.',
  },
  {
    id: 'nsca_rpe_loading',
    source: 'NSCA',
    topics: ['rpe', 'intensity', 'autoregulation'],
    environments: ['gym', 'home'],
    levels: ['intermediate', 'advanced'],
    goals: ['strength_gain', 'maintenance'],
    summary:
      'Prescribe working sets using RPE 6 to 9 or RIR 1 to 3 for intermediates and advanced athletes. Beginners stay RPE 6 to 7 with technique focus. Reduce load when bar speed drops or form breaks — autoregulate within the block.',
  },
  {
    id: 'nasm_opt_progression',
    source: 'NASM',
    topics: ['progression', 'stabilization', 'movement_quality'],
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate'],
    goals: ['weight_loss', 'maintenance', 'strength_gain'],
    summary:
      'Progress stability before load: master posture and range of motion, then add resistance, then power or speed. Beginners need regressions — reduce range, slow tempo, or unilateral support — before advancing to heavy bilateral lifts.',
  },
  {
    id: 'nasm_corrective',
    source: 'NASM',
    topics: ['injury', 'mobility', 'activation'],
    environments: ['gym', 'home', 'desk'],
    levels: ['beginner', 'intermediate', 'advanced'],
    goals: ['maintenance', 'weight_loss', 'strength_gain'],
    summary:
      'Warm-ups should include tissue mobility and activation for the session pattern — hip hinge days need glute and hamstring activation; push days need scapular stability. Substitute movements that aggravate reported injuries.',
  },
  {
    id: 'acsm_volume',
    source: 'ACSM',
    topics: ['volume', 'frequency', 'hypertrophy'],
    environments: ['gym', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    goals: ['weight_loss', 'maintenance', 'strength_gain'],
    summary:
      'Most adults need 150 min moderate or 75 min vigorous activity weekly plus 2 strength sessions. Hypertrophy: 6 to 20 reps per set, 2 to 4 sets, 48 to 72 h recovery per muscle group. Match weekly volume to experience and recovery capacity.',
  },
  {
    id: 'acsm_beginner',
    source: 'ACSM',
    topics: ['beginner', 'safety', 'progression'],
    environments: ['gym', 'home'],
    levels: ['beginner'],
    goals: ['weight_loss', 'maintenance', 'strength_gain'],
    summary:
      'Novices adapt to motor learning first — 2 to 3 full-body sessions weekly, 8 to 15 reps, moderate load. Avoid maximal singles and advanced plyometrics until technique and work capacity are established over 4 to 8 weeks.',
  },
  {
    id: 'acsm_desk_sedentary',
    source: 'ACSM',
    topics: ['desk', 'sedentary', 'mobility', 'neat'],
    environments: ['desk'],
    levels: ['beginner', 'intermediate', 'advanced'],
    goals: ['weight_loss', 'maintenance'],
    summary:
      'Break prolonged sitting every 30 to 60 minutes with 2 to 5 minutes of standing, walking, or mobility. Desk sessions target hip flexors, thoracic spine, posterior chain, and breathing — not high-intensity lifting.',
  },
  {
    id: 'who_activity',
    source: 'WHO',
    topics: ['desk', 'health', 'recovery'],
    environments: ['desk', 'home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    goals: ['weight_loss', 'maintenance'],
    summary:
      'Any movement is better than none — short bouts accumulate. For desk workers, prioritize daily low-intensity activity plus brief strength or mobility snacks. Sleep and stress management are part of the training plan, not optional.',
  },
  {
    id: 'nsca_home_adaptation',
    source: 'NSCA',
    topics: ['home', 'equipment', 'progression'],
    environments: ['home'],
    levels: ['beginner', 'intermediate', 'advanced'],
    goals: ['strength_gain', 'maintenance', 'weight_loss'],
    summary:
      'Home training uses leverage, tempo, pauses, and unilateral work to progress without barbells. Bands and dumbbells enable row, hinge, squat, and push patterns. Track reps and difficulty — not just exercise names.',
  },
  {
    id: 'nsca_strength_peaking',
    source: 'NSCA',
    topics: ['strength', 'periodization', 'loading'],
    environments: ['gym'],
    levels: ['advanced'],
    goals: ['strength_gain'],
    summary:
      'Advanced strength blocks use specific intensities — 70 to 85 percent for volume work, 85 to 95 percent for peaking phases — with planned deloads every 4 to 6 weeks. Accessories support weak links in the competition or primary lifts.',
  },
];

const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

function normalizeGoal(goal) {
  const g = String(goal || 'maintenance').toLowerCase();
  if (g.includes('strength') || g.includes('muscle')) return 'strength_gain';
  if (g.includes('weight') || g.includes('fat') || g.includes('loss')) return 'weight_loss';
  return 'maintenance';
}

function normalizeLocation(location) {
  const loc = String(location || 'gym').toLowerCase();
  if (loc.includes('desk') || loc.includes('office')) return 'desk';
  if (loc.includes('home')) return 'home';
  return 'gym';
}

/** Select the most relevant knowledge entries for prompt injection. */
export function selectTrainingKnowledge({
  location = 'gym',
  experience = 'intermediate',
  goal = 'maintenance',
  limit = 5,
} = {}) {
  const env = normalizeLocation(location);
  const lvl = experience in LEVEL_RANK ? experience : 'intermediate';
  const goalTag = normalizeGoal(goal);
  const athleteRank = LEVEL_RANK[lvl];

  const scored = TRAINING_KNOWLEDGE.map(entry => {
    let score = 0;
    if (entry.environments.includes(env)) score += 3;
    if (entry.goals.includes(goalTag)) score += 2;
    if (entry.levels.includes(lvl)) score += 2;
    else if (entry.levels.some(l => LEVEL_RANK[l] <= athleteRank)) score += 1;
    return { entry, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.entry);
}

export function formatTrainingKnowledgeForPrompt(entries) {
  if (!entries?.length) return '';

  const lines = entries.map(
    entry => `[${entry.source}] ${entry.topics.join(', ')}: ${entry.summary}`,
  );

  return `TRAINING SCIENCE REFERENCE (apply these principles — do not quote as a bibliography):
${lines.join('\n')}`;
}

/** Build knowledge block from local JSON (always available). */
export function buildTrainingKnowledgeBlock(options = {}) {
  const entries = selectTrainingKnowledge(options);
  return formatTrainingKnowledgeForPrompt(entries);
}

/** Map for Supabase seed — same content as TRAINING_KNOWLEDGE. */
export function getTrainingKnowledgeSeedRows() {
  return TRAINING_KNOWLEDGE.map(entry => ({
    id: entry.id,
    source: entry.source,
    topics: entry.topics,
    environments: entry.environments,
    levels: entry.levels,
    goal_tags: entry.goals,
    summary: entry.summary,
  }));
}
