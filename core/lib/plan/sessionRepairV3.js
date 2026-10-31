import { MIN_MAIN_EXERCISES, targetMainExercises } from './sessionDeliveryPolicy.js';
import { validateResolvedSlot, slotRawSeconds, sessionRawSeconds, canPlaceResolvedSlot } from './resolvedSlotContract.js';
import { evaluateWeeklyCoverage } from './weeklyCoverageV3.js';
import { weeklyPrescribedGroupTotals } from './muscleVolumeGroups.js';
import { recoveryConflictsV3, validateRequiredBudgetV3, sessionEstimateV3 } from './sessionBudgetV3.js';
import { sessionModeV3 } from './sessionDurationV3.js';
export { recoveryConflictsV3 } from './sessionBudgetV3.js';

/* ---------------------------------------------------------------------------
 * Step 2k: explicit, dormant V3 whole-slot move repair. Separate from the
 * legacy path in sessionRepair.js, which it never calls or changes.
 *
 * Input is a resolved V3 week (2h, or 2j output): { durationMinutes, tier,
 * equipmentContext, days: [{ templateId, slots }] }. A move relocates one
 * resolved slot object unchanged: same ID, intent, sets, prescription, source
 * and templateSlotIndex; `movedFrom` records the origin day. Nothing is
 * created, dropped, shortened or re-prescribed.
 *
 * Floor and targets come from sessionDeliveryPolicy: a day below its target is
 * a receiver; targets never block (ok:false only while a day is below the floor). At 20 minutes the D4 two-primary day is the
 * approved shape, so only a day below the floor is a receiver there, and every
 * move is refused because it would break the lower + upper structure.
 * All timing is resolvedSlotContract (warm-up once per session).
 * Coverage (weeklyCoverageV3) decides legality; volume ledgers are reported
 * only. D5 is a ranking preference: calendar days are not assigned yet, so
 * adjacent training days in week order stand in for consecutive days.
 * ------------------------------------------------------------------------- */

const failV3 = (reason, details = {}) => ({ ok: false, reason, ...details });
const cloneV3 = (v) => Array.isArray(v) ? v.map(cloneV3) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneV3(x)])) : v;
const compareIdV3 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Same raw-minute float tolerance as 2j (RAW_MINUTES_EPSILON); volume sums use it too.
const EPSILON_SECONDS = 60e-9;
const VOLUME_EPSILON = 1e-9;

/** Raw seconds for one resolved V3 slot; a specific refusal on failure. */
export function rawSlotSecondsV3(slot) {
  return slotRawSeconds(slot);
}

/** Raw seconds for one V3 day, warm-up counted once; a specific refusal on failure. */
export function dayRawSecondsV3(day, durationMinutes) {
  return sessionRawSeconds(day, durationMinutes);
}

// Region comes from the authored slot pattern and the template day type; never from muscle tags.
const SLOT_REGION = { SQ: 'lower', LU: 'lower', HG: 'lower', HPU: 'upper', VPU: 'upper', HPL: 'upper', VPL: 'upper', CORE: 'neutral' };
const ACC_REGION = { ham_knee_flexion: 'lower', calves: 'lower', glutes: 'lower',
  lateral_delts: 'upper', rear_delts: 'upper', biceps: 'upper', triceps: 'upper' };
const DAY_REGION = { 'FB-A': 'full', 'FB-B': 'full', 'FB-C': 'full', U1: 'upper', U2: 'upper', L1: 'lower', L2: 'lower',
  'Push-1': 'upper', 'Push-2': 'upper', 'Pull-1': 'upper', 'Pull-2': 'upper', 'Legs-1': 'lower', 'Legs-2': 'lower' };
// Least important first; a primary moves only as a last resort.
const MOVE_INTENT_ORDER = ['accessory', 'core', 'structural_secondary', 'structural_primary'];

export function slotRegionV3(slot) {
  const kind = slot?.slotKind;
  return (kind?.pattern === 'ACC' ? ACC_REGION[kind.accessoryKind] : SLOT_REGION[kind?.pattern]) || null;
}

export function dayRegionV3(day) {
  const id = day?.baseTemplateId ?? day?.templateId;
  if (typeof id !== 'string') return null;
  if (/^Short-\d+$/.test(id)) return 'full';
  return DAY_REGION[id.replace(/-variation$/, '')] || null;
}

const regionMatches = (slotRegion, dayRegion) => slotRegion === 'neutral' || dayRegion === 'full' || slotRegion === dayRegion;

const withoutMove = (slot) => { const { movedFrom, ...rest } = slot; return rest; };
const slotSignatures = (week) => week.days.flatMap((d) => d.slots.map((s) => JSON.stringify(withoutMove(s)))).sort();

function volumeReport(week) {
  const weekly = weeklyPrescribedGroupTotals(week);
  if (!weekly.ok) return weekly;
  const days = [];
  for (const day of week.days) {
    const totals = weeklyPrescribedGroupTotals({ days: [day] });
    if (!totals.ok) return totals;
    days.push({ templateId: day.templateId, workingSets: totals.workingSets, totals: totals.totals });
  }
  return { ok: true, workingSets: weekly.workingSets, totals: weekly.totals, days };
}

function coverageLost(before, after) {
  return Object.entries(before.requirements).filter(([key, r]) => r.required
    && after.requirements[key].achieved < r.achieved && after.requirements[key].achieved < r.target).map(([key]) => key);
}

/**
 * Repair thin V3 sessions by whole-slot moves within the same week.
 * @param {object} input  resolved V3 week (see block comment)
 * @returns ok:true with `week` whenever every day meets the floor; days still below
 *   target are non-blocking `belowTarget` notes. Otherwise an explicitly unsuccessful
 *   { ok:false, reason:'NO_LEGAL_MOVE', proposedWeek, unrepaired, rejected }.
 */
export function repairThinSessionsV3(input, options) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.days)) return failV3('INVALID_WEEK');
  const durationMinutes = input.durationMinutes;
  const target = targetMainExercises(durationMinutes);
  if (typeof target !== 'number') return failV3(target.reason);
  const short = sessionModeV3(durationMinutes) === 'short_session';
  const floor = MIN_MAIN_EXERCISES;
  const executabilityCache = options?.executabilityCache === undefined ? new Map() : options.executabilityCache;
  const coverageBefore = evaluateWeeklyCoverage(input, { durationMinutes, executabilityCache });
  if (!coverageBefore.ok) return coverageBefore;
  const budget = validateRequiredBudgetV3(input, { executabilityCache });
  if (!budget.ok) return budget;
  for (const [dayIndex, day] of input.days.entries()) {
    if (!dayRegionV3(day)) return failV3('UNKNOWN_DAY_TYPE', { dayIndex });
    if (new Set(day.slots.map((s) => s.exerciseId)).size !== day.slots.length) return failV3('DUPLICATE_IN_SESSION', { dayIndex });
    for (const [slotIndex, slot] of day.slots.entries()) {
      const valid = validateResolvedSlot(slot);
      if (!valid.ok) return { ...valid, dayIndex, slotIndex };
      if (!slotRegionV3(slot)) return failV3('UNKNOWN_SLOT_REGION', { dayIndex, slotIndex });
    }
    const seconds = dayRawSecondsV3(day, durationMinutes);
    if (typeof seconds !== 'number') return { ...seconds, dayIndex };
    if (seconds > budget.budgetSecondsByDay[dayIndex] + EPSILON_SECONDS) return failV3('INPUT_EXCEEDS_BUDGET', { dayIndex });
  }
  const volumeBefore = volumeReport(input);
  if (!volumeBefore.ok) return volumeBefore;

  const week = cloneV3(input);
  const thinBelow = short ? floor : target;
  const moves = [];
  const rejected = [];
  let coverage = coverageBefore;
  let pass = 0;

  const receivers = () => week.days.map((day, dayIndex) => ({ day, dayIndex }))
    .filter(({ day }) => day.slots.length < thinBelow)
    .sort((a, b) => a.day.slots.length - b.day.slots.length || a.dayIndex - b.dayIndex);
  const refuse = (to, from, slot, reason, details = {}) => ({ toDayIndex: to, toTemplateId: week.days[to].templateId,
    fromDayIndex: from, fromTemplateId: week.days[from].templateId, exerciseId: slot.exerciseId, pass, reason, ...details });
  const propose = (to, from, slotIndex) => {
    const slot = week.days[from].slots[slotIndex];
    const moved = slot.movedFrom ? { ...slot } : { ...slot, movedFrom: { templateId: week.days[from].templateId, dayIndex: from } };
    const receiver = week.days[to].slots;
    // Primaries stay ahead of non-primary work; everything else keeps relative order and is appended.
    const lastPrimary = receiver.map((s) => s.slotKind.intent).lastIndexOf('structural_primary');
    const at = moved.slotKind.intent === 'structural_primary' ? lastPrimary + 1 : receiver.length;
    return { ...week, days: week.days.map((day, i) => i === from ? { ...day, slots: day.slots.filter((_, j) => j !== slotIndex) }
      : i === to ? { ...day, slots: [...receiver.slice(0, at), moved, ...receiver.slice(at)] } : day) };
  };

  try {
    while (true) {
      const pending = receivers();
      if (!pending.length) break;
      pass++;
      let applied = false;
      for (const { dayIndex: to } of pending) {
        const receiverIds = new Set(week.days[to].slots.map((s) => s.exerciseId));
        const legal = [];
        for (const [from, donor] of week.days.entries()) {
          if (from === to) continue;
          for (const [slotIndex, slot] of donor.slots.entries()) {
            if (slot.requiredCoveragePlacement) {
              rejected.push(refuse(to, from, slot, 'REQUIRED_EXTENSION_PLACEMENT_LOCKED')); continue;
            }
            // D4: a 20-minute day has exactly one lower + one upper primary; no move preserves that.
            if (short) { rejected.push(refuse(to, from, slot, 'SHORT_SESSION_STRUCTURE_LOCKED')); continue; }
            if (donor.slots.length - 1 < floor) { rejected.push(refuse(to, from, slot, 'DONOR_BELOW_FLOOR')); continue; }
            // Termination guard: a move must not leave the donor thinner than the receiver becomes.
            if (donor.slots.length - 1 < week.days[to].slots.length + 1) { rejected.push(refuse(to, from, slot, 'MOVE_DOES_NOT_REDUCE_IMBALANCE')); continue; }
            if (receiverIds.has(slot.exerciseId)) { rejected.push(refuse(to, from, slot, 'EXERCISE_ALREADY_IN_SESSION')); continue; }
            // Never two primaries of one pattern in a session (e.g. two SQ); SQ + HG is allowed.
            if (slot.slotKind.intent === 'structural_primary' && week.days[to].slots.some((s) =>
              s.slotKind.intent === 'structural_primary' && s.slotKind.pattern === slot.slotKind.pattern)) {
              rejected.push(refuse(to, from, slot, 'SAME_PATTERN_PRIMARY_IN_SESSION')); continue;
            }
            const fits = canPlaceResolvedSlot(week.days[to], slot, durationMinutes);
            if (fits !== true) { rejected.push(refuse(to, from, slot, fits === false ? 'RECEIVER_OVER_BUDGET' : fits.reason)); continue; }
            const proposal = propose(to, from, slotIndex);
            const after = evaluateWeeklyCoverage(proposal, { durationMinutes, executabilityCache });
            if (!after.ok) { rejected.push(refuse(to, from, slot, after.reason)); continue; }
            if (after.capacity !== coverageBefore.capacity) { rejected.push(refuse(to, from, slot, 'CAPACITY_CHANGED')); continue; }
            const lost = coverageLost(coverage, after);
            if (lost.length) { rejected.push(refuse(to, from, slot, 'REQUIRED_COVERAGE_LOST', { requirements: lost })); continue; }
            legal.push({ from, slotIndex, slot, proposal, after, recoveryConflicts: recoveryConflictsV3(proposal),
              donorCount: donor.slots.length, rawSeconds: rawSlotSecondsV3(slot),
              intentRank: MOVE_INTENT_ORDER.indexOf(slot.slotKind.intent),
              regionMatch: regionMatches(slotRegionV3(slot), dayRegionV3(week.days[to])) });
          }
        }
        if (!legal.length) continue;
        // A cross-region move is considered only when no region-matching legal move exists.
        const matching = legal.filter((c) => c.regionMatch);
        const ranked = matching.length ? matching : legal;
        // Least important intent first; D5 (preference, never a refusal); fullest donor; code-point ID, donor day, slot order.
        ranked.sort((a, b) => a.intentRank - b.intentRank || a.recoveryConflicts - b.recoveryConflicts
          || b.donorCount - a.donorCount || compareIdV3(a.slot.exerciseId, b.slot.exerciseId)
          || a.from - b.from || a.slotIndex - b.slotIndex);
        const pick = ranked[0];
        week.days = pick.proposal.days;
        coverage = pick.after;
        moves.push({ action: 'whole_slot_move', fromDayIndex: pick.from, fromTemplateId: week.days[pick.from].templateId,
          toDayIndex: to, toTemplateId: week.days[to].templateId, exerciseId: pick.slot.exerciseId,
          slotKind: pick.slot.slotKind, sets: pick.slot.sets, source: pick.slot.source,
          rawSeconds: pick.rawSeconds, recoveryConflicts: pick.recoveryConflicts, regionMatch: pick.regionMatch,
          ...(pick.regionMatch ? {} : { crossRegionReason: 'NO_REGION_MATCHING_MOVE' }) });
        applied = true;
        break;
      }
      if (!applied) break;
    }
    for (const day of week.days) {
      day.rawSeconds = dayRawSecondsV3(day, durationMinutes);
      if (typeof day.rawSeconds !== 'number') return day.rawSeconds;
      if (week.requiredTimeExtension) day.timing = sessionEstimateV3(day, durationMinutes);
    }
  } catch (error) { return failV3(error.message); }

  const finalBudget = validateRequiredBudgetV3(week, { executabilityCache });
  if (!finalBudget.ok) return finalBudget;

  // Fail closed: a move never alters a prescription or the week's prescribed volume.
  if (JSON.stringify(slotSignatures(input)) !== JSON.stringify(slotSignatures(week))) return failV3('PRESCRIPTION_CHANGED');
  const volumeAfter = volumeReport(week);
  if (!volumeAfter.ok) return volumeAfter;
  if (volumeAfter.workingSets !== volumeBefore.workingSets
      || Object.keys(volumeBefore.totals).some((g) => Math.abs(volumeAfter.totals[g] - volumeBefore.totals[g]) > VOLUME_EPSILON))
    return failV3('WEEKLY_VOLUME_CHANGED');

  const report = { repairMode: 'whole_slot_move_v3', policy: { floor, target, receiverBelow: thinBelow },
    moves, rejected, coverage, volume: { before: volumeBefore, after: volumeAfter },
    recovery: { preference: 'avoid_consecutive_heavy_SQ_HG', basis: 'adjacent_training_days', calendarAssigned: false,
      conflictsBefore: recoveryConflictsV3(input), conflictsAfter: recoveryConflictsV3(week) } };
  // Targets never block: below-target days are notes only.
  const belowTarget = week.days.map((day, dayIndex) => ({ dayIndex, templateId: day.templateId, slotCount: day.slots.length, target }))
    .filter((note) => note.slotCount < target);
  const unrepaired = week.days.map((day, dayIndex) => ({ dayIndex, templateId: day.templateId, slotCount: day.slots.length, floor }))
    .filter((entry) => entry.slotCount < floor);
  if (unrepaired.length) {
    // Explicitly unsuccessful: a day remains below the floor; never a deliverable week, never presented as repaired.
    return { ok: false, reason: 'NO_LEGAL_MOVE', proposedWeek: week, unrepaired, belowTarget, ...report };
  }
  return { ok: true, status: moves.length ? 'repaired' : 'no_repair_needed', week, belowTarget, ...report };
}
