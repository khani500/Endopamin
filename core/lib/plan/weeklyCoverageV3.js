/** Shadow coverage only. Never reads working-set totals, muscle-volume credit or ledgers.
 * week.days contains training days identified by templateId, with resolved main slots.
 * Each slot has explicit source: base_template | optional_addition. Repairs must update
 * this provenance; callers protect required exposures before removing base slots (D2).
 * Evaluation also needs week.tier and week.equipmentContext (canonical tokens + explicit goal).
 */
import { resolvePrescription } from './prescriptionResolver.js';
import { SUPPORTED_SESSION_MINUTES_V3, sessionModeV3 } from './sessionDurationV3.js';
import { resolveSlotCandidates } from './slotEligibility.js';
import { getReviewedPrescriptionInputs } from './reviewedPrescriptionInputs.js';
import { getExerciseById } from '../../data/exerciseRegistryIndex.js';

const STRUCTURAL = ['SQ', 'HG', 'LU', 'HPU', 'HPL', 'VPU', 'VPL'];
const KEYS = [...STRUCTURAL, 'CORE', 'knee', 'hinge', 'push', 'pull', 'hamstring_primary', 'lateral_delts', 'rear_delts'];
const emptyCounts = () => Object.fromEntries(KEYS.map((key) => [key, 0]));
const fail = (reason) => ({ ok: false, reason });
const primary = (pattern) => ({ pattern, intent: 'structural_primary' });
const secondary = (pattern) => ({ pattern, intent: 'structural_secondary' });
const accessory = (accessoryKind) => ({ pattern: 'ACC', intent: 'accessory', accessoryKind });

/** One valid resolved slot earns at most one credit for each exposure category, not sets. */
export function coverageCreditForSlot(slot) {
  const p = slot?.resolvedPrescription;
  if (!p || p.ok !== true) return fail('UNRESOLVED_PRESCRIPTION');
  if (typeof slot.exerciseId !== 'string' || slot.exerciseId !== p.exerciseId) return fail('EXERCISE_ID_MISMATCH');
  const approved = resolvePrescription({ exerciseId: slot.exerciseId, slotKind: p.slotKind, goal: p.goal, tier: p.tier, mode: p.mode });
  if (!approved.ok) return fail(approved.reason);
  if (p.prescriptionRole !== approved.prescriptionRole) return fail('PRESCRIPTION_ROLE_MISMATCH');
  if (p.reviewedInputsVersion !== approved.reviewedInputsVersion) return fail('REVIEWED_INPUTS_VERSION_MISMATCH');
  for (const key of ['pattern', 'intent', 'accessoryKind']) {
    if (Object.hasOwn(slot, key) && slot[key] !== approved.slotKind[key]) return fail('SLOT_KIND_MISMATCH');
  }
  const record = getExerciseById(slot.exerciseId);
  if (!record) return fail('UNKNOWN_EXERCISE_ID');
  const { pattern, intent, accessoryKind } = approved.slotKind;
  const credits = emptyCounts();
  const structural = STRUCTURAL.includes(pattern);
  // Latest 2f rule: the actual resolved role must qualify; another role for the ID is not credit.
  const qualifies = structural && ((intent === 'structural_primary' && approved.prescriptionRole === 'primary')
    || (intent === 'structural_secondary' && approved.prescriptionRole === 'accessory_compound'));
  if (qualifies) {
    credits[pattern] = 1;
    if (['SQ', 'LU'].includes(pattern)) credits.knee = 1;
    if (pattern === 'HG') credits.hinge = 1;
    if (['HPU', 'VPU'].includes(pattern)) credits.push = 1;
    if (['HPL', 'VPL'].includes(pattern)) credits.pull = 1;
  }
  if (pattern === 'CORE' && intent === 'core' && approved.prescriptionRole === 'core') credits.CORE = 1;
  const hamstringMovement = (pattern === 'HG' && structural)
    || (pattern === 'ACC' && accessoryKind === 'ham_knee_flexion');
  if (hamstringMovement && record.primaryMuscles?.includes('hamstrings')) credits.hamstring_primary = 1;
  if (pattern === 'ACC' && ['lateral_delts', 'rear_delts'].includes(accessoryKind)) credits[accessoryKind] = 1;
  if (qualifies && pattern === 'HPL') {
    const rear = getReviewedPrescriptionInputs(slot.exerciseId)?.eligibility.some((entry) =>
      entry.slotKind.pattern === 'ACC' && entry.slotKind.intent === 'accessory'
      && entry.slotKind.accessoryKind === 'rear_delts' && entry.reviewStatus === 'approved'
      && entry.movementEligibility === 'eligible');
    if (rear) credits.rear_delts = 1;
  }
  return {
    ok: true, exerciseId: slot.exerciseId, credits,
    reason: qualifies ? 'STRUCTURAL_PATTERN_CREDIT' : credits.CORE ? 'CORE_EXPOSURE_CREDIT'
      : structural ? 'ISOLATION_SECONDARY_NO_PATTERN_CREDIT' : 'ACCESSORY_NO_STRUCTURAL_PATTERN_CREDIT',
  };
}

/** D3: union categories inside each qualifying day; repeat IDs across days remain exposures. */
export function countWeeklyExposures(week) {
  if (!week || !Array.isArray(week.days) || week.days.length < 2 || week.days.length > 6) return fail('INVALID_TRAINING_DAYS');
  const seen = new Set();
  const counts = emptyCounts();
  const days = [];
  let capacity = 0;
  for (const day of week.days) {
    if (!day || typeof day.templateId !== 'string' || !day.templateId || seen.has(day.templateId)
        || !Array.isArray(day.slots)) return fail('INVALID_TRAINING_DAY');
    seen.add(day.templateId);
    const exposed = new Set();
    let baseCapacity = 0;
    for (const [slotIndex, slot] of day.slots.entries()) {
      if (!slot || !['base_template', 'optional_addition'].includes(slot.source)) {
        return { ...fail('INVALID_SLOT_SOURCE'), templateId: day.templateId, slotIndex };
      }
      const result = coverageCreditForSlot(slot);
      if (!result.ok) return { ...result, templateId: day.templateId, slotIndex };
      if (slot.source === 'base_template') baseCapacity++;
      for (const key of KEYS) if (result.credits[key]) exposed.add(key);
    }
    for (const key of exposed) counts[key]++;
    capacity += baseCapacity;
    days.push({ templateId: day.templateId, baseCapacity, exposures: KEYS.filter((key) => exposed.has(key)) });
  }
  return { ok: true, capacity, trainingDays: days.length, counts, days };
}

/** Applicability is established from executable approved resolutions, never from delivered volume. */
export function evaluateWeeklyCoverage(week, options) {
  const executabilityCache = options?.executabilityCache;
  if (executabilityCache !== undefined && !(executabilityCache instanceof Map)) return fail('INVALID_EXECUTABILITY_CACHE');
  const durationMinutes = options?.durationMinutes;
  if (!SUPPORTED_SESSION_MINUTES_V3.includes(durationMinutes)) return fail('INVALID_DURATION');
  if (week?.durationMinutes !== undefined && week.durationMinutes !== durationMinutes) return fail('DURATION_CONTEXT_MISMATCH');
  const tier = week?.tier;
  const context = week?.equipmentContext;
  if (!['beginner', 'intermediate', 'advanced'].includes(tier)) return fail('INVALID_TIER');
  if (!context || !Array.isArray(context.availableEquipment)
      || context.availableEquipment.some((t) => typeof t !== 'string' || !t)) return fail('INVALID_EQUIPMENT_CONTEXT');
  if (!['muscle_gain', 'fat_loss', 'endurance'].includes(context.goal)) return fail('INVALID_GOAL');
  const ledger = countWeeklyExposures(week);
  if (!ledger.ok) return ledger;
  const mode = sessionModeV3(durationMinutes);
  const executable = emptyCounts();
  try {
    const cacheKey = executabilityCache ? JSON.stringify([tier, mode, week.equipmentContext]) : null;
    let entry = executabilityCache?.get(cacheKey);
    if (!entry) {
      entry = { idsByKind: new Map(), executable: null };
      if (executabilityCache) executabilityCache.set(cacheKey, entry);
    }
    const candidates = new Map();
    const candidatesFor = (slotKind) => {
      const key = JSON.stringify(slotKind);
      if (!entry.idsByKind.has(key)) {
        const result = resolveSlotCandidates({ slotKind, goal: context.goal, tier, mode, athleteContext: context });
        if (!result.ok) throw new Error(result.reason);
        candidates.set(key, result.candidates);
        entry.idsByKind.set(key, new Set(result.candidates.map((c) => c.exerciseId)));
      }
      return entry.idsByKind.get(key);
    };
    for (const day of week.days) for (const slot of day.slots) {
      const p = slot.resolvedPrescription;
      if (p.mode !== mode || p.goal !== context.goal || p.tier !== tier) return fail('PRESCRIPTION_CONTEXT_MISMATCH');
      if (!candidatesFor(p.slotKind).has(slot.exerciseId)) return fail('SLOT_NOT_EXECUTABLE_FOR_CONTEXT');
    }
    if (entry.executable !== null) Object.assign(executable, entry.executable);
    else {
      const kinds = STRUCTURAL.flatMap((pattern) => [primary(pattern), secondary(pattern)]);
      kinds.push({ pattern: 'CORE', intent: 'core' }, accessory('lateral_delts'), accessory('rear_delts'), accessory('ham_knee_flexion'));
      for (const kind of kinds) {
        const ids = candidatesFor(kind);
        const resolved = candidates.get(JSON.stringify(kind)) ?? [...ids].map((exerciseId) => ({
          exerciseId, resolvedPrescription: resolvePrescription({ exerciseId, slotKind: kind, goal: context.goal, tier, mode }),
        }));
        for (const candidate of resolved) {
          const credit = coverageCreditForSlot(candidate);
          if (!credit.ok) throw new Error(credit.reason);
          for (const key of KEYS) if (credit.credits[key]) executable[key] = 1;
        }
      }
      entry.executable = Object.freeze({ ...executable });
    }
  } catch (error) { return fail(error.message); }
  const short = mode === 'short_session';
  const reduced = short || ledger.capacity < 10;
  const optionalReason = short ? 'OPTIONAL_IN_SHORT_MODE' : 'OPTIONAL_BELOW_CAPACITY_10';
  const requirements = {};
  function requirement(key, target, whenExecutable = false, reason = optionalReason) {
    const available = executable[key] === 1;
    const required = target > 0 && (!whenExecutable || available);
    const achieved = ledger.counts[key];
    requirements[key] = {
      target, achieved, required, executable: available,
      status: !available ? 'not_executable' : !required || achieved >= target ? 'met' : 'missing',
      reason: !available ? 'NO_EXECUTABLE_APPROVED_CANDIDATE' : !required ? reason
        : achieved >= target ? 'MET_WEEKLY_TARGET' : 'BELOW_WEEKLY_TARGET',
    };
  }
  const lowerTarget = reduced || ledger.trainingDays === 2 ? 1 : 2;
  requirement('knee', lowerTarget);
  requirement('hinge', lowerTarget);
  requirement('push', reduced ? 1 : 2);
  requirement('pull', reduced ? 1 : 2);
  requirement('hamstring_primary', 1, true);
  for (const pattern of STRUCTURAL) {
    // §6's SQ subtarget at 3+ days remains in reduced standard mode. The 20-min
    // exception removes standard orientation/all-pattern subtargets at every capacity.
    const requiredSQ = pattern === 'SQ' && !short && ledger.trainingDays >= 3;
    requirement(pattern, !reduced || requiredSQ ? 1 : 0, true, 'PATTERN_NOT_REQUIRED_IN_REDUCED_MODE');
  }
  requirement('CORE', reduced ? 0 : ledger.trainingDays >= 3 ? 2 : 1, true);
  requirement('lateral_delts', reduced ? 0 : 1, true);
  requirement('rear_delts', reduced ? 0 : 1, true);
  return {
    ok: true, durationMinutes, mode, coverageMode: reduced ? 'reduced' : 'standard',
    capacity: ledger.capacity, exposures: ledger, requirements,
    injuryEnforcement: 'not_implemented', // This ledger grants no Track C clearance or delivery verdict.
  };
}
