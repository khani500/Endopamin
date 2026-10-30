/** Step 2o: dormant V3 shadow adaptation/delivery verdict (rulings D-1…D-6).
 * Pure and deterministic; no I/O; never throws (every failure is a machine code).
 * Hard checks are recomputed on the final (2k) week; status comes only from final coverage.
 * A refusal means only "this shadow week is not delivered; use legacy". It never states or
 * implies that no valid week exists. Machine codes only; display copy is deferred (D8).
 */
import { suggestedPullEquipment, accessoryEquipmentNotes } from './equipmentCapabilityV3.js';
import { normalizeSessionDurationV3 } from './sessionDurationV3.js';
import { validateWeeklyTemplate } from './weeklyTemplateV3.js';
import { resolveSlotCandidates } from './slotEligibility.js';
import { validateResolvedSlot, sessionRawSeconds } from './resolvedSlotContract.js';
import { evaluateWeeklyCoverage } from './weeklyCoverageV3.js';
import { classifyDeficitCause } from './templateWeekAllocator.js';
import { MIN_MAIN_EXERCISES } from './sessionDeliveryPolicy.js';
import { getReviewedPrescriptionInputs } from './reviewedPrescriptionInputs.js';
import { EQUIPMENT_BUCKETS } from './equipmentContract.js';
import { validateRequiredBudgetV3, sessionEstimateV3 } from './sessionBudgetV3.js';
import { getExerciseById } from '../../data/exerciseRegistryIndex.js';
import { validateSlotPriorityV3 } from './slotPriorityV3.js';

export const V3_SHADOW_DELIVERY_VERSION = 'v3-shadow-delivery.v2';
// Same raw-time float tolerance as 2j/2k; never a minutes allowance.
const EPSILON_SECONDS = 60e-9;
const GOALS = ['muscle_gain', 'fat_loss', 'endurance'];
const TIERS = ['beginner', 'intermediate', 'advanced'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const code = (value) => typeof value === 'string' && value.length > 0;
const STAGES = {
  template: (s) => Array.isArray(s.days),
  allocation: (s) => object(s.week) && Array.isArray(s.skips) && Array.isArray(s.decisions) && Array.isArray(s.limitations),
  volume: (s) => object(s.week) && Array.isArray(s.notes),
  repair: (s) => object(s.week) && Array.isArray(s.belowTarget),
};

function refuse(reasons, extra = {}) {
  return { version: V3_SHADOW_DELIVERY_VERSION, verdict: 'not_deliverable', fallback: 'legacy', reasons,
    week: null, coverage: null, limitations: [], templateLimitations: [], notes: [], diagnostics: {}, ...extra };
}

function stageReasons(stages) {
  const reasons = [];
  for (const [stage, accepts] of Object.entries(STAGES)) {
    const result = stages[stage];
    if (result === undefined || result === null) reasons.push({ code: 'STAGE_MISSING', stage });
    else if (!object(result)) reasons.push({ code: 'STAGE_INVALID', stage });
    else if (result.ok !== true) reasons.push({ code: code(result.reason) ? result.reason : 'STAGE_FAILED_WITHOUT_REASON', stage });
    else if (!accepts(result)) reasons.push({ code: 'STAGE_SHAPE_INVALID', stage });
  }
  return reasons;
}

function contextReasons(context, template) {
  if (!object(context)) return { reasons: [{ code: 'INVALID_CONTEXT' }] };
  const { daysPerWeek, tier, goal, equipmentContext } = context;
  const reasons = [];
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 2 || daysPerWeek > 6) reasons.push({ code: 'INVALID_DAYS_PER_WEEK' });
  const duration = normalizeSessionDurationV3(context.durationMinutes);
  if (!duration.ok) reasons.push({ code: duration.reason });
  else if (duration.sessionMinutes !== template.durationMinutes) reasons.push({ code: 'DURATION_CONTEXT_MISMATCH' });
  if (!TIERS.includes(tier)) reasons.push({ code: 'INVALID_TIER' });
  if (!GOALS.includes(goal)) reasons.push({ code: 'INVALID_GOAL' });
  if (!object(equipmentContext) || !Array.isArray(equipmentContext.availableEquipment)
      || equipmentContext.availableEquipment.some((token) => !code(token))) reasons.push({ code: 'INVALID_EQUIPMENT_CONTEXT' });
  else {
    if (equipmentContext.goal !== undefined && equipmentContext.goal !== goal) reasons.push({ code: 'GOAL_CONTEXT_MISMATCH' });
    if (equipmentContext.athleteTier !== undefined && equipmentContext.athleteTier !== tier) reasons.push({ code: 'TIER_CONTEXT_MISMATCH' });
  }
  return { reasons, durationMinutes: duration.ok ? duration.sessionMinutes : null };
}

/** D-6 hard checks plus D-3, each failure with its own code and day/slot location. */
function hardCheckReasons(week, template, { durationMinutes, tier, goal, athleteContext }) {
  const reasons = [];
  if (week.durationMinutes !== durationMinutes) reasons.push({ code: 'WEEK_DURATION_MISMATCH' });
  if (week.tier !== tier) reasons.push({ code: 'WEEK_TIER_MISMATCH' });
  if (week.equipmentContext?.goal !== goal) reasons.push({ code: 'WEEK_GOAL_MISMATCH' });
  const weekTokens = week.equipmentContext?.availableEquipment;
  if (!Array.isArray(weekTokens) || weekTokens.length !== athleteContext.availableEquipment.length
      || weekTokens.some((token, i) => token !== athleteContext.availableEquipment[i])) reasons.push({ code: 'WEEK_EQUIPMENT_MISMATCH' });
  if (!Array.isArray(week.days) || week.days.length !== template.days.length
      || week.days.some((day, i) => !object(day) || day.templateId !== template.days[i].templateId || !Array.isArray(day.slots))) {
    reasons.push({ code: 'WEEK_DAY_STRUCTURE_MISMATCH' });
    return reasons;
  }
  const mode = durationMinutes === 15 ? 'short_session' : 'standard';
  const budget = validateRequiredBudgetV3(week);
  if (!budget.ok) reasons.push({ code: budget.reason });
  const owned = new Set(athleteContext.availableEquipment);
  const pools = new Map();
  const eligibleIds = (slotKind) => {
    const key = JSON.stringify(slotKind);
    if (!pools.has(key)) {
      const result = resolveSlotCandidates({ slotKind, goal, tier, mode, athleteContext });
      pools.set(key, result.ok ? { ok: true, byId: new Map(result.candidates.map((c) => [c.exerciseId, c])) } : result);
    }
    return pools.get(key);
  };
  for (const [dayIndex, day] of week.days.entries()) {
    const at = { dayIndex, templateId: day.templateId };
    if (day.slots.length < MIN_MAIN_EXERCISES) reasons.push({ code: 'SESSION_EXERCISE_FLOOR_NOT_MET', ...at, slotCount: day.slots.length, floor: MIN_MAIN_EXERCISES });
    const seen = new Set();
    let slotsValid = true;
    for (const [slotIndex, slot] of day.slots.entries()) {
      const where = { ...at, slotIndex, ...(object(slot) && code(slot.exerciseId) ? { exerciseId: slot.exerciseId } : {}) };
      // (a) the resolved-slot contract.
      const valid = validateResolvedSlot(slot);
      if (!valid.ok) { reasons.push({ code: 'INVALID_RESOLVED_SLOT', slotReason: valid.reason, ...where }); slotsValid = false; continue; }
      const p = slot.resolvedPrescription;
      if (p.goal !== goal || p.tier !== tier || p.mode !== mode) reasons.push({ code: 'PRESCRIPTION_CONTEXT_MISMATCH', ...where });
      // (d) same-day uniqueness.
      if (seen.has(slot.exerciseId)) reasons.push({ code: 'DUPLICATE_IN_SESSION', ...where });
      seen.add(slot.exerciseId);
      // (b) still an approved executable candidate (re-enforces beginnerAccess and equipment).
      const pool = eligibleIds(slot.slotKind);
      if (!pool.ok) reasons.push({ code: 'SLOT_ELIGIBILITY_UNRESOLVED', slotReason: pool.reason, ...where });
      else {
        const candidate = pool.byId.get(slot.exerciseId);
        if (!candidate) reasons.push({ code: 'SLOT_NOT_ELIGIBLE', ...where });
        else if (candidate.resolvedPrescription.rowId !== p.rowId
            || candidate.resolvedPrescription.prescriptionRole !== p.prescriptionRole) reasons.push({ code: 'PRESCRIPTION_ROW_MISMATCH', ...where });
      }
      // (c) independent equipment check from the registry record; bodyweight is exempt.
      const record = getExerciseById(slot.exerciseId);
      if (!record) reasons.push({ code: 'UNKNOWN_EXERCISE_ID', ...where });
      else if (!Array.isArray(record.equipment) || record.equipment.length === 0
          || record.equipment.some((token) => typeof token !== 'string')) reasons.push({ code: 'EQUIPMENT_UNKNOWN', ...where });
      else {
        const missing = record.equipment.map((token) => token.toLowerCase()).filter((token) => token !== 'bodyweight' && !owned.has(token));
        if (missing.length) reasons.push({ code: 'EQUIPMENT_NOT_OWNED', missing, ...where });
      }
      // D-3: reviewed beginnerAccess per ID; the live name filter is deliberately not used.
      if (tier === 'beginner' && getReviewedPrescriptionInputs(slot.exerciseId)?.beginnerAccess?.value !== 'allowed')
        reasons.push({ code: 'BEGINNER_ACCESS_NOT_ALLOWED', ...where });
    }
    // (e) raw session time, warm-up once, against the full selected budget.
    if (slotsValid) {
      const seconds = sessionRawSeconds(day, durationMinutes);
      if (typeof seconds !== 'number') reasons.push({ code: 'SESSION_TIMING_UNRESOLVED', slotReason: seconds.reason, ...at });
      else if (seconds > (budget.ok ? budget.budgetSecondsByDay[dayIndex] : durationMinutes * 60) + EPSILON_SECONDS)
        reasons.push({ code: 'SESSION_OVER_BUDGET', ...at, rawSeconds: seconds, budgetSeconds: durationMinutes * 60 });
      if (week.requiredTimeExtension && JSON.stringify(day.timing) !== JSON.stringify(sessionEstimateV3(day, durationMinutes)))
        reasons.push({ code: 'SESSION_ESTIMATE_MISMATCH', ...at });
    }
  }
  return reasons;
}

/** D-4: limitations from FINAL coverage only; allocation.limitations is never copied. */
function finalLimitations(coverage, allocation, template, context) {
  const limitations = [];
  const deficitCache = new Map();
  for (const [key, requirement] of Object.entries(coverage.requirements)) {
    if (requirement.required && requirement.status === 'not_executable') {
      limitations.push({ status: 'limited', requirement: key, reason: 'NOT_EXECUTABLE', coverageReason: requirement.reason });
      continue;
    }
    if (requirement.status !== 'missing') continue;
    const { reason, causes } = classifyDeficitCause(key, allocation.skips, allocation.decisions,
      { ...context, template, target: requirement.target, cache: deficitCache });
    const earlier = causes.length === 0
      ? allocation.limitations.find((entry) => entry?.requirement === key && Array.isArray(entry.slotKinds)) : null;
    limitations.push({ status: 'limited', requirement: key, coverageReason: requirement.reason, reason,
      ...(causes.length ? { causes } : {}), ...(earlier ? { slotKinds: [...earlier.slotKinds] } : {}) });
  }
  return limitations;
}

function noteCodes(volume, repair) {
  const notes = [];
  for (const note of volume.notes) {
    // D8: machine fields only; any display message stays with the copy owner.
    if (note?.type === 'soft_volume_shortfall') notes.push({ code: 'SOFT_VOLUME_SHORTFALL',
      groups: (Array.isArray(note.groups) ? note.groups : []).map(({ group, prescribed, lowerBound }) => ({ group, prescribed, lowerBound })) });
    else notes.push({ code: 'UNRECOGNIZED_VOLUME_NOTE' });
  }
  for (const entry of repair.belowTarget) notes.push({ code: 'BELOW_TARGET_EXERCISE_COUNT', dayIndex: entry.dayIndex,
    templateId: entry.templateId, slotCount: entry.slotCount, target: entry.target });
  if (code(volume.skipped)) notes.push({ code: volume.skipped });
  return notes;
}

// Superset: validated extras (e.g. door_anchor) on top of full_gym still count as full_gym.
const isFullGym = (tokens) => EQUIPMENT_BUCKETS.full_gym.every((token) => tokens.includes(token));

/**
 * { template: buildWeeklyTemplateV3, allocation: 2h, volume: 2j, repair: 2k,
 *   context: { durationMinutes, tier, goal, equipmentContext } }.
 * Returns verdict 'deliver' (status full|limited) or 'not_deliverable' with fallback 'legacy'.
 */
export function deliverV3Shadow(input) {
  try {
    if (!object(input)) return refuse([{ code: 'INVALID_INPUT' }]);
    const { template, allocation, volume, repair, context } = input;
    const requiresPriority = input.requireSlotPriority || input.slotPriority !== undefined || repair?.week?.slotPriorityRequired !== undefined;
    let priorityDiagnostics;
    if (requiresPriority) {
      if (!input.slotPriority?.ok) return refuse([{ code: input.slotPriority?.reason || 'STAGE_MISSING', stage: 'slotPriority',
        ...(Array.isArray(input.slotPriority?.reasons) ? { details: input.slotPriority.reasons } : {}) }]);
    }
    const stageFailures = stageReasons({ template, allocation, volume, repair });
    if (stageFailures.length) return refuse(stageFailures);
    if (requiresPriority) {
      const checked = validateSlotPriorityV3(repair.week, { expectedBaseline: volume.week, required: true, final: true });
      if (!checked.ok) return refuse(checked.reasons?.length ? checked.reasons : [{ code: checked.reason, stage: 'slotPriority' }]);
      priorityDiagnostics = checked.diagnostics;
    }
    const contextResult = contextReasons(context, template);
    if (contextResult.reasons.length) return refuse(contextResult.reasons);
    const { tier, goal } = context;
    const durationMinutes = contextResult.durationMinutes;
    const validatedTemplate = validateWeeklyTemplate(template, { daysPerWeek: context.daysPerWeek, durationMinutes, tier,
      equipmentContext: { ...context.equipmentContext, goal } });
    if (!validatedTemplate.ok) return refuse([{ code: validatedTemplate.reason, stage: 'template',
      ...(validatedTemplate.contextReason ? { contextReason: validatedTemplate.contextReason } : {}),
      ...(validatedTemplate.rebuildReason ? { rebuildReason: validatedTemplate.rebuildReason } : {}) }]);
    const athleteContext = { ...context.equipmentContext, goal };
    const templateLimitations = Array.isArray(template.limitations) ? template.limitations.map((m) => ({ ...m })) : [];
    // Final week = repair.week.
    const week = repair.week;
    const hard = hardCheckReasons(week, template, { durationMinutes, tier, goal, athleteContext });
    if (hard.length) return refuse(hard, { templateLimitations });
    const executabilityCache = input.executabilityCache === undefined ? new Map() : input.executabilityCache;
    const coverage = evaluateWeeklyCoverage(week, { durationMinutes, executabilityCache });
    if (!coverage.ok) return refuse([{ code: 'COVERAGE_UNEVALUABLE', coverageReason: coverage.reason }], { templateLimitations });
    const limitations = finalLimitations(coverage, allocation, template, { goal, tier, mode: coverage.mode, athleteContext });
    const capabilityContext = { goal, tier, mode: coverage.mode, athleteContext: week.equipmentContext };
    const pullLimitation = limitations.find((entry) => entry.requirement === 'pull' && entry.reason === 'NOT_EXECUTABLE');
    if (pullLimitation) {
      const suggestedEquipment = suggestedPullEquipment(capabilityContext);
      if (suggestedEquipment.length) pullLimitation.capabilityReason = {
        code: 'EQUIPMENT_CAPABILITY_LIMITED', requirement: 'pull', pattern: 'pull', suggestedEquipment,
      };
    }
    const diagnostics = priorityDiagnostics ? { slotPriority: priorityDiagnostics } : {};
    // D-5: diagnostic only, never a refusal (template v3 §11 TIME_BUDGET exception).
    if (isFullGym(athleteContext.availableEquipment)) {
      const violations = limitations.filter((l) => l.reason !== 'TIME_BUDGET').map((l) => ({ requirement: l.requirement, reason: l.reason }));
      if (violations.length) diagnostics.activationCriterionViolation = violations;
    }
    return { version: V3_SHADOW_DELIVERY_VERSION, verdict: 'deliver', status: limitations.length ? 'limited' : 'full',
      reasons: limitations.map((l) => ({ code: l.reason, requirement: l.requirement })),
      week, coverage, limitations, templateLimitations,
      notes: [...noteCodes(input.slotPriority ? { ...volume, notes: input.slotPriority.notes } : volume, repair),
        ...accessoryEquipmentNotes(capabilityContext)], diagnostics };
  } catch {
    return refuse([{ code: 'DELIVERY_CHECK_ERROR' }]);
  }
}
