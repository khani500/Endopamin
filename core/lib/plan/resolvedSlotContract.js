/** Step 2g: dormant resolved-slot boundary; eligibility belongs to slotEligibility. */
import { validateSlotKind } from './slotEligibility.js';
import { estimateSlotSeconds, estimateSessionSeconds, warmupSeconds, fitsSessionBudget } from './sessionTiming.js';

const refuse = (reason) => ({ ok: false, reason });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.length > 0;
const range = (value) => object(value) && Number.isFinite(value.min) && Number.isFinite(value.max)
  && value.min > 0 && value.max >= value.min;
const strings = (value) => Array.isArray(value) && value.every(text);
const FIELDS = ['version', 'reviewedInputsVersion', 'exerciseId', 'slotKind', 'goal', 'tier', 'mode',
  'rowId', 'prescriptionRole', 'measure', 'countBasis', 'laterality', 'mechanic', 'reviewStatus',
  'sets', 'reps', 'durationSeconds', 'restSeconds', 'planningRestSeconds', 'targetRir', 'effort',
  'repRangeIsCeiling', 'stopBeforeRepsMinAllowed', 'techniqueStops', 'finishCues', 'exceptionProvenance', 'sources'];

/** Validate, never reconstruct or mutate the caller's full successful resolver packet. */
export function validateResolvedSlot(slot) {
  if (!object(slot)) return refuse('INVALID_RESOLVED_SLOT');
  const kind = validateSlotKind(slot.slotKind);
  if (!kind.ok) return kind;
  const p = slot.resolvedPrescription;
  if (p?.ok !== true) return refuse('PRESCRIPTION_UNRESOLVED');
  if (!object(p) || FIELDS.some((key) => !Object.hasOwn(p, key))) return refuse('PRESCRIPTION_METADATA_INCOMPLETE');
  const prescribedKind = validateSlotKind(p.slotKind);
  if (!prescribedKind.ok || ['pattern', 'intent', 'accessoryKind'].some((key) => slot.slotKind[key] !== p.slotKind[key]))
    return refuse('SLOT_KIND_MISMATCH');
  if (!text(slot.exerciseId) || slot.exerciseId !== p.exerciseId) return refuse('EXERCISE_ID_MISMATCH');
  if (!['standard', 'short_session'].includes(slot.mode)) return refuse('INVALID_MODE');
  if (slot.mode !== p.mode) return refuse('MODE_MISMATCH');
  if (!['version', 'reviewedInputsVersion', 'rowId', 'effort'].every((key) => text(p[key]))
      || !['muscle_gain', 'fat_loss', 'endurance'].includes(p.goal)
      || !['beginner', 'intermediate', 'advanced'].includes(p.tier)
      || !object(p.reviewStatus) || !['measure', 'countBasis', 'laterality', 'mechanic'].every((key) => text(p.reviewStatus[key]))
      || !text(p.mechanic) || !['technique_stop', 'rir_supplementary', 'target_rir'].includes(p.effort)
      || !Number.isFinite(p.planningRestSeconds) || p.planningRestSeconds <= 0
      || (p.targetRir !== null && !range(p.targetRir))
      || typeof p.repRangeIsCeiling !== 'boolean' || typeof p.stopBeforeRepsMinAllowed !== 'boolean'
      || !strings(p.techniqueStops) || !strings(p.finishCues)
      || !Array.isArray(p.exceptionProvenance) || !p.exceptionProvenance.every(object)
      || !Array.isArray(p.sources) || p.sources.length === 0
      || !p.sources.every((source) => object(source) && text(source.file) && /^[a-f0-9]{64}$/.test(source.sha256) && text(source.decisionVersion))
      || (p.measure === 'reps' ? p.durationSeconds !== null : p.reps !== null))
    return refuse('PRESCRIPTION_METADATA_INVALID');
  const estimate = estimateSlotSeconds(p, slot.sets, { mode: slot.mode });
  return typeof estimate === 'number' ? { ok: true, slot } : estimate;
}

/** Raw numeric seconds on success; a specific refusal on failure, like sessionTiming. */
export function slotRawSeconds(slot) {
  const validation = validateResolvedSlot(slot);
  return validation.ok ? estimateSlotSeconds(slot.resolvedPrescription, slot.sets, { mode: slot.mode }) : validation;
}

/** session.slots contains resolved main slots only; warm-up is delegated exactly once. */
export function sessionRawSeconds(session, durationMinutes) {
  const warmup = warmupSeconds(durationMinutes);
  if (typeof warmup !== 'number') return warmup;
  if (!object(session) || !Array.isArray(session.slots)) return refuse('INVALID_RESOLVED_SESSION');
  const mode = durationMinutes === 15 ? 'short_session' : 'standard';
  const estimates = [];
  for (const slot of session.slots) {
    const seconds = slotRawSeconds(slot);
    if (typeof seconds !== 'number') return seconds;
    if (slot.mode !== mode) return refuse('SESSION_MODE_MISMATCH');
    estimates.push(seconds);
  }
  return estimateSessionSeconds(estimates, durationMinutes);
}

/** Recompute the combined session; no cached totals, rounded minutes or second warm-up. */
export function canPlaceResolvedSlot(session, slot, durationMinutes) {
  const validation = validateResolvedSlot(slot);
  if (!validation.ok) return validation;
  if (!object(session) || !Array.isArray(session.slots)) return refuse('INVALID_RESOLVED_SESSION');
  const seconds = sessionRawSeconds({ ...session, slots: [...session.slots, slot] }, durationMinutes);
  return typeof seconds === 'number' ? fitsSessionBudget(seconds, durationMinutes) : seconds;
}
