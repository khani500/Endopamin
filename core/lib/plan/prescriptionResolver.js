/**
 * Prescription table draft v2, §§1–4 and §8. Pure and dormant until explicitly wired.
 * Resolving a row is not a pin, equipment/injury clearance or timing estimate.
 */
import {
  getReviewedPrescriptionInputs,
  REVIEWED_PRESCRIPTION_INPUTS_VERSION,
  REVIEWED_PRESCRIPTION_INPUTS_SOURCES,
} from './reviewedPrescriptionInputs.js';

export const PRESCRIPTION_RESOLVER_VERSION = 'prescription-resolver.v1';
const GOALS = ['muscle_gain', 'fat_loss', 'endurance'];
const TIERS = ['beginner', 'intermediate', 'advanced'];
const MODES = ['standard', 'short_session'];
const STRUCTURAL = ['SQ', 'HG', 'LU', 'HPU', 'HPL', 'VPU', 'VPL'];
const ACCESSORIES = ['biceps', 'triceps', 'lateral_delts', 'rear_delts', 'calves', 'ham_knee_flexion', 'glutes'];
const fail = (reason) => ({ ok: false, reason });
const range = (min, max) => ({ min, max });
const pair = ([min, max]) => range(min, max);
const validRange = (value, integer = false) => value && Number.isFinite(value.min) && Number.isFinite(value.max)
  && value.min > 0 && value.max >= value.min && (!integer || (Number.isInteger(value.min) && Number.isInteger(value.max)));

function slotKey(slot) {
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return null;
  const keys = Object.keys(slot).sort().join(',');
  if (STRUCTURAL.includes(slot.pattern) && ['structural_primary', 'structural_secondary'].includes(slot.intent)
      && keys === 'intent,pattern') return slot.pattern + '/' + slot.intent;
  if (slot.pattern === 'CORE' && slot.intent === 'core' && keys === 'intent,pattern') return 'CORE/core';
  if (slot.pattern === 'ACC' && slot.intent === 'accessory' && ACCESSORIES.includes(slot.accessoryKind)
      && keys === 'accessoryKind,intent,pattern') return 'ACC/accessory/' + slot.accessoryKind;
  return null;
}

// Rows: reps, sets by B/I/A, rest, RIR by B/I/A. No role or goal defaults.
const GAIN = {
  primary: [[6, 10], [[2, 3], [3, 4], [3, 4]], [120, 180], [[2, 3], [1, 3], [1, 2]]],
  accessory_compound: [[8, 12], [[2, 3], [3, 3], [3, 4]], [90, 120], [[2, 3], [1, 2], [1, 2]]],
  isolation: [[10, 15], [[2, 3], [3, 3], [3, 3]], [60, 90], [[2, 3], [1, 2], [1, 2]]],
};
const ENDURANCE = {
  primary: [[10, 15], [[2, 3], [3, 3], [3, 3]], [60, 90], [[2, 3], [2, 3], [2, 3]]],
  accessory_compound: [[12, 20], [[2, 3], [3, 3], [3, 3]], [45, 75], [[2, 3], [2, 3], [2, 3]]],
  isolation: [[15, 20], [[2, 3], [3, 3], [3, 3]], [30, 60], [[2, 3], [2, 3], [2, 3]]],
};

function baseRow(role, measure, goal, tierIndex) {
  if (role === 'core') return {
    sets: pair([[2, 2], [2, 3], [3, 3]][tierIndex]),
    reps: measure === 'reps' ? range(10, 15) : null,
    durationSeconds: measure === 'duration' ? pair([[20, 30], [30, 45], [30, 60]][tierIndex]) : null,
    restSeconds: range(45, 60),
    targetRir: measure === 'reps' ? range(2, 3) : null,
    techniqueStops: measure === 'duration' ? ['Stop when your form starts to break.'] : [],
  };
  const row = (goal === 'endurance' ? ENDURANCE : GAIN)[role];
  if (!row || measure !== 'reps') return null;
  return {
    sets: pair(row[1][tierIndex]), reps: pair(row[0]), durationSeconds: null,
    restSeconds: pair(row[2]), targetRir: pair(row[3][tierIndex]), techniqueStops: [],
  };
}

function approvedException(value, role, goal, tier, mode) {
  if (!value || value.role !== role || !Array.isArray(value.ruleIds) || value.ruleIds.length === 0
      || !value.ruleIds.every((id) => ['E1', 'E2', 'E3', 'E5', 'E6', 'E7'].includes(id))) return null;
  const numbers = value.valuesByGoalAndTier?.[goal]?.[tier]?.[mode];
  if (!numbers) return null;
  const result = {
    sets: range(numbers.setsMin, numbers.setsMax),
    reps: range(numbers.repsMin, numbers.repsMax),
    restSeconds: range(numbers.restSecMin, numbers.restSecMax),
    targetRir: range(numbers.targetRirMin, numbers.targetRirMax),
  };
  if (!validRange(result.sets, true) || !validRange(result.reps, true)
      || !validRange(result.restSeconds) || !validRange(result.targetRir) || result.targetRir.max > 4) return null;
  if (mode === 'short_session' && (result.sets.min !== 2 || result.sets.max !== 2
      || result.restSeconds.min !== result.restSeconds.max)) return null;
  if (value.ruleIds.some((id) => id === 'E3' || id === 'E5')
      && (typeof numbers.techniqueStop !== 'string' || !numbers.techniqueStop || numbers.rirIsSupplementary !== true)) return null;
  if (value.ruleIds.includes('E7') && (numbers.endpoint !== 'rir_or_ceiling'
      || numbers.ceiling !== 20 || numbers.repsMax !== 20 || numbers.effortTargetMayBeUnmet !== true
      || numbers.repRangeIsCeiling !== true || numbers.stopBeforeRepsMinAllowed !== true)) return null;
  return { ranges: result, numbers, ruleIds: value.ruleIds };
}

export function resolvePrescription(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_INPUT');
  const { exerciseId, slotKind, goal, tier, mode } = input;
  if (typeof exerciseId !== 'string' || !exerciseId) return fail('INVALID_EXERCISE_ID');
  if (!GOALS.includes(goal)) return fail('INVALID_GOAL');
  if (!TIERS.includes(tier)) return fail('INVALID_TIER');
  if (!MODES.includes(mode)) return fail('INVALID_MODE');
  const key = slotKey(slotKind);
  if (!key) return fail('INVALID_SLOT_KIND');
  const reviewed = getReviewedPrescriptionInputs(exerciseId);
  if (!reviewed) return fail('UNKNOWN_EXERCISE_ID');
  if (reviewed.blockedByDataDefect !== false) return fail('DATA_DEFECT_UNRESOLVED');
  for (const field of ['measure', 'countBasis', 'laterality']) {
    if (reviewed.reviewStatus[field] !== 'approved') return fail('UNAPPROVED_' + field.toUpperCase());
  }
  if (!['reps', 'duration'].includes(reviewed.measure)) return fail('UNSUPPORTED_MEASURE');
  if (!['compound', 'isolation', 'static', 'undetermined'].includes(reviewed.mechanic)
      || !['approved', 'open'].includes(reviewed.reviewStatus.mechanic)) return fail('MISSING_MECHANIC_CONTRACT');
  const counting = reviewed.laterality + '/' + reviewed.countBasis;
  if (!['bilateral/not_applicable', 'unilateral/per_side', 'alternating/per_side', 'alternating/total'].includes(counting)) return fail('UNSUPPORTED_COUNTING_CONTRACT');
  // Mechanic is preserved, not inferred. Approved 2026-10-13: role resolution can
  // succeed while mechanic is open; a later timing consumer must gate it separately.
  const entry = reviewed.eligibility.find((candidate) => slotKey(candidate.slotKind) === key);
  if (!entry) return fail('SLOT_KIND_NOT_REVIEWED');
  if (entry.reviewStatus !== 'approved') return fail('SLOT_KIND_UNAPPROVED');
  if (entry.movementEligibility !== 'eligible') return fail('SLOT_KIND_INELIGIBLE');
  if (!['allowed', 'not_allowed'].includes(reviewed.beginnerAccess?.value)) return fail('BEGINNER_ACCESS_UNREVIEWED');
  if (tier === 'beginner' && reviewed.beginnerAccess.value !== 'allowed') return fail('BEGINNER_NOT_ALLOWED');
  const role = entry.prescriptionRole;
  const roleMatches = slotKind.intent === 'structural_primary' ? role === 'primary'
    : slotKind.intent === 'core' ? role === 'core' : ['accessory_compound', 'isolation'].includes(role);
  if (!roleMatches) return fail('PRESCRIPTION_ROLE_UNAPPROVED');
  const row = baseRow(role, reviewed.measure, goal, TIERS.indexOf(tier));
  if (!row) return fail('ROLE_MEASURE_NO_PATH');
  if (!Array.isArray(entry.dependencies)) return fail('MISSING_DEPENDENCIES');
  const provenance = [];
  const approved = [];
  for (const [dependencyIndex, dependency] of entry.dependencies.entries()) {
    const e7 = dependency.type === 'RESISTANCE_ADJUSTMENT'
      && dependency.approvedValue?.ruleIds?.length === 1 && dependency.approvedValue.ruleIds[0] === 'E7';
    if (dependency.type !== 'SECTION8_EXCEPTION' && !e7) return fail('DEPENDENCY_UNRESOLVED_' + dependency.type);
    if (dependency.type === 'SECTION8_EXCEPTION' && dependency.approvedValue?.ruleIds?.includes('E7')) return fail('EXCEPTION_VALUE_MISSING_OR_INVALID');
    if (dependency.applicability !== 'applies') return fail('EXCEPTION_APPLICABILITY_UNRESOLVED');
    if (dependency.status !== 'resolved_by_value') return fail('EXCEPTION_VALUE_UNAPPROVED');
    const exception = approvedException(dependency.approvedValue, role, goal, tier, mode);
    if (!exception) return fail('EXCEPTION_VALUE_MISSING_OR_INVALID');
    approved.push(exception);
    provenance.push({ dependencyIndex, ruleIds: [...exception.ruleIds], applicability: dependency.applicability, status: dependency.status });
  }
  if (entry.prescriptionFit !== 'fits') return fail('PRESCRIPTION_FIT_UNRESOLVED');
  // v8+ encodes the final combined ranges per dependency, including E1/E5.
  // Every dependency must agree: never choose one incompatible exception over another.
  if (approved.length) {
    const signature = JSON.stringify(approved[0].ranges);
    if (approved.some((exception) => JSON.stringify(exception.ranges) !== signature)) return fail('EXCEPTION_VALUES_CONFLICT');
    Object.assign(row, approved[0].ranges);
  }
  const techniqueStops = [...new Set([...row.techniqueStops, ...approved.flatMap((exception) =>
    typeof exception.numbers.techniqueStop === 'string' ? [exception.numbers.techniqueStop] : [])])];
  const finishCues = [...new Set(approved.flatMap((exception) =>
    typeof exception.numbers.finish === 'string' ? [exception.numbers.finish] : []))];
  if (mode === 'short_session') row.sets = range(2, 2);
  const planningRestSeconds = mode === 'short_session' ? row.restSeconds.min : (row.restSeconds.min + row.restSeconds.max) / 2;
  // Preserve the approved rest range for storage/display even in short mode.
  // Artifact short-mode values record the chosen lower-bound rest, not a new range.
  if (mode === 'short_session' && approved.length) {
    const standard = entry.dependencies.map((dependency) => approvedException(dependency.approvedValue, role, goal, tier, 'standard'));
    if (standard.some((exception) => !exception)) return fail('EXCEPTION_STANDARD_RANGE_MISSING');
    if (standard.some((exception) => exception.ranges.restSeconds.min !== planningRestSeconds)) return fail('EXCEPTION_REST_FLOOR_CONFLICT');
    row.restSeconds = { ...standard[0].ranges.restSeconds };
  }
  return {
    ok: true,
    version: PRESCRIPTION_RESOLVER_VERSION,
    reviewedInputsVersion: REVIEWED_PRESCRIPTION_INPUTS_VERSION,
    exerciseId, slotKind: { ...slotKind }, goal, tier, mode,
    rowId: 'prescription-v2/' + goal + '/' + role + '/' + reviewed.measure + '/' + tier + '/' + mode,
    prescriptionRole: role,
    measure: reviewed.measure, countBasis: reviewed.countBasis, laterality: reviewed.laterality,
    mechanic: reviewed.mechanic, reviewStatus: { ...reviewed.reviewStatus },
    sets: row.sets, reps: row.reps, durationSeconds: row.durationSeconds,
    restSeconds: row.restSeconds, planningRestSeconds, targetRir: row.targetRir,
    effort: row.targetRir === null ? 'technique_stop' : approved.some((exception) => exception.numbers.rirIsSupplementary === true) ? 'rir_supplementary' : 'target_rir',
    repRangeIsCeiling: approved.some((exception) => exception.numbers.repRangeIsCeiling === true),
    stopBeforeRepsMinAllowed: approved.some((exception) => exception.numbers.stopBeforeRepsMinAllowed === true),
    ...(approved.some((exception) => exception.ruleIds.includes('E7')) ? {
      endpoint: 'rir_or_ceiling', ceiling: 20, effortTargetMayBeUnmet: true,
    } : {}),
    techniqueStops, finishCues,
    exceptionProvenance: [...provenance, ...entry.exceptionDecisions.map((decision) => ({ ...decision }))],
    sources: REVIEWED_PRESCRIPTION_INPUTS_SOURCES.map((source) => ({ ...source })),
  };
}
