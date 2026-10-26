/** Step 2h: dormant template fitting only. No volume additions, priority slots or repairs.
 * R1 (amends template v3 §5 + D2): protection is a selection priority, not a fit guarantee.
 * Full row prescriptions and the time limit are kept; a protected item that cannot fit is
 * skipped with TIME_BUDGET_SKIP and reported. Nothing is dropped deliberately to lower
 * capacity or lighten requirements. Full/Limited comes only from the final coverage evaluation.
 */
import { validateWeeklyTemplate } from './weeklyTemplateV3.js';
import { resolveSlotCandidates } from './slotEligibility.js';
import { EQUIPMENT_BUCKETS, EQUIPMENT_EXTRA_TOKENS } from './equipmentContract.js';
import { validateResolvedSlot, slotRawSeconds, sessionRawSeconds, canPlaceResolvedSlot } from './resolvedSlotContract.js';
import { coverageCreditForSlot, countWeeklyExposures, evaluateWeeklyCoverage } from './weeklyCoverageV3.js';

const fail = (reason) => ({ ok: false, reason });
const ACC = ['ham_knee_flexion', 'lateral_delts', 'rear_delts', 'calves', 'biceps', 'triceps', 'glutes'];
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const kindOf = (slot) => ({ pattern: slot.pattern, intent: slot.intent,
  ...(slot.accessoryKind === undefined ? {} : { accessoryKind: slot.accessoryKind }) });
const without = (week, dayIndex, slotIndex) => ({ ...week, days: week.days.map((day, i) => i !== dayIndex ? day
  : { ...day, slots: day.slots.filter((_, j) => j !== slotIndex) }) });

// Compare against BEFORE targets: crossing capacity 10 must not erase protection (D2).
function lostRequirements(before, afterCounts) {
  return Object.entries(before.requirements).filter(([key, r]) => r.required
    && afterCounts[key] < r.achieved && afterCounts[key] < r.target).map(([key]) => key);
}

/** Inspectable pure trim policy. Indexes refer to the current week; templateSlotIndex is stable.
 * Rule 4 uses counterfactual qualifying-day counts, not per-exercise or volume credit.
 */
export function rankTemplateTrims(week, { durationMinutes, dayIndex } = {}) {
  const coverage = evaluateWeeklyCoverage(week, { durationMinutes });
  if (!coverage.ok) return coverage;
  if (!Number.isInteger(dayIndex) || !week.days[dayIndex]) return fail('INVALID_DAY_INDEX');
  const entries = [];
  for (const [slotIndex, slot] of week.days[dayIndex].slots.entries()) {
    const valid = validateResolvedSlot(slot);
    if (!valid.ok) return valid;
    if (!Number.isSafeInteger(slot.templateSlotIndex) || slot.templateSlotIndex < 0) return fail('INVALID_TEMPLATE_SLOT_INDEX');
    if (slot.slotKind.intent === 'structural_primary') continue;
    const credit = coverageCreditForSlot(slot);
    if (!credit.ok) return credit;
    const after = countWeeklyExposures(without(week, dayIndex, slotIndex));
    if (!after.ok) return after;
    const requiredCredits = Object.keys(credit.credits).filter((key) => credit.credits[key] && coverage.requirements[key].required);
    const protectedRequirements = lostRequirements(coverage, after.counts);
    const surplus = requiredCredits.length ? Math.min(...requiredCredits.map((key) =>
      coverage.requirements[key].achieved - coverage.requirements[key].target)) : null;
    entries.push({ slotIndex, templateSlotIndex: slot.templateSlotIndex, intent: slot.slotKind.intent,
      requiredCredits, surplus, trimmable: protectedRequirements.length === 0, protectedRequirements,
      // Reverse §5 keep priority. Unneeded CORE is after ACC in keep order.
      trimGroup: slot.slotKind.intent === 'core' ? 0 : slot.slotKind.intent === 'accessory' ? 1 : 2,
      accessoryOrder: ACC.indexOf(slot.slotKind.accessoryKind) });
  }
  entries.sort((a, b) => Number(b.trimmable) - Number(a.trimmable) || a.trimGroup - b.trimGroup
    || (a.intent === 'structural_secondary' && b.intent === 'structural_secondary'
      ? Number(b.surplus === null) - Number(a.surplus === null) || (b.surplus ?? 0) - (a.surplus ?? 0)
      : b.accessoryOrder - a.accessoryOrder)
    || b.templateSlotIndex - a.templateSlotIndex);
  return { ok: true, entries, coverage };
}

/** Codex E: accepted slots in protection order (least protected first) form the OUTER loop and
 * incoming items (the original, then its cheaper credit-keeping alternatives) the INNER loop, so a
 * less-protected slot is always tried with every incoming option before a more-protected slot is
 * touched. `trySwap(current, item)` returns a replacement for `current` that lets `item` fit, or null.
 */
export function firstRoomSwap(acceptedInProtectionOrder, items, trySwap) {
  for (const current of acceptedInProtectionOrder) for (const item of items) {
    const swap = trySwap(current, item);
    if (swap) return { item, current, swap };
  }
  return null;
}

/** Codex C: one bounded, deterministic re-pick on a same-day dead end. The first earlier slot
 * (template order) holding an ID the dead-end slot could use, and having an alternative not on the
 * day, is re-picked (best-ranked alternative); the freed ID goes to the dead-end slot. Null if none.
 */
export function repickForDeadEnd(daySlots, deadEndPool, alternativesForSlot, rank) {
  for (const [index, earlier] of daySlots.entries()) {
    const rescued = deadEndPool.find((slot) => slot.exerciseId === earlier.exerciseId);
    if (!rescued) continue;
    const alternatives = alternativesForSlot(earlier).filter((slot) => !daySlots.some((other) => other.exerciseId === slot.exerciseId));
    if (!alternatives.length) continue;
    return { index, earlier, replacement: rank(alternatives)[0], rescued };
  }
  return null;
}

const DEFICIT_TIERS = ['beginner', 'intermediate', 'advanced'];
const DEFICIT_EQUIPMENT_UNIVERSE = Object.freeze([...new Set([
  ...Object.values(EQUIPMENT_BUCKETS).flat(), ...EQUIPMENT_EXTRA_TOKENS,
])]);

/** Recorded causes retain precedence. Only the residual case uses canonical authored-day capacity.
 * A: credit-capable days in the full equipment universe at any tier; E: days in this context.
 * Counts are helper diagnostics only; callers retain every existing non-reason output field.
 * The caller supplies the validated canonical template, never the allocated/trimmed week.
 */
export function classifyDeficitCause(key, skips, decisions, options = {}) {
  const causes = [
    ...skips.filter((s) => s.creditsLost?.includes(key)).map((s) => ({ type: 'skip', templateId: s.templateId,
      templateSlotIndex: s.templateSlotIndex, exerciseId: s.exerciseId, reason: s.reason })),
    ...decisions.filter((d) => d.creditsLost?.includes(key)).map((d) => ({ type: d.action, templateId: d.templateId,
      templateSlotIndex: d.templateSlotIndex, from: d.from, to: d.to, reason: d.reason })),
  ];
  if (causes.length) return { reason: causes.some((c) => c.type === 'skip') ? 'TIME_BUDGET' : 'SUBSTITUTION_LOST_CREDIT', causes };
  const { template, target, goal, tier, mode, athleteContext, cache = new Map() } = options;
  if (!template || !Array.isArray(template.days) || !Number.isInteger(target) || target < 1
      || !DEFICIT_TIERS.includes(tier) || !['muscle_gain', 'fat_loss', 'endurance'].includes(goal)
      || !['standard', 'short_session'].includes(mode) || !Array.isArray(athleteContext?.availableEquipment))
    throw new Error('INVALID_DEFICIT_CONTEXT');
  const creditKeys = (slotKind, candidateTier, context) => {
    const signature = JSON.stringify([slotKind, goal, mode, candidateTier, context]);
    if (!cache.has(signature)) {
      const pool = resolveSlotCandidates({ slotKind, goal, tier: candidateTier, mode, athleteContext: context });
      if (!pool.ok) throw new Error(pool.reason);
      const keys = new Set();
      for (const candidate of pool.candidates) {
        const credit = coverageCreditForSlot(candidate);
        if (!credit.ok) throw new Error(credit.reason);
        for (const [name, value] of Object.entries(credit.credits)) if (value) keys.add(name);
      }
      cache.set(signature, keys);
    }
    return cache.get(signature);
  };
  const universalContext = { availableEquipment: DEFICIT_EQUIPMENT_UNIVERSE, goal };
  let A = 0; let E = 0;
  for (const day of template.days) {
    const kinds = day.slots.map(kindOf);
    if (kinds.some((kind) => DEFICIT_TIERS.some((candidateTier) => creditKeys(kind, candidateTier, universalContext).has(key)))) A++;
    if (kinds.some((kind) => creditKeys(kind, tier, athleteContext).has(key))) E++;
  }
  return { reason: A < target ? 'NOT_AUTHORED' : E < target ? 'CONTENT_GAP' : 'NOT_PLACED', causes, A, E, t: target };
}

/** Tie-break: earns any still-unmet required credit, qualifying structural credit, count of unmet required credits,
 * unused ID earlier this week, not recent, then code-point ID. No name/mechanic inference.
 * A variation preference never outranks eligibility or required coverage. Cheaper eligible
 * alternatives are tried before a budget skip; all replacements keep authored intent.
 */
export function allocateTemplateWeek(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_INPUT');
  const { template, athleteContext, daysPerWeek, durationMinutes, goal, tier, recentIds = [] } = input;
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 2 || daysPerWeek > 6) return fail('INVALID_DAYS_PER_WEEK');
  if (!['muscle_gain', 'fat_loss', 'endurance'].includes(goal)) return fail('INVALID_GOAL');
  if (!['beginner', 'intermediate', 'advanced'].includes(tier)) return fail('INVALID_TIER');
  if (!athleteContext || !Array.isArray(athleteContext.availableEquipment)
      || athleteContext.availableEquipment.some((token) => typeof token !== 'string' || !token)) return fail('INVALID_EQUIPMENT_CONTEXT');
  if (athleteContext.goal !== undefined && athleteContext.goal !== goal) return fail('GOAL_CONTEXT_MISMATCH');
  if (athleteContext.athleteTier !== undefined && athleteContext.athleteTier !== tier) return fail('TIER_CONTEXT_MISMATCH');
  if (!Array.isArray(recentIds) || recentIds.some((id) => typeof id !== 'string' || !id)) return fail('INVALID_RECENT_IDS');
  if (template?.ok === true && durationMinutes !== template.durationMinutes) return fail('DURATION_CONTEXT_MISMATCH');
  const valid = validateWeeklyTemplate(template, { daysPerWeek, durationMinutes, tier,
    equipmentContext: { ...athleteContext, goal } });
  if (!valid.ok) return valid;
  const mode = durationMinutes === 15 ? 'short_session' : 'standard';
  const short = mode === 'short_session';
  const week = { durationMinutes, tier, equipmentContext: { ...athleteContext, goal }, split: template.split,
    days: template.days.map((day) => ({ ...day, slots: [] })) };
  const skips = [];
  const decisions = [];
  const poolCache = new Map();
  const executabilityCache = input.executabilityCache === undefined ? new Map() : input.executabilityCache;
  let coverage;
  const refresh = () => {
    for (const day of week.days) {
      day.rawSeconds = sessionRawSeconds(day, durationMinutes);
      if (typeof day.rawSeconds !== 'number') throw new Error(day.rawSeconds.reason);
    }
    coverage = evaluateWeeklyCoverage(week, { durationMinutes, executabilityCache });
    if (!coverage.ok) throw new Error(coverage.reason);
  };
  const materialize = (candidate, authored, templateSlotIndex) => ({ ...authored, ...candidate,
    slotKind: kindOf(authored), sets: candidate.resolvedPrescription.sets.min, mode,
    source: 'base_template', templateSlotIndex });
  const poolFor = (authored, templateSlotIndex) => {
    const slotKind = kindOf(authored); const key = JSON.stringify(slotKind);
    if (!poolCache.has(key)) {
      const result = resolveSlotCandidates({ slotKind, goal, tier, mode, athleteContext: week.equipmentContext,
        timingCheck: (p) => validateResolvedSlot({ slotKind, exerciseId: p.exerciseId, resolvedPrescription: p, sets: p.sets.min, mode }) });
      if (!result.ok) throw new Error(result.reason);
      poolCache.set(key, result.candidates);
    }
    return poolCache.get(key).map((candidate) => materialize(candidate, authored, templateSlotIndex));
  };
  // Slot-level history only; it never decides Full/Limited (R2.4).
  const marker = (day, slot, reason, details = {}) => {
    skips.push({ templateId: day.templateId, templateSlotIndex: slot.templateSlotIndex,
      slotKind: slot.slotKind, ...(slot.exerciseId ? { exerciseId: slot.exerciseId } : {}), reason, ...details });
  };
  const creditCache = new Map();
  const credits = (slot) => {
    const cacheKey = slot.exerciseId + '|' + JSON.stringify(slot.slotKind) + '|' + slot.resolvedPrescription?.prescriptionRole;
    if (!creditCache.has(cacheKey)) {
      const credit = coverageCreditForSlot(slot);
      if (!credit.ok) throw new Error(credit.reason);
      creditCache.set(cacheKey, credit.credits);
    }
    return creditCache.get(cacheKey);
  };
  const creditKeys = (slot) => { const c = credits(slot); return Object.keys(c).filter((k) => c[k]); };
  const exposed = (slots) => { const keys = new Set(); for (const s of slots) for (const k of creditKeys(s)) keys.add(k); return keys; };
  // Every coverage key starts at 0: an absent key must compare as zero, never as undefined.
  const countsOf = (sets) => { const counts = Object.fromEntries(Object.keys(coverage.requirements).map((k) => [k, 0])); for (const set of sets) for (const k of set) counts[k] = (counts[k] || 0) + 1; return counts; };
  const insertInOrder = (slots, slot) => { const at = slots.findIndex((s) => s.templateSlotIndex > slot.templateSlotIndex);
    if (at < 0) slots.push(slot); else slots.splice(at, 0, slot); };
  // R-D/§15: protection always uses the STANDARD regime (never the provisional reduced one); 15-minute
  // weeks always use their approved reduced regime. Executability is week-independent (weeklyCoverageV3).
  let standard = null;
  const STRUCTURAL = ['SQ', 'HG', 'LU', 'HPU', 'HPL', 'VPU', 'VPL'];
  const referenceTargets = () => {
    if (short) return Object.fromEntries(Object.entries(coverage.requirements).map(([k, r]) => [k, { required: r.required, target: r.target }]));
    if (!standard) {
      const days = template.days.length; const exec = (k) => coverage.requirements[k].executable;
      const req = (target, whenExecutable, k) => ({ required: target > 0 && (!whenExecutable || exec(k)), target });
      standard = { knee: req(days === 2 ? 1 : 2, false), hinge: req(days === 2 ? 1 : 2, false), push: req(2, false), pull: req(2, false),
        hamstring_primary: req(1, true, 'hamstring_primary'), CORE: req(days >= 3 ? 2 : 1, true, 'CORE'),
        lateral_delts: req(1, true, 'lateral_delts'), rear_delts: req(1, true, 'rear_delts') };
      for (const pattern of STRUCTURAL) standard[pattern] = req(1, true, pattern);
    }
    return standard;
  };
  const substitute = (dayIndex, from, to, reason, details = {}) => decisions.push({ action: 'substitute', templateId: week.days[dayIndex].templateId,
    templateSlotIndex: from.templateSlotIndex, from: from.exerciseId, to: to.exerciseId, reason,
    creditsLost: creditKeys(from).filter((k) => !credits(to)[k]), ...details });
  try {
    refresh();
    // Selection in template order, with a complete provisional week for counterfactuals.
    for (const [dayIndex, day] of week.days.entries()) {
      const authoredSlots = template.days[dayIndex].slots;
      const usedWeek = new Set(week.days.slice(0, dayIndex).flatMap((d) => d.slots.map((slot) => slot.exerciseId)));
      const rank = (list) => {
        const targets = referenceTargets(); const counts = coverage.exposures.counts; const dayExposure = exposed(day.slots);
        const scores = new Map();
        const score = (slot) => {
          if (scores.has(slot)) return scores.get(slot);
          const credit = credits(slot);
          // R-B (Codex B): credit-aware score = actual increase in DAY-counted coverage; a credit
          // the day already holds earns 0. Eligibility, beginner access and fit are never overridden.
          const gain = Object.entries(targets).filter(([key, r]) => r.required && counts[key] < r.target
            && credit[key] && !dayExposure.has(key)).length;
          const value = [Number(gain > 0), Number(Boolean(credit[slot.slotKind.pattern])), gain,
            Number(!usedWeek.has(slot.exerciseId)), Number(!recentIds.includes(slot.exerciseId))];
          scores.set(slot, value);
          return value;
        };
        return [...list].sort((a, b) => {
          const x = score(a); const y = score(b);
          for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
          return compareId(a.exerciseId, b.exerciseId);
        });
      };
      for (const [templateSlotIndex, authored] of authoredSlots.entries()) {
        const usedDay = new Set(day.slots.map((slot) => slot.exerciseId));
        let candidates = poolFor(authored, templateSlotIndex).filter((slot) => !usedDay.has(slot.exerciseId));
        // Codex C: never consume the only remaining eligible candidate of a later slot on this day.
        const reserved = new Set();
        for (let j = templateSlotIndex + 1; j < authoredSlots.length; j++) {
          const later = poolFor(authoredSlots[j], j).filter((slot) => !usedDay.has(slot.exerciseId));
          if (later.length === 1) reserved.add(later[0].exerciseId);
        }
        const unreserved = candidates.filter((slot) => !reserved.has(slot.exerciseId));
        if (unreserved.length) candidates = unreserved;
        if (candidates.length) { day.slots.push(rank(candidates)[0]); refresh(); continue; }
        const pool = poolFor(authored, templateSlotIndex);
        // Codex C: one bounded, deterministic re-pick of an earlier slot on a same-day dead end.
        const repick = pool.length ? repickForDeadEnd(day.slots, pool,
          (earlier) => poolFor(authoredSlots[earlier.templateSlotIndex], earlier.templateSlotIndex), rank) : null;
        if (repick) {
          const { index, earlier, replacement } = repick;
          day.slots[index] = replacement;
          decisions.push({ action: 'repick', templateId: day.templateId, templateSlotIndex: earlier.templateSlotIndex,
            from: earlier.exerciseId, to: replacement.exerciseId, reason: 'SAME_DAY_DEAD_END',
            forTemplateSlotIndex: templateSlotIndex, creditsLost: creditKeys(earlier).filter((k) => !credits(replacement)[k]) });
          day.slots.push(repick.rescued);
        } else marker(day, { slotKind: kindOf(authored), templateSlotIndex }, pool.length ? 'SAME_DAY_ID_DEPTH_EXHAUSTED' : 'NO_EXECUTABLE_SLOT_CANDIDATE');
        refresh();
      }
    }

    // R2.1: selected candidates stay separate from accepted (fitted) slots.
    const candidates = week.days.map((day) => day.slots);
    const accepted = week.days.map(() => []);
    const remaining = week.days.map(() => []);
    const alternativesFor = (dayIndex, original, others) => poolFor(template.days[dayIndex].slots[original.templateSlotIndex], original.templateSlotIndex)
      .filter((slot) => !others.some((other) => other.exerciseId === slot.exerciseId) && slotRawSeconds(slot) < slotRawSeconds(original));
    const fits = (slots, slot) => canPlaceResolvedSlot({ slots }, slot, durationMinutes) === true;
    const cheapest = (a, b) => slotRawSeconds(a) - slotRawSeconds(b) || compareId(a.exerciseId, b.exerciseId);
    const requiredOf = (slot) => creditKeys(slot).filter((k) => referenceTargets()[k]?.required);
    const skip = (dayIndex, slot, details = {}) => marker(week.days[dayIndex], slot, 'TIME_BUDGET_SKIP',
      { intent: slot.slotKind.intent, creditsLost: creditKeys(slot), ...details });
    // Week state for protection: accepted + still-pending candidates (primaries pending in phase A).
    const pendingOf = (i) => [...accepted[i], ...remaining[i]];
    const protectionOf = (dayIndex, slot, pool) => {
      const targets = referenceTargets();
      const possibleSets = week.days.map((_, i) => exposed(pool(i)));
      const possible = countsOf(possibleSets);
      const state = { requirements: Object.fromEntries(Object.entries(targets).map(([k, r]) => [k, { ...r, achieved: possible[k] }])) };
      const withoutIt = countsOf(possibleSets.map((set, i) => i !== dayIndex ? set : exposed(pool(i).filter((s) => s !== slot))));
      const mustHave = lostRequirements(state, withoutIt);
      const acceptedSets = accepted.map((slots) => exposed(slots));
      const achieved = countsOf(acceptedSets);
      const needed = requiredOf(slot).filter((k) => achieved[k] < targets[k].target && !acceptedSets[dayIndex].has(k));
      return { mustHave, needed, protectedRequirements: [...new Set([...mustHave, ...needed])] };
    };
    const INTENT_KEEP = { structural_primary: 4, structural_secondary: 3, core: 2, accessory: 1 };
    // Codex E: one-swap room-making, least-protected accepted slots first; a structural_primary is
    // replaced only to meet the floor of 2 or a required coverage (R-B), with an explicit reason.
    const makeRoom = (dayIndex, items, roomReason) => {
      const pool = (i) => [...pendingOf(i), ...items.filter(() => i === dayIndex)];
      const order = accepted[dayIndex].map((current) => {
        const { mustHave } = protectionOf(dayIndex, current, pool);
        const unneededCore = current.slotKind.intent === 'core' && !requiredOf(current).length;
        return { current, protectedLevel: mustHave.length ? 1 : 0, keep: unneededCore ? 0 : INTENT_KEEP[current.slotKind.intent] };
      }).filter((entry) => entry.current.slotKind.intent !== 'structural_primary' || roomReason)
        .sort((a, b) => a.protectedLevel - b.protectedLevel || a.keep - b.keep || b.current.templateSlotIndex - a.current.templateSlotIndex);
      return firstRoomSwap(order.map((entry) => entry.current), items, (current, item) => {
        const keepCredits = requiredOf(current);
        const rest = accepted[dayIndex].filter((s) => s !== current);
        return alternativesFor(dayIndex, current, [...rest, item, ...remaining[dayIndex]])
          .filter((slot) => keepCredits.every((k) => credits(slot)[k])).sort(cheapest)
          .find((slot) => fits([...rest, slot], item)) || null;
      });
    };
    const applyRoom = (dayIndex, room, original, reason) => {
      accepted[dayIndex] = accepted[dayIndex].filter((s) => s !== room.current);
      insertInOrder(accepted[dayIndex], room.swap); substitute(dayIndex, room.current, room.swap, reason);
      insertInOrder(accepted[dayIndex], room.item);
      if (room.item !== original) substitute(dayIndex, original, room.item, 'CHEAPER_ALTERNATIVE');
    };

    // R2.2: structural primaries on ALL days first, in template order.
    for (const [dayIndex] of week.days.entries()) {
      remaining[dayIndex] = candidates[dayIndex].filter((slot) => slot.slotKind.intent === 'structural_primary');
    }
    for (const [dayIndex] of week.days.entries()) {
      for (const original of [...remaining[dayIndex]]) {
        remaining[dayIndex] = remaining[dayIndex].filter((s) => s !== original);
        if (fits(accepted[dayIndex], original)) { insertInOrder(accepted[dayIndex], original); continue; }
        const others = [...candidates[dayIndex].filter((s) => s !== original), ...accepted[dayIndex]];
        const pool = (i) => [...pendingOf(i), ...(i === dayIndex ? [original] : [])];
        const { protectedRequirements } = protectionOf(dayIndex, original, pool);
        const keeps = (slot) => protectedRequirements.every((k) => credits(slot)[k]);
        const own = alternativesFor(dayIndex, original, others).sort(cheapest);
        let placed = own.find((slot) => keeps(slot) && fits(accepted[dayIndex], slot));
        if (placed) { insertInOrder(accepted[dayIndex], placed); substitute(dayIndex, original, placed, 'CHEAPER_ALTERNATIVE'); continue; }
        // R-B: fit beats variation, only for the floor of 2 or a required coverage.
        const roomReason = accepted[dayIndex].length < 2 ? 'ROOM_FOR_FLOOR' : protectedRequirements.length ? 'ROOM_FOR_REQUIRED_COVERAGE' : null;
        const room = roomReason ? makeRoom(dayIndex, [original, ...own.filter(keeps)], roomReason) : null;
        if (room) { applyRoom(dayIndex, room, original, roomReason); continue; }
        placed = own.find((slot) => fits(accepted[dayIndex], slot));
        if (placed) { insertInOrder(accepted[dayIndex], placed); substitute(dayIndex, original, placed, 'CHEAPER_ALTERNATIVE'); }
        else skip(dayIndex, original, { protectedRequirements });
      }
    }

    // R2.3: non-primaries across all days in the conservative standard keep order, re-ranked after each decision.
    for (const [dayIndex] of week.days.entries()) {
      remaining[dayIndex] = candidates[dayIndex].filter((slot) => slot.slotKind.intent !== 'structural_primary');
    }
    while (remaining.some((slots) => slots.length)) {
      // Tier 1 (must-have): the standard target cannot be reached from accepted + remaining items
      // without this one. Tier 2 (still needed): the ACCEPTED week has not reached the standard
      // target yet. Tier 3: neither. §5 intent order within tiers.
      const ranked = [];
      for (const [dayIndex, slots] of remaining.entries()) for (const slot of slots) {
        const { mustHave, needed, protectedRequirements } = protectionOf(dayIndex, slot, pendingOf);
        const targets = referenceTargets(); const intent = slot.slotKind.intent;
        const requiredCredits = requiredOf(slot);
        const acceptedCounts = countsOf(accepted.map((s) => exposed(s)));
        ranked.push({ dayIndex, slot, protectedRequirements, tier: mustHave.length ? 0 : needed.length ? 1 : 2,
          // §5 keep order: secondary, required core, accessory (fixed kind order), then unneeded core.
          group: intent === 'structural_secondary' ? 0 : intent === 'core' ? (protectedRequirements.length ? 1 : 3) : 2,
          surplus: intent === 'structural_secondary' && requiredCredits.length
            ? Math.min(...requiredCredits.map((k) => acceptedCounts[k] - targets[k].target)) : null,
          accessoryOrder: ACC.indexOf(slot.slotKind.accessoryKind) });
      }
      ranked.sort((a, b) => a.tier - b.tier || a.group - b.group
        || Number(a.surplus === null) - Number(b.surplus === null) || (a.surplus ?? 0) - (b.surplus ?? 0)
        || a.accessoryOrder - b.accessoryOrder || a.dayIndex - b.dayIndex || a.slot.templateSlotIndex - b.slot.templateSlotIndex);
      const { dayIndex, slot: original, protectedRequirements } = ranked[0];
      remaining[dayIndex] = remaining[dayIndex].filter((s) => s !== original);
      if (fits(accepted[dayIndex], original)) { insertInOrder(accepted[dayIndex], original); continue; }
      // Cheaper approved alternatives, never fewer sets or a weaker row: (1) own cheaper alternative
      // keeping its protected credits; (2) one room-making swap (Codex E); (3) own cheaper alternative
      // even without its protected credits; otherwise skip with the credits lost.
      const others = [...accepted[dayIndex], ...remaining[dayIndex]];
      const keeps = (slot) => protectedRequirements.every((k) => credits(slot)[k]);
      const own = alternativesFor(dayIndex, original, others).sort(cheapest);
      let placed = own.find((slot) => keeps(slot) && fits(accepted[dayIndex], slot));
      if (placed) { insertInOrder(accepted[dayIndex], placed); substitute(dayIndex, original, placed, 'CHEAPER_ALTERNATIVE'); continue; }
      const primaryReason = accepted[dayIndex].length < 2 ? 'ROOM_FOR_FLOOR' : protectedRequirements.length ? 'ROOM_FOR_REQUIRED_COVERAGE' : null;
      const room = makeRoom(dayIndex, [original, ...own.filter(keeps)], primaryReason);
      if (room) {
        applyRoom(dayIndex, room, original, room.current.slotKind.intent === 'structural_primary' ? primaryReason : 'ROOM_FOR_PLACEMENT');
        continue;
      }
      placed = own.find((slot) => fits(accepted[dayIndex], slot));
      if (placed) { insertInOrder(accepted[dayIndex], placed); substitute(dayIndex, original, placed, 'CHEAPER_ALTERNATIVE'); }
      else skip(dayIndex, original, { protectedRequirements });
    }
    for (const [dayIndex, day] of week.days.entries()) day.slots = accepted[dayIndex];

    // Slot kinds whose approved executable candidates earn a coverage key (same kinds weeklyCoverageV3 checks).
    const COVERAGE_KINDS = [...STRUCTURAL.flatMap((pattern) =>
      [{ pattern, intent: 'structural_primary' }, { pattern, intent: 'structural_secondary' }]),
      { pattern: 'CORE', intent: 'core' }, ...['lateral_delts', 'rear_delts', 'ham_knee_flexion']
        .map((accessoryKind) => ({ pattern: 'ACC', intent: 'accessory', accessoryKind }))];
    const creditingKinds = (key) => COVERAGE_KINDS.filter((kind) => poolFor(kind, -1).some((slot) => credits(slot)[key]))
      .map((kind) => [kind.pattern, kind.intent, kind.accessoryKind].filter(Boolean).join('/'));
    // R2.4: final capacity and coverage regime come from the finished week only.
    refresh();
    const limitations = [];
    const deficitCache = new Map();
    for (const [key, requirement] of Object.entries(coverage.requirements)) {
      if (requirement.required && requirement.status === 'not_executable') {
        limitations.push({ status: 'limited', requirement: key, reason: 'NOT_EXECUTABLE', coverageReason: requirement.reason });
        continue;
      }
      if (requirement.status !== 'missing') continue;
      // 2026-10-16: retain recorded causes, then distinguish authored capacity from content.
      const { reason, causes } = classifyDeficitCause(key, skips, decisions, { template, target: requirement.target,
        goal, tier, mode, athleteContext: week.equipmentContext, cache: deficitCache });
      limitations.push({ status: 'limited', requirement: key, coverageReason: requirement.reason, reason,
        ...(causes.length ? { causes } : { slotKinds: creditingKinds(key) }) });
    }
    const floorFailures = week.days.filter((day) => day.slots.length < 2)
      .map((day) => ({ templateId: day.templateId, reason: 'SESSION_EXERCISE_FLOOR_NOT_MET', slotCount: day.slots.length }));
    const successful = floorFailures.length === 0;
    return { ok: successful, ...(!successful ? { reason: 'SESSION_EXERCISE_FLOOR_NOT_MET', floorFailures } : {}),
      status: limitations.length ? 'limited' : 'coverage_met', week, coverage, limitations, skips, decisions };
  } catch (error) { return fail(error.message); }
}
