/** Step 2d: pure, dormant slot eligibility. No equipment, injury or activation clearance. */
import { getHardEligibleExercisePoolForSlot } from './exerciseResolver.v2.js';
import { resolvePrescription } from './prescriptionResolver.js';
import {
  REVIEWED_PRESCRIPTION_INPUTS_VERSION,
  REVIEWED_PRESCRIPTION_INPUTS_SOURCES,
} from './reviewedPrescriptionInputs.js';

const STRUCTURAL = ['SQ', 'HG', 'LU', 'HPU', 'HPL', 'VPU', 'VPL'];
const ACCESSORIES = ['biceps', 'triceps', 'lateral_delts', 'rear_delts', 'calves', 'ham_knee_flexion', 'glutes'];
const refuse = (reason) => ({ ok: false, reason });

/** Closed authored schema. No inferred intent, alias, accessory kind or extra keys. */
export function validateSlotKind(slotKind) {
  if (!slotKind || typeof slotKind !== 'object' || Array.isArray(slotKind)) return refuse('INVALID_SLOT_KIND');
  const keys = Reflect.ownKeys(slotKind);
  if (keys.some((key) => typeof key !== 'string')) return refuse('INVALID_SLOT_KIND');
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(slotKind, key));
  if (descriptors.some((d) => !d.enumerable || !Object.hasOwn(d, 'value'))) return refuse('INVALID_SLOT_KIND');
  const shape = keys.sort().join(',');
  const valid = STRUCTURAL.includes(slotKind.pattern)
    ? ['structural_primary', 'structural_secondary'].includes(slotKind.intent) && shape === 'intent,pattern'
    : slotKind.pattern === 'CORE'
      ? slotKind.intent === 'core' && shape === 'intent,pattern'
      : slotKind.pattern === 'ACC' && slotKind.intent === 'accessory'
        && ACCESSORIES.includes(slotKind.accessoryKind) && shape === 'accessoryKind,intent,pattern';
  return valid ? { ok: true, slotKind: { ...slotKind } } : refuse('INVALID_SLOT_KIND');
}

/** Track C hook: pass-through metadata only. Insufficient information is never clearance. */
export function trackCPreSelection() {
  return { decision: 'insufficient_information', note: 'injury enforcement not implemented' };
}

/**
 * Hard pool intersected with approved per-ID prescription eligibility (including beginnerAccess).
 * tier is authoritative; a conflicting athleteContext.athleteTier is refused, never overridden.
 * athleteContext carries canonical equipment tokens including validated extras, as required by 2c.
 * Optional timingCheck(resolvedPrescription) must be pure and synchronous, returning a boolean
 * or { ok: boolean, reason?: string }. Failures retain their specific reason; no timing defaults.
 * Returned candidates are prescription-qualified only; Track C remains insufficient_information.
 */
export function resolveSlotCandidates(input) {
  const fail = (reason) => ({ ...refuse(reason), candidates: [], rejections: [] });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_INPUT');
  const { slotKind, goal, tier, mode, athleteContext, timingCheck } = input;
  const validated = validateSlotKind(slotKind);
  if (!validated.ok) return fail(validated.reason);
  if (!['muscle_gain', 'fat_loss', 'endurance'].includes(goal)) return fail('INVALID_GOAL');
  if (!['beginner', 'intermediate', 'advanced'].includes(tier)) return fail('INVALID_TIER');
  if (!['standard', 'short_session'].includes(mode)) return fail('INVALID_MODE');
  if (!athleteContext || typeof athleteContext !== 'object' || Array.isArray(athleteContext)) return fail('INVALID_ATHLETE_CONTEXT');
  if (athleteContext.athleteTier !== undefined && athleteContext.athleteTier !== tier) return fail('TIER_CONTEXT_MISMATCH');
  if (timingCheck !== undefined && typeof timingCheck !== 'function') return fail('INVALID_TIMING_CHECK');
  let discovery;
  try {
    discovery = getHardEligibleExercisePoolForSlot({ ...athleteContext, slotKind: validated.slotKind, athleteTier: tier });
  } catch {
    return fail('INVALID_ATHLETE_CONTEXT');
  }
  const candidates = [];
  const rejections = discovery.rejections.map((r) => ({ ...r, stage: 'hard' }));
  for (const record of discovery.pool) {
    const exerciseId = record.id;
    // resolvePrescription is the sole authority for role, beginnerAccess and dependency values.
    const resolvedPrescription = resolvePrescription({ exerciseId, slotKind: validated.slotKind, goal, tier, mode });
    if (!resolvedPrescription.ok) {
      rejections.push({ exerciseId, stage: 'prescription', reason: resolvedPrescription.reason });
      continue;
    }
    if (timingCheck) {
      let result;
      try { result = timingCheck(resolvedPrescription); }
      catch { result = { ok: false, reason: 'TIMING_CHECK_ERROR' }; }
      const accepted = result === true || (result && result.ok === true && typeof result.then !== 'function');
      if (!accepted) {
        const rejected = result === false || (result && result.ok === false && typeof result.then !== 'function');
        const reason = rejected
          ? (typeof result?.reason === 'string' && result.reason ? result.reason : 'TIMING_UNRESOLVABLE')
          : 'TIMING_CHECK_INVALID_RESULT';
        rejections.push({ exerciseId, stage: 'timing', reason });
        continue;
      }
    }
    candidates.push({
      exerciseId, resolvedPrescription,
      provenance: {
        reviewedInputsVersion: REVIEWED_PRESCRIPTION_INPUTS_VERSION,
        sources: REVIEWED_PRESCRIPTION_INPUTS_SOURCES,
      },
      trackC: trackCPreSelection(),
    });
  }
  return { ok: true, candidates, rejections, trackC: trackCPreSelection() };
}
