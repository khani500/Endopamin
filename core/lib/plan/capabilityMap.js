/**
 * Capability map — Endopamin
 *
 * What THIS athlete can actually be given, worked out once per plan generation and then
 * consumed by everything downstream.
 *
 * WHY IT EXISTS. The weekly planner used to assign a muscle its quota and only afterwards
 * discover that nothing in the catalog could serve it: measured in S17, 124 of 816 shadow
 * slots resolved to no candidate at all, with `lats` and `middle back` unservable in half
 * of all profiles. Allocating first and resolving second is the architectural gap C28
 * names. This map closes it by making capability an INPUT to allocation.
 *
 * WHAT SERVABLE MEANS. Not "the pattern has candidates". A pattern can be full of movements
 * the athlete may safely perform that do nothing for the muscle the slot was built for —
 * `chest` used to list `vertical_push`, and 30 chest slots resolved to overhead presses
 * contributing zero (C41). Servable means at least one eligible candidate names the
 * requested muscle as PRIMARY. A candidate that names it only as secondary is not enough.
 *
 * WHY PRIMARY AND NOT "ANY CONTRIBUTION". Servable is what makes a muscle's floor a real
 * obligation: an unservable muscle is exempt from its floor, a servable one is chased to
 * it. Measured in home buckets, `lats` was reachable only through horizontal rows, which
 * name it secondary. That made the lats cell servable, so the floor was not waived, so the
 * allocator spent the week adding rows to close a lats deficit at half credit per set and
 * pushed `middle back` — the muscle those rows are actually for — past its target. Half a
 * set of credit is real volume, but it is not a movement for that muscle, and it cannot be
 * the thing that turns a floor into a promise the catalog cannot keep.
 *
 * SECONDARY CONTRIBUTION IS NOT DISCARDED. It counts toward delivered volume everywhere it
 * lands: `servingCandidateIds` and `contributionByCandidate` still hold every candidate
 * that contributes anything, and a row still credits lats 0.5 per set through the
 * contribution vector of the slot it was placed in. What changes is only that such a
 * cell no longer claims it can serve the muscle on purpose. A primary or accessory
 * list holds only candidates with PRIMARY contribution (1.0) to that muscle; a
 * volume-role cap may then drop a record from those lists. Finisher, the pool,
 * servability, and the credit vector are not touched. Secondary credit still counts
 * when the record is placed for its own primary muscle.
 *
 * Two lists are therefore kept: everything the athlete may perform, and the subset that
 * actually trains the muscle. The allocator reads only the second one.
 *
 * WHAT IS DELIBERATELY ABSENT. `usedTodayIds`, `excludeIds`, `recentIds` and
 * `preferEquipment` never enter this map. They are session- or week-local: they change
 * which candidate is finally chosen, never what the athlete is capable of. Folding them in
 * would make the map depend on the order days are built, which is the instability the
 * whole design is meant to avoid. C28.3 applies them when it pins the exercise, choosing
 * from the candidates recorded here.
 *
 * SCOPE. Built per plan generation and thrown away. There is no global cache. The point is
 * a single shared truth between the allocator and the resolver, not speed.
 */

import { getEligibleExercisePool, rankExerciseCandidates } from './exerciseResolver.v2.js';
import { PATTERNS_FOR_MUSCLE, MUSCLES_FOR_PATTERN } from './musclePatternPolicy.js';
import { ALLOWED_TYPES_BY_ROLE } from './roleTypePolicy.js';

export const CAPABILITY_ROLES = Object.freeze(['primary', 'accessory', 'finisher']);

const VOLUME_ROLES = Object.freeze(['primary', 'accessory']);
const VOLUME_TIER_RANK = Object.freeze({ beginner: 1, intermediate: 2, advanced: 3 });

/**
 * Ruling: optional maxPrimaryVolumeTier ('beginner' | 'intermediate' | 'advanced' | 'none').
 * Volume roles drop a record when the athlete tier is above the cap; 'none' never fills
 * a volume role. Finisher is unchanged. Unknown values fail closed.
 */
function allowedForVolumeRole(record, role, athleteTier) {
  const cap = record.maxPrimaryVolumeTier;
  if (cap == null) return true;
  if (cap !== 'none' && VOLUME_TIER_RANK[cap] === undefined) {
    throw new Error(
      'Unknown maxPrimaryVolumeTier ' + JSON.stringify(cap)
        + ' on record ' + (record.id || '(missing id)'),
    );
  }
  if (!VOLUME_ROLES.includes(role)) return true;
  if (cap === 'none') return false;
  return VOLUME_TIER_RANK[athleteTier] <= VOLUME_TIER_RANK[cap];
}

/**
 * What one record is worth to one muscle. Identical rule to muscleContributionFor:
 * primary 1.0, secondary 0.5, neither 0. Kept as a local helper rather than imported
 * because that function takes a slot, and here there is no slot yet.
 */
export function contributionOf(record, muscle) {
  if (!record) return 0;
  if ((record.primaryMuscles || []).includes(muscle)) return 1;
  if ((record.secondaryMuscles || []).includes(muscle)) return 0.5;
  return 0;
}

/**
 * Everything one record trains, not just the muscle a slot asked for.
 *
 * A squat slot built for quadriceps also credits glutes, hamstrings and calves. An
 * allocator that only sees the quadriceps figure will keep feeding the muscles the squat
 * already fed: 58% of the overshoot measured in S17 was spillover of exactly this kind.
 * The vector is recorded per candidate so the allocator can subtract real work from every
 * muscle a movement touches, rather than from the one it was queued for.
 *
 * Same rule as contributionOf: primary 1.0, secondary 0.5. A muscle named in both lists
 * counts once, as primary.
 */
export function contributionVector(record) {
  const out = {};
  if (!record) return out;
  for (const m of record.primaryMuscles || []) out[m] = 1;
  for (const m of record.secondaryMuscles || []) if (out[m] === undefined) out[m] = 0.5;
  return out;
}

/**
 * Build the capability map for one athlete.
 *
 * @param {object} athlete
 * @param {string}   athlete.athleteTier
 * @param {string[]} athlete.availableEquipment
 * @param {string[]} [athlete.injuries]
 * @param {boolean}  [athlete.landingSkillCoached]
 * @param {boolean}  [athlete.allowSupervisionRequired]
 * @param {object} [options]
 * @param {object} [options.patternsForMuscle] defaults to the shared policy map
 * @param {object[]} [options.eligiblePool] when set, used instead of the live registry pool
 * @returns {{muscles: object, generatedFor: object, totals: object}}
 */
export function buildCapabilityMap(athlete, options = {}) {
  const patternsForMuscle = options.patternsForMuscle || PATTERNS_FOR_MUSCLE;
  const injectedPool = Object.prototype.hasOwnProperty.call(options, 'eligiblePool');
  const muscles = {};

  let cells = 0;
  let servableCells = 0;

  for (const muscle of Object.keys(patternsForMuscle)) {
    muscles[muscle] = {};
    for (const pattern of patternsForMuscle[muscle] || []) {
      cells += 1;

      // One eligibility pass. The pool does not depend on role — measured identical across
      // all three roles in 216 of 216 cells — so the search happens once and is ranked three
      // times. No limit is passed anywhere: a truncated pool is a hidden ceiling.
      const request = {
        movementPattern: pattern,
        targetMuscles: MUSCLES_FOR_PATTERN[pattern] || [muscle],
        athleteTier: athlete.athleteTier,
        availableEquipment: athlete.availableEquipment,
        injuries: athlete.injuries || [],
        landingSkillCoached: !!athlete.landingSkillCoached,
        allowSupervisionRequired: !!athlete.allowSupervisionRequired,
        allowedTypes: ALLOWED_TYPES_BY_ROLE.accessory,
        usedTodayIds: [],
        excludeIds: [],
        recentIds: [],
      };

      const { pool, rejected } = injectedPool
        ? { pool: options.eligiblePool, rejected: {} }
        : getEligibleExercisePool(request);
      const serving = pool.filter((rec) => contributionOf(rec, muscle) > 0);
      // Servability is decided by the primary subset alone. `serving` stays the full
      // contributing set, because delivery and reporting count secondary work too.
      const primaryServing = serving.filter((rec) => contributionOf(rec, muscle) === 1);

      // Keyed by id so a consumer that holds only an id — the allocator holds ids, not
      // records — can still see everything that movement trains.
      const contributionByCandidate = {};
      for (const rec of serving) contributionByCandidate[rec.id] = contributionVector(rec);

      const byRole = {};
      for (const role of CAPABILITY_ROLES) {
        // Ruling: optional maxPrimaryVolumeTier. For volume roles (primary,
        // accessory) only, drop a record from this cell's byRole serving list
        // when the athlete tier is above the cap; 'none' means the record never
        // fills a volume role. The finisher role, the eligible pool,
        // primaryServing, cell.servable (3B.1), and all credit vectors stay
        // unchanged. Unknown values throw (fail closed). Tier order:
        // beginner < intermediate < advanced.
        // Ruling: a cell's primary and accessory lists contain ONLY
        // candidates with PRIMARY contribution (1.0) to this cell's muscle.
        // A secondary-only candidate never fills a volume slot for that
        // muscle; its 0.5 credit still counts when the same record is
        // placed for its own primary muscle. Finisher lists, servability
        // (3B.1), maxPrimaryVolumeTier caps, and credit vectors are
        // unchanged. This supersedes the ordering-only ranking fix.
        //
        // The defect: a capped primary (maxPrimaryVolumeTier) can leave a
        // servable cell whose volume lists hold only secondary-only
        // candidates, so the allocator fills the slot at half credit
        // (hamstrings/hinge at intermediate/advanced resolved to Single Leg
        // Glute Bridge). Ordering 1.0 candidates ahead of 0.5 ones still
        // let a secondary-only candidate occupy the slot once every primary
        // was capped out.
        //
        // The primary-before-secondary sort stays. Finisher lists still mix
        // both contributions, and the ruling leaves that order unchanged.
        // Inside a volume list every remaining contribution is 1.0, so the
        // comparator does not reorder those lists.
        const roleServing = serving.filter((rec) =>
          allowedForVolumeRole(rec, role, athlete.athleteTier)
          && (role === 'finisher' || contributionOf(rec, muscle) === 1));
        const ranked = rankExerciseCandidates(roleServing, {
          ...request, role, allowedTypes: ALLOWED_TYPES_BY_ROLE[role],
        }).sort((a, b) => contributionOf(b, muscle) - contributionOf(a, muscle));
        const top = ranked[0] || null;
        byRole[role] = {
          rankedServingIds: ranked.map((r) => r.id),
          topId: top ? top.id : null,
          contribution: top ? contributionOf(top, muscle) : 0,
        };
      }

      // A pool with no serving member is a map problem, not an equipment problem. Reporting
      // it as equipment_gap would send the athlete looking for a dumbbell that would not
      // have helped.
      let gapReason = null;
      if (pool.length === 0) gapReason = 'no_eligible_candidate';
      else if (serving.length === 0) gapReason = 'muscle_pattern_mismatch';
      // Contributing candidates exist, but every one of them names this muscle only as
      // secondary. That is neither an equipment gap nor a mapping error — the pattern does
      // touch the muscle — so it needs its own reason rather than either of theirs.
      else if (primaryServing.length === 0) gapReason = 'no_primary_candidate';

      if (primaryServing.length > 0) servableCells += 1;

      muscles[muscle][pattern] = {
        servable: primaryServing.length > 0,
        eligibleCandidateIds: pool.map((r) => r.id),
        servingCandidateIds: serving.map((r) => r.id),
        totalEligible: pool.length,
        totalServing: serving.length,
        contributionByCandidate,
        byRole,
        gapReason,
        rejectionBreakdown: rejected,
      };
    }
  }

  return {
    muscles,
    generatedFor: {
      athleteTier: athlete.athleteTier,
      availableEquipment: athlete.availableEquipment,
      injuries: athlete.injuries || [],
      landingSkillCoached: !!athlete.landingSkillCoached,
      allowSupervisionRequired: !!athlete.allowSupervisionRequired,
    },
    totals: { cells, servableCells },
  };
}

/**
 * Every pattern that can actually serve this muscle, best contribution first.
 * The allocator uses this instead of reading PATTERNS_FOR_MUSCLE directly, so it can
 * never assign quota to a pattern this athlete cannot use.
 */
export function servablePatternsFor(capability, muscle, role = 'accessory') {
  const entry = capability.muscles[muscle] || {};
  return Object.keys(entry)
    .filter((p) => entry[p].servable)
    .sort((a, b) => (entry[b].byRole[role].contribution - entry[a].byRole[role].contribution)
      || a.localeCompare(b));
}

/** True when no pattern in the map can train this muscle for this athlete. */
export function isMuscleUnservable(capability, muscle) {
  const entry = capability.muscles[muscle] || {};
  return Object.keys(entry).every((p) => !entry[p].servable);
}
