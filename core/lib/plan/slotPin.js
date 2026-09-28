/**
 * Slot pin — Endopamin  (C28.3)
 *
 * Turns "this day needs a quadriceps squat in a primary role" into a real exercise, or
 * says it cannot. Nothing else. It does not decide what to ask for and it does not decide
 * how many sets to give — those belong to the allocator, which calls this and commits the
 * answer before it decides anything further.
 *
 * WHY IT IS SEPARATE. S14 allocated a whole week against hypothetical exercises and only
 * resolved afterwards; planner and builder then chose different movements in 11 of 22
 * slots and the volume ledger was fiction. The allocator now proposes one slot at a time
 * and this function answers with the real record, so the next decision is made against
 * what actually happened rather than against an estimate.
 *
 * WHAT IT MAY NOT DO. It never relaxes a hard constraint. Everything in the capability map
 * already passed equipment, tier, injury, supervision and type gates; this only applies the
 * session-local and week-local rules the map deliberately excludes. Skill tier, equipment
 * and contraindications are not negotiable here or anywhere.
 *
 * C28.3. Week-local preferences are implemented here per the C28.3 ruling. Session-local
 * usedTodayIds remains the only NEVER-relaxed field. excludeIds and recentIds relax only
 * together, and only when excludeIds alone would otherwise empty the pool.
 */

/**
 * Session-local usedTodayIds (never relaxed), then excludeIds (hard until the joint
 * relaxation), then a recentIds reorder that never filters. Mirrors searchExercises:
 * excludeIds is dropped together with recentIds only when clearing them is the sole
 * way to keep a non-empty pool after usedTodayIds. Returns a new array; never mutates
 * ranked or the caller arrays.
 */
function operativePool(ranked, sessionState = {}) {
  const usedTodayIds = sessionState.usedTodayIds || [];
  const excludeIds = sessionState.excludeIds || [];
  const recentIds = sessionState.recentIds || [];

  const afterUsedToday = ranked.filter((id) => !usedTodayIds.includes(id));
  if (afterUsedToday.length === 0) {
    return { exhausted: true, pool: [], relaxed: [] };
  }

  const afterExclude = afterUsedToday.filter((id) => !excludeIds.includes(id));
  if (afterExclude.length === 0) {
    // usedTodayIds left a pool; excludeIds emptied it. Relax both preferences
    // together. The pre-exclude list is returned unchanged — no recentIds reorder.
    return { exhausted: false, pool: afterUsedToday, relaxed: ['excludeIds', 'recentIds'] };
  }

  const notRecent = [];
  const recentMiddle = [];
  const mostRecent = [];
  for (const id of afterExclude) {
    const idx = recentIds.indexOf(id);
    if (idx < 0) notRecent.push(id);
    else if (idx === 0) mostRecent.push(id);
    else recentMiddle.push(id);
  }

  return {
    exhausted: false,
    pool: notRecent.concat(recentMiddle, mostRecent),
    relaxed: [],
  };
}

/**
 * @param {object} proposal          { forMuscle, pattern, role }
 * @param {object} capability        from buildCapabilityMap
 * @param {object} sessionState      { usedTodayIds: string[], excludeIds: string[], recentIds: string[] }
 * @param {object} [options]
 * @param {Map<string,object>} [options.recordsById] id -> record, for callers that already
 *   hold the registry. Omit and the pin returns ids plus the contribution vector the map
 *   recorded, which is all the allocator needs.
 * @returns {{status:'pinned'|'unresolved', exerciseId?, contribution?, reason?, relaxed?}}
 */
export function pinSlot(proposal, capability, sessionState = {}, options = {}) {
  const { forMuscle, pattern, role = 'accessory' } = proposal || {};

  const cell = capability?.muscles?.[forMuscle]?.[pattern];
  if (!cell) {
    return { status: 'unresolved', reason: 'pattern_not_in_capability_map' };
  }
  if (!cell.servable) {
    return { status: 'unresolved', reason: cell.gapReason || 'not_servable' };
  }

  const ranked = cell.byRole?.[role]?.rankedServingIds || [];
  if (!ranked.length) {
    return { status: 'unresolved', reason: 'no_ranked_candidate_for_role' };
  }

  const { exhausted, pool, relaxed } = operativePool(ranked, sessionState);
  if (exhausted) {
    // Every movement this athlete can perform for this muscle and pattern is already in
    // today's session. That is catalog depth, not an equipment problem, and it must never
    // be reported as one. usedTodayIds exhaustion is returned before excludeIds/recentIds
    // relaxation is considered.
    return {
      status: 'unresolved',
      reason: 'session_variety_exhausted',
      exhaustedCount: ranked.length,
    };
  }

  const chosen = pool[0];
  return {
    status: 'pinned',
    exerciseId: chosen,
    record: options.recordsById ? options.recordsById.get(chosen) || null : null,
    // The FULL vector, not just what this movement does for the muscle that asked. An
    // allocator that subtracts only the requested muscle keeps feeding the ones the
    // compound already fed — 58% of the overshoot measured in S17.
    contribution: cell.contributionByCandidate[chosen] || {},
    selfContribution: (cell.contributionByCandidate[chosen] || {})[forMuscle] || 0,
    // rankPosition is always against the raw capability ranking. A recentIds demotion
    // changes which id is chosen first; it must not rewrite where that id sat originally.
    rankPosition: ranked.indexOf(chosen) + 1,
    alternativesRemaining: pool.length - 1,
    relaxed,
  };
}

/**
 * Every exercise that could still fill this proposal today, in the order a caller would
 * draw from. Applies the same usedTodayIds / excludeIds / recentIds steps as pinSlot
 * (same relax condition, same reorder), so a retry that walks this list cannot be handed
 * an id excludeIds was supposed to rule out.
 */
export function remainingCandidatesFor(proposal, capability, sessionState = {}) {
  const { forMuscle, pattern, role = 'accessory' } = proposal || {};
  const cell = capability?.muscles?.[forMuscle]?.[pattern];
  if (!cell || !cell.servable) return [];
  const ranked = cell.byRole?.[role]?.rankedServingIds || [];
  return operativePool(ranked, sessionState).pool;
}
