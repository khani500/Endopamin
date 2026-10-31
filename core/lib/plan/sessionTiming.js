/**
 * Session timing contract v1, T1–T5/T7. Standalone; no runtime consumers yet.
 * Numeric results are raw seconds (budget checks return a boolean). Failures
 * are { ok: false, reason }; callers must check them before using a result.
 * Prescriptions must already contain the resolver's final approved §8 values.
 * These accounting estimates are not tempo cues or measured time guarantees.
 */
import { sessionDurationPolicyV3 } from './sessionDurationV3.js';

const fail = (reason) => ({ ok: false, reason });
const MODES = ['standard', 'short_session'];
const RAW_SECONDS_EPSILON = 60 * 1e-9; // Contract's 1e-9 minutes, converted once.
const TRANSITION_SECONDS = 60;

function validRange(value, integer = false) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Number.isFinite(value.min) && Number.isFinite(value.max)
    && value.min > 0 && value.max >= value.min
    && (!integer || (Number.isSafeInteger(value.min) && Number.isSafeInteger(value.max)));
}

/** One main exercise, including exactly one transition even for the last slot. */
export function estimateSlotSeconds(resolvedPrescription, sets, options) {
  if (resolvedPrescription?.ok !== true) return fail('PRESCRIPTION_UNRESOLVED');
  const mode = options?.mode;
  if (!MODES.includes(mode)) return fail('INVALID_MODE');
  if (resolvedPrescription.mode !== mode) return fail('MODE_MISMATCH');
  const p = resolvedPrescription;
  if (!validRange(p.sets, true)) return fail('SETS_RANGE_MISSING_OR_INVALID');
  if (!Number.isSafeInteger(sets) || sets < p.sets.min || sets > p.sets.max) return fail('SETS_OUTSIDE_ROW');
  if (mode === 'short_session' && (sets !== 2 || p.sets.min !== 2 || p.sets.max !== 2)) return fail('SHORT_SESSION_SETS_INVALID');
  if (!['primary', 'accessory_compound', 'isolation', 'core'].includes(p.prescriptionRole)) return fail('PRESCRIPTION_ROLE_UNSUPPORTED');
  if (p.measure === undefined || p.measure === null) return fail('MEASURE_MISSING');
  if (!['reps', 'duration'].includes(p.measure)) return fail('MEASURE_UNSUPPORTED');
  if (p.reviewStatus?.measure !== 'approved') return fail('MEASURE_UNAPPROVED');
  if (p.countBasis === undefined || p.countBasis === null) return fail('COUNT_BASIS_MISSING');
  if (p.laterality === undefined || p.laterality === null) return fail('LATERALITY_MISSING');
  if (p.reviewStatus?.countBasis !== 'approved' || p.reviewStatus?.laterality !== 'approved') return fail('COUNTING_UNAPPROVED');
  const counting = p.laterality + '/' + p.countBasis;
  if (!['bilateral/not_applicable', 'unilateral/per_side', 'alternating/per_side', 'alternating/total'].includes(counting)) return fail('UNSUPPORTED_COUNTING_CONTRACT');
  if (!validRange(p.restSeconds)) return fail('REST_RANGE_MISSING_OR_INVALID');
  const rest = mode === 'short_session' ? p.restSeconds.min : p.restSeconds.min + (p.restSeconds.max - p.restSeconds.min) / 2;

  let work;
  if (p.measure === 'duration') {
    if (p.prescriptionRole !== 'core') return fail('ROLE_MEASURE_NO_PATH');
    if (!validRange(p.durationSeconds)) return fail('DURATION_RANGE_MISSING_OR_INVALID');
    work = p.durationSeconds.max;
  } else {
    if (!validRange(p.reps, true)) return fail('REPS_RANGE_MISSING_OR_INVALID');
    if (p.prescriptionRole === 'core') work = p.reps.max * 3;
    else {
      if (p.reviewStatus?.mechanic !== 'approved' || !['compound', 'isolation'].includes(p.mechanic)) return fail('MECHANIC_UNRESOLVED');
      work = p.reps.max * (p.mechanic === 'compound' ? 4 : 3);
    }
  }
  if (p.countBasis === 'per_side') work *= 2;
  if (p.laterality === 'unilateral') work += 10;
  const seconds = sets * work + (sets - 1) * rest + TRANSITION_SECONDS;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fail('ESTIMATE_NONFINITE');
}

/** Total preparation allowance, including ramp-up; no separate surcharge. */
export function warmupSeconds(selectedMinutes) {
  return sessionDurationPolicyV3(selectedMinutes)?.warmupSeconds ?? fail('UNSUPPORTED_DURATION');
}

/** Main-slot estimates only. Optional cooldown is outside this API/promise. */
export function estimateSessionSeconds(slotEstimates, selectedMinutes) {
  const warmup = warmupSeconds(selectedMinutes);
  if (typeof warmup !== 'number') return warmup;
  if (!Array.isArray(slotEstimates)) return fail('SLOT_ESTIMATES_INVALID');
  let seconds = warmup;
  for (const slot of slotEstimates) {
    if (slot?.ok === false && typeof slot.reason === 'string' && slot.reason.length > 0) return fail(slot.reason);
    if (typeof slot !== 'number' || !Number.isFinite(slot) || slot <= 0) return fail('SLOT_ESTIMATE_INVALID');
    seconds += slot;
    if (!Number.isFinite(seconds)) return fail('ESTIMATE_NONFINITE');
  }
  return seconds;
}

/** Unrounded promise budget; no ±2-minute product-expectation buffer. */
export function fitsSessionBudget(estimateSeconds, selectedMinutes) {
  const warmup = warmupSeconds(selectedMinutes);
  if (typeof warmup !== 'number') return warmup;
  if (typeof estimateSeconds !== 'number' || !Number.isFinite(estimateSeconds) || estimateSeconds <= 0) return fail('INVALID_ESTIMATE_SECONDS');
  return estimateSeconds - selectedMinutes * 60 <= RAW_SECONDS_EPSILON;
}
