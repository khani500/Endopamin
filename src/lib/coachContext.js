import { supabase } from './supabase';
import {
  buildTrainingKnowledgeBlock as buildLocalKnowledgeBlock,
  formatTrainingKnowledgeForPrompt,
} from '../data/trainingKnowledge';
import { buildExerciseLibraryBlock, getExercisesForContext } from '../data/coachExerciseLibrary';

const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

function normalizeLocation(location) {
  const loc = String(location || 'gym').toLowerCase();
  if (loc.includes('desk') || loc.includes('office')) return 'desk';
  if (loc.includes('home')) return 'home';
  return 'gym';
}

function normalizeGoal(goal) {
  const g = String(goal || 'maintenance').toLowerCase();
  if (g.includes('strength') || g.includes('muscle')) return 'strength_gain';
  if (g.includes('weight') || g.includes('fat') || g.includes('loss')) return 'weight_loss';
  return 'maintenance';
}

function scoreKnowledgeRow(row, { env, lvl, goalTag }) {
  let score = 0;
  if (row.environments?.includes(env)) score += 3;
  if (row.goal_tags?.includes(goalTag)) score += 2;
  if (row.levels?.includes(lvl)) score += 2;
  else if (row.levels?.some(l => (LEVEL_RANK[l] ?? 1) <= (LEVEL_RANK[lvl] ?? 1))) score += 1;
  return score;
}

/** Fetch curated knowledge from Supabase; falls back to local JSON. */
export async function fetchTrainingKnowledgeBlock(options = {}) {
  const {
    location = 'gym',
    experience = 'intermediate',
    goal = 'maintenance',
    limit: limitOverride,
  } = options;

  const env = normalizeLocation(location);
  const lvl = String(experience || 'intermediate').toLowerCase().includes('begin')
    ? 'beginner'
    : String(experience || '').toLowerCase().includes('adv')
      ? 'advanced'
      : 'intermediate';
  const goalTag = normalizeGoal(goal);
  const limit = limitOverride ?? (lvl === 'beginner' ? 7 : 5);

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('training_knowledge')
        .select('id, source, topics, environments, levels, goal_tags, summary');

      if (!error && data?.length) {
        const ranked = data
          .map(row => ({ row, score: scoreKnowledgeRow(row, { env, lvl, goalTag }) }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(item => ({
            id: item.row.id,
            source: item.row.source,
            topics: item.row.topics || [],
            summary: item.row.summary,
          }));

        if (ranked.length) {
          return formatTrainingKnowledgeForPrompt(ranked);
        }
      }
    } catch (err) {
      console.warn('Supabase training_knowledge fetch failed, using local JSON:', err);
    }
  }

  return buildLocalKnowledgeBlock({ location, experience: lvl, goal, limit });
}

function isBeginnerExperience(experience) {
  return String(experience || '').toLowerCase().includes('begin');
}

/** Synchronous exercise library block for prompt injection. */
export function buildCoachReferenceContext({
  location = 'gym',
  experience = 'intermediate',
  equipment = [],
  injuries = '',
  goal = 'maintenance',
} = {}) {
  const beginner = isBeginnerExperience(experience);
  const exerciseBlock = buildExerciseLibraryBlock({
    location,
    experience,
    equipment,
    injuries,
    maxPerPattern: beginner ? 3 : 2,
  });

  return exerciseBlock;
}

/** Async version — prefers Supabase knowledge when available. */
export async function buildCoachReferenceContextAsync(options = {}) {
  const exerciseBlock = buildExerciseLibraryBlock({
    location: options.location,
    experience: options.experience,
    equipment: options.equipment,
    injuries: options.injuries,
    maxPerPattern: isBeginnerExperience(options.experience) ? 3 : 2,
  });

  return exerciseBlock;
}

export { getExercisesForContext, buildExerciseLibraryBlock };
