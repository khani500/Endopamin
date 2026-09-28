/**
 * Exercise Resolver v2 — Endopamin  (SHADOW MODE)
 *
 * Turns a structured slot into a ranked shortlist of executable variants. The model never
 * writes an exercise name; it describes what it needs, code searches the whole catalog, and
 * the model picks an id from what comes back.
 *
 * SHADOW MODE: `SHADOW_MODE = true` means every call is fully evaluated and logged, but the
 * caller is expected to discard the result and keep the existing generation path. Flip the
 * flag only after the fixture telemetry has been reviewed.
 *
 * Hard filters are non-negotiable. Soft preferences only affect ordering. Nothing is ever
 * invented: if no variant survives, the resolver relaxes soft constraints once, tries a
 * related pattern once, and then reports a coverage gap with the reason every candidate failed.
 */

import { EXERCISE_REGISTRY } from '../../data/exerciseRegistryIndex.js';

export const SHADOW_MODE = true;

const TIER = { beginner: 1, intermediate: 2, advanced: 3 };

/** Body areas a free-text injury string can name, and the regions they map to. */
const INJURY_AREAS = [
  'shoulder', 'elbow', 'wrist', 'lower back', 'back', 'hip', 'knee', 'ankle', 'neck',
];

const lower = (v) => String(v || '').toLowerCase();

function normalizeInjuries(injuries) {
  if (!injuries) return [];
  const t = (Array.isArray(injuries) ? injuries.join(' ') : String(injuries)).toLowerCase();
  return INJURY_AREAS.filter((a) => t.includes(a));
}

function equipmentSatisfied(ex, availableEquipment) {
  if (availableEquipment == null) return false;
  const have = new Set(availableEquipment.map(lower));
  const needs = (ex.equipment || []).map(lower);
  // Every listed item is a requirement. 'bodyweight' is universally available
  // and is the only token that never needs to be present in the athlete bucket.
  return needs.every((e) => e === 'bodyweight' || have.has(e));
}

/**
 * Hard eligibility. Returns null when the variant is allowed, otherwise a reason code.
 * Reason codes are the telemetry — a coverage gap is only actionable if you know why.
 */
function rejectionReason(ex, req) {
  const {
    availableEquipment = null,
    athleteTier = 'intermediate',
    injuries = [],
    excludeIds = [],
    usedTodayIds = [],
    allowedTypes = null,
    allowSupervisionRequired = false,
  } = req;

  if (usedTodayIds.includes(ex.id)) return 'duplicate_in_session';
  if (excludeIds.includes(ex.id)) return 'excluded_this_week';  // soft — relaxable

  // Eligibility is derived. beginnerSafe is deprecated and deliberately not consulted.
  if ((TIER[ex.minSkillTier] || 2) > (TIER[athleteTier] || 2)) return 'above_skill_tier';
  if (ex.requiresSupervision && !allowSupervisionRequired) return 'requires_supervision';
  if (allowedTypes && !allowedTypes.includes(ex.exerciseType)) return 'type_not_allowed';

  if (!equipmentSatisfied(ex, availableEquipment)) {
    return 'equipment_missing';
  }

  for (const area of injuries) {
    const hit = (ex.contraindicationRules || []).find((r) => r.region === area && r.action === 'exclude');
    if (hit) return `contraindicated:${area}`;
  }

  // Landing skill is a coached prerequisite, not a preference.
  if (ex.landingSkillRequired && !req.landingSkillCoached) return 'landing_skill_not_coached';

  return null;
}

/** Soft ranking. Higher is better. Never excludes. */
function score(ex, req) {
  const {
    targetMuscles = [], role = 'accessory', preferGold = true,
    availableEquipment = null, recentIds = [], preferEquipment = [],
    maxStabilityDemand = null, maxImpact = null,
  } = req;

  let s = 0;
  if (preferGold && ex.tier === 'gold') s += 30;

  const targets = targetMuscles.map(lower);
  if (targets.length) {
    s += (ex.primaryMuscles || []).map(lower).filter((m) => targets.includes(m)).length * 25;
    s += (ex.secondaryMuscles || []).map(lower).filter((m) => targets.includes(m)).length * 8;
  }

  if (role === 'primary') {
    if (ex.mechanic === 'compound') s += 20;
    if (ex.isolation) s -= 15;
  } else if (role === 'accessory' || role === 'finisher') {
    if (ex.isolation) s += 10;
  }

  if (preferEquipment.length) {
    const pref = preferEquipment.map(lower);
    if ((ex.equipment || []).some((e) => pref.includes(lower(e)))) s += 12;
  }

  // With real equipment on hand, a loadable movement progresses more cleanly than bodyweight.
  const loadable = (availableEquipment || []).some((e) => !['bodyweight', 'foam_roller'].includes(lower(e)));
  if (loadable && (ex.equipment || []).every((e) => lower(e) === 'bodyweight')) s -= 14;

  // Stability and impact are preferences here; the hard gate already removed anything unsafe.
  const SD = { low: 1, moderate: 2, high: 3 };
  if (maxStabilityDemand && SD[ex.stabilityDemand] > SD[maxStabilityDemand]) s -= 18;
  const IM = { none: 0, low: 1, moderate: 2, high: 3 };
  if (maxImpact && IM[ex.impactLevel] > IM[maxImpact]) s -= 22;
  if (ex.laterality === 'unilateral' && role === 'primary') s -= 8;

  const recent = recentIds.indexOf(ex.id);
  if (recent === 0) s -= 25;
  else if (recent > 0) s -= 15;

  s += (ex.classification?.confidence || 0) * 10;
  if (ex.hasCues ?? (ex.cues || []).length > 0) s += 5;
  return s;
}

/**
 * Every catalog record this athlete may perform for this request, unranked.
 *
 * This is the hard gate and nothing else: policy exclusion, reviewed scope, skill tier,
 * supervision, allowed types, equipment, contraindications, landing skill, and the two
 * id lists. No scoring, no limit, no truncation. A caller that needs the whole pool —
 * the capability map does — must not have to guess a large `limit` and hope it was
 * large enough.
 *
 * `injuries` is normalized here exactly as searchExercises normalizes it, so calling
 * this directly and calling it through searchExercises cannot diverge.
 *
 * @returns {{pool: Array, rejected: object, inScope: Array, universe: Array, scope: object}}
 */
export function getEligibleExercisePool(req = {}) {
  const base = { ...req, injuries: normalizeInjuries(req.injuries) };
  const pattern = req.movementPattern;

  // Scope is not a rejection. The long tail is deliberately out of the candidate pool while its
  // families are unreviewed; counting it as a rejection buried the real reasons under a 1400-count
  // catch-all. It is reported as a metric instead.
  const patternUniverse = EXERCISE_REGISTRY.filter((e) => e.primaryPattern === pattern);
  const policyExcluded = patternUniverse.filter(isPlanPolicyExcluded);
  const universe = patternUniverse.filter((e) => !isPlanPolicyExcluded(e));
  const inScope = universe.filter((e) => inReviewedScope(e, base));
  const scope = {
    totalCatalog: EXERCISE_REGISTRY.length,
    reviewedCatalog: EXERCISE_REGISTRY.filter((e) => e.primaryFamilyId !== null).length,
    longTailExcluded: EXERCISE_REGISTRY.filter((e) => e.primaryFamilyId === null).length,
    planPolicyExcluded: EXERCISE_REGISTRY.filter(isPlanPolicyExcluded).length,
    patternPolicyExcluded: policyExcluded.length,
    patternUniverse: universe.length,
    patternInScope: inScope.length,
  };

  const rejected = {};
  const pool = [];
  for (const ex of inScope) {
    const why = rejectionReason(ex, base);
    if (why) { rejected[why] = (rejected[why] || 0) + 1; continue; }
    pool.push(ex);
  }
  return { pool, rejected, inScope, universe, scope };
}

/**
 * Order a pool by soft preference. Never removes anything.
 *
 * Ranking is separated from filtering because the pool does not depend on role — measured
 * across 216 muscle/pattern/bucket/tier cells, membership was identical for primary,
 * accessory and finisher in every one, while the ORDER differed in 111 of them. One search
 * followed by three rankings is therefore correct; three searches would repeat the same
 * eligibility work and would make the architecture read as three independent pools.
 *
 * Returns a new array. The input is not mutated.
 */
export function rankExerciseCandidates(candidates, req = {}) {
  return [...candidates].sort((a, b) => score(b, req) - score(a, req));
}

/**
 * Search the catalog for one slot.
 *
 * @param {object} req
 * @param {string}   req.movementPattern
 * @param {string}   [req.familyId]        restrict to one family (used for family queries)
 * @param {string[]} [req.targetMuscles]
 * @param {string[]} [req.availableEquipment]
 * @param {string}   [req.athleteTier]     'beginner' | 'intermediate' | 'advanced'
 * @param {string[]} [req.injuries]
 * @param {string}   [req.role]            'primary' | 'accessory' | 'finisher'
 * @param {string[]} [req.usedTodayIds]
 * @param {string[]} [req.excludeIds]
 * @param {string[]} [req.recentIds]
 * @param {boolean}  [req.allowHybrid]
 * @param {number}   [req.limit]
 * @returns {{status:'ok'|'relaxed'|'coverage_gap', candidates:Array, rejectionBreakdown?:object}}
 */
export function searchExercises(req = {}) {
  const limit = req.limit || 10;
  const base = { ...req, injuries: normalizeInjuries(req.injuries) };
  const pattern = req.movementPattern;

  // Fail closed. A missing type policy is a configuration bug in the pipeline, not a
  // catalog coverage gap, so it is reported once here rather than as 967 identical
  // per-record rejections that would read like a missing catalog.
  if (!Array.isArray(req.allowedTypes) || req.allowedTypes.length === 0) {
    return {
      status: 'gap',
      gapReason: 'policy_scope_gap',
      candidates: [],
      rejectionBreakdown: { missing_type_policy: 1 },
      scope: null,
    };
  }

  const run = (overrides = {}) => {
    const r = { ...req, ...overrides };
    const { pool, rejected } = getEligibleExercisePool(r);
    return { pool: rankExerciseCandidates(pool, { ...r, injuries: normalizeInjuries(r.injuries) }), rejected };
  };
  const scope = getEligibleExercisePool(req).scope;

  let { pool, rejected } = run();
  if (pool.length) {
    return { status: 'ok', pattern, candidates: pool.slice(0, limit), totalEligible: pool.length, rejectionBreakdown: rejected, scope };
  }

  // The ONLY permitted relaxation. excludeIds and recentIds are soft variety preferences
  // and are the only fields cleared here. usedTodayIds is hard and is never relaxed, for
  // the same reason equipment and skill tier are never relaxed: a repeated movement
  // inside one session is not the session that was planned. Skill tier, equipment,
  // contraindications and supervision are also hard and are never relaxed — relaxing
  // any of them would hand an athlete a movement their body or their gym cannot take.
  ({ pool } = run({ excludeIds: [], recentIds: [] }));
  if (pool.length) {
    return {
      status: 'relaxed',
      pattern,
      relaxed: ['excludeIds', 'recentIds'],
      relaxationClass: 'soft_preference_only',
      hardConstraintsRelaxed: [],
      candidates: pool.slice(0, limit),
      totalEligible: pool.length,
      rejectionBreakdown: rejected,
      scope,
    };
  }

  return { ...diagnoseGap(pattern, base, rejected), candidates: [], scope };
}

/**
 * Product-policy gate. Records carrying planPolicy.status 'excluded' are removed from
 * the catalog before scope, scoring or relaxation are considered. This is a product
 * ruling, not an athlete constraint: it can never be relaxed and never re-enters the
 * pool. Kept separate from inReviewedScope so the reason stays legible instead of
 * being folded into policy_scope_gap.
 */
function isPlanPolicyExcluded(ex) {
  return ex.planPolicy?.status === 'excluded';
}

/** Scope test — kept separate from rejection so it never pollutes the reason codes. */
function inReviewedScope(ex, req) {
  if (ex.primaryPattern === null) return false;
  if (ex.primaryFamilyId === null) return false;
  if (ex.classification?.reviewStatus === 'hold_pending_media') return false;
  if (ex.isHybrid && !req.allowHybrid) return false;
  if (ex.resolverDefaultEligible === false && !req.allowHybrid) return false;
  if (req.familyId && ex.primaryFamilyId !== req.familyId) return false;
  return true;
}

/**
 * Work out WHICH stage emptied the pool. A gap is only actionable if the caller can tell an
 * empty catalog apart from a body that cannot do the movement apart from a missing dumbbell.
 *
 *   catalog_coverage_gap    the catalog has no such movement at all
 *   policy_scope_gap        it exists but sits outside the reviewed families or is held
 *   athlete_constraint_block  skill tier, contraindication or supervision removed everything
 *   equipment_gap           only equipment stood in the way
 */
function diagnoseGap(pattern, req, rejected) {
  const universe = EXERCISE_REGISTRY.filter((e) => e.primaryPattern === pattern && !isPlanPolicyExcluded(e));
  if (!universe.length) {
    return { status: 'gap', gapReason: 'catalog_coverage_gap', requestedPattern: pattern, rejectionBreakdown: rejected,
      message: `No record in the catalog carries the pattern "${pattern}".`, resolution: 'extend the catalog' };
  }
  const inScope = universe.filter((e) => inReviewedScope(e, req));
  if (!inScope.length) {
    return { status: 'gap', gapReason: 'policy_scope_gap', requestedPattern: pattern, rejectionBreakdown: rejected,
      message: `"${pattern}" exists in the catalog but every record is outside the reviewed families or held for review.`,
      resolution: 'review the relevant families' };
  }
  const tierOk = inScope.filter((e) => (TIER[e.minSkillTier] || 2) <= (TIER[req.athleteTier || 'intermediate'] || 2));
  const constraintOk = tierOk.filter((e) => {
    if (e.requiresSupervision && !req.allowSupervisionRequired) return false;
    if (e.landingSkillRequired && !req.landingSkillCoached) return false;
    return !(req.injuries || []).some((a) => (e.contraindicationRules || []).some((r) => r.region === a && r.action === 'exclude'));
  });
  if (!constraintOk.length) {
    return { status: 'gap', gapReason: 'athlete_constraint_block', requestedPattern: pattern, rejectionBreakdown: rejected,
      message: `"${pattern}" is blocked for this athlete by skill tier, contraindication or supervision.`,
      resolution: 'omit the slot and restructure the week — never substitute an unrelated movement' };
  }
  // What this athlete can actually perform: in scope, within tier, safe for their
  // injuries, no supervision problem, AND performable with the equipment they own.
  // Equipment is the one filter the stages above deliberately leave out, because
  // equipment is the final fall-through diagnosis. Naming the real set here is what
  // makes same-day exhaustion distinguishable from a genuine equipment gap.
  const eligibleForAthlete = constraintOk.filter((e) => equipmentSatisfied(e, req.availableEquipment));
  const usedTodayIds = req.usedTodayIds || [];
  const unusedToday = eligibleForAthlete.filter((e) => !usedTodayIds.includes(e.id));
  if (eligibleForAthlete.length && usedTodayIds.length && !unusedToday.length) {
    return {
      status: 'gap',
      gapReason: 'session_variety_exhausted',
      internalSignal: 'catalog_depth_gap',
      requestedPattern: pattern,
      rejectionBreakdown: rejected,
      message: `Every available "${pattern}" movement is already in today's session.`,
      resolution: 'give this slot a different pattern for the same muscle, or move it to another day — never suggest equipment',
    };
  }
  return { status: 'gap', gapReason: 'equipment_gap', requestedPattern: pattern, rejectionBreakdown: rejected,
    availableWithEquipment: [...new Set(constraintOk.flatMap((e) => e.equipment || []))].filter((x) => x !== 'bodyweight'),
    message: `"${pattern}" is available to this athlete but not with the equipment they have.`,
    resolution: 'suggest the single cheapest piece of equipment that unlocks the pattern' };
}

/** Compact shape handed to the model: ids and the minimum needed to choose between them. */
export function toCandidateList(result) {
  return (result.candidates || []).map((e) => ({
    id: e.id,
    name: e.name,
    equipment: e.equipment,
    primaryMuscles: e.primaryMuscles,
    isolation: e.isolation,
    laterality: e.laterality,
    minSkillTier: e.minSkillTier,
    defaultPrescription: e.defaultPrescription,
  }));
}

/** Weekly hard sets per muscle. Secondary muscles count half. Mobility never counts. */
export function weeklyHardSets(prescriptions = []) {
  const out = {};
  for (const p of prescriptions) {
    const ex = EXERCISE_REGISTRY.find((e) => e.id === p.exerciseId);
    if (!ex || ex.exerciseType === 'mobility' || ex.primaryPattern === null) continue;
    const sets = Number(p.workingSets ?? p.sets ?? 0) * (p.hardSetEquivalent ?? 1);
    for (const m of ex.primaryMuscles || []) out[m] = (out[m] || 0) + sets;
    for (const m of ex.secondaryMuscles || []) out[m] = (out[m] || 0) + sets * 0.5;
  }
  return out;
}
