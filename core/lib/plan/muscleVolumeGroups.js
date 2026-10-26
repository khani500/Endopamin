/** Step 2i: prescribed group volume only. Never grants pattern coverage or plan status.
 * Canonical muscle tags reflect the approved per-ID SV-1..SV-5 sweep (migration 032),
 * plus the documented fx_band_pull_apart extension. Excluded/unreviewed IDs fail closed;
 * names, families, mechanic and caller-supplied muscle tags never grant secondary credit.
 */
import { getExerciseById } from '../../data/exerciseRegistryIndex.js';
import { getReviewedPrescriptionInputs, getReviewedDeltHeadMapping } from './reviewedPrescriptionInputs.js';
import { resolvePrescription } from './prescriptionResolver.js';

export const DELT_HEAD_GROUPS = Object.freeze(['front_delts', 'side_delts', 'rear_delts']);
export const MAJOR_GROUPS = Object.freeze(['chest', 'back', 'quadriceps', 'hamstrings', 'glutes', ...DELT_HEAD_GROUPS]);
export const SUPPORTING_GROUPS = Object.freeze(['biceps', 'triceps', 'calves', 'abdominals']);
export const DIAGNOSTIC_MUSCLES = Object.freeze(['abductors', 'adductors', 'forearms', 'lower back', 'neck', 'traps']);
const GROUPS = [...MAJOR_GROUPS, ...SUPPORTING_GROUPS];
const MEMBERS = Object.freeze(Object.fromEntries(GROUPS.map((g) => [g, Object.freeze(DELT_HEAD_GROUPS.includes(g) ? [] : g === 'back' ? ['lats', 'middle back'] : [g])])));
const KNOWN = new Set([...Object.values(MEMBERS).flat(), ...DIAGNOSTIC_MUSCLES]);
const zeros = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
const fail = (reason) => ({ ok: false, reason });
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const empty = () => ({ groups: zeros(GROUPS), diagnostics: {
  muscleTotals: zeros([...KNOWN]), untargeted: zeros(DIAGNOSTIC_MUSCLES), unmapped: [],
} });

/** sets counts complete prescribed sets, once per countBasis, never once per side.
 * Explicit setType: 'warmup' earns zero; absent/'working' means working sets. Day warm-up
 * blocks are outside week.days[].slots and are never traversed. No performed data is read.
 */
export function groupContributionFor(resolvedSlot, sets = resolvedSlot?.sets) {
  if (!object(resolvedSlot)) return fail('INVALID_RESOLVED_SLOT');
  if (!Number.isSafeInteger(sets) || sets < 0) return fail('INVALID_SETS');
  const setType = resolvedSlot.setType;
  if (setType !== undefined && !['working', 'warmup'].includes(setType)) return fail('INVALID_SET_TYPE');
  const result = empty();
  if (setType === 'warmup') return { ok: true, workingSets: 0, ...result };
  const record = getExerciseById(resolvedSlot.exerciseId);
  if (!record) return fail('UNKNOWN_EXERCISE_ID');
  // SV-4: the seven excluded IDs were not cleared by the sweep. No reactivation here.
  if (!getReviewedPrescriptionInputs(record.id) || record.planPolicy?.status === 'excluded')
    return fail('SECONDARY_REVIEW_REQUIRED');
  const p = resolvedSlot.resolvedPrescription;
  if (p?.ok !== true) return fail('PRESCRIPTION_UNRESOLVED');
  if (p.exerciseId !== record.id) return fail('EXERCISE_ID_MISMATCH');
  const approved = resolvePrescription({ exerciseId: record.id, slotKind: resolvedSlot.slotKind,
    goal: p.goal, tier: p.tier, mode: p.mode });
  if (!approved.ok) return fail(approved.reason);
  for (const key of ['pattern', 'intent', 'accessoryKind'])
    if (p.slotKind?.[key] !== approved.slotKind[key]) return fail('SLOT_KIND_MISMATCH');
  for (const key of ['prescriptionRole', 'measure', 'countBasis', 'laterality', 'reviewedInputsVersion'])
    if (p[key] !== approved[key]) return fail('PRESCRIPTION_METADATA_MISMATCH');
  if (resolvedSlot.mode !== p.mode) return fail('MODE_MISMATCH');
  if (sets !== 0 && (sets < approved.sets.min || sets > approved.sets.max)) return fail('SETS_OUTSIDE_ROW');
  const credit = {};
  for (const [field, value] of [['primaryMuscles', 1], ['secondaryMuscles', 0.5]]) {
    const muscles = record[field];
    if (!Array.isArray(muscles) || muscles.length === 0) {
      result.diagnostics.unmapped.push({ field, reason: !Array.isArray(muscles) ? 'MISSING_MUSCLES' : 'EMPTY_MUSCLES' });
      continue;
    }
    for (const muscle of muscles) {
      if (muscle === 'shoulders') continue; // Generic tag never assigns a head or a summed V3 total.
      if (!KNOWN.has(muscle)) {
        result.diagnostics.unmapped.push({ field, value: muscle, reason: 'UNRECOGNIZED_MUSCLE' });
        continue;
      }
      // Primary wins overlaps; duplicate tags never add credit.
      credit[muscle] = Math.max(credit[muscle] || 0, value);
    }
  }
  for (const muscle of KNOWN) result.diagnostics.muscleTotals[muscle] = (credit[muscle] || 0) * sets;
  for (const group of GROUPS)
    result.groups[group] = MEMBERS[group].length ? Math.max(...MEMBERS[group].map((muscle) => credit[muscle] || 0)) * sets : 0;
  if ([record.primaryMuscles, record.secondaryMuscles].some((m) => Array.isArray(m) && m.includes('shoulders'))) {
    const mapping = getReviewedDeltHeadMapping(record.id);
    if (mapping?.status === 'approved') for (const head of DELT_HEAD_GROUPS) result.groups[head] = mapping.credits[head] * sets;
    else result.diagnostics.unmapped.push({ field: 'deltHeadMapping', value: record.id, reason: mapping?.ruleId || 'DELT_HEAD_MAPPING_MISSING' });
  }
  for (const muscle of DIAGNOSTIC_MUSCLES)
    result.diagnostics.untargeted[muscle] = result.diagnostics.muscleTotals[muscle];
  return { ok: true, exerciseId: record.id, workingSets: sets, ...result };
}

/** Sum per-slot maxima, never a maximum or sum of weekly lats/middle-back totals. */
export function weeklyPrescribedGroupTotals(week) {
  if (!object(week) || !Array.isArray(week.days)) return fail('INVALID_WEEK');
  const result = empty();
  let workingSets = 0;
  for (const [dayIndex, day] of week.days.entries()) {
    if (!object(day) || !Array.isArray(day.slots)) return fail('INVALID_DAY');
    for (const [slotIndex, slot] of day.slots.entries()) {
      const contribution = groupContributionFor(slot, slot?.sets);
      if (!contribution.ok) return { ...contribution, dayIndex, slotIndex };
      workingSets += contribution.workingSets;
      for (const group of GROUPS) result.groups[group] += contribution.groups[group];
      for (const muscle of KNOWN) result.diagnostics.muscleTotals[muscle] += contribution.diagnostics.muscleTotals[muscle];
      for (const muscle of DIAGNOSTIC_MUSCLES) result.diagnostics.untargeted[muscle] += contribution.diagnostics.untargeted[muscle];
      result.diagnostics.unmapped.push(...contribution.diagnostics.unmapped.map((entry) => ({ dayIndex, slotIndex, ...entry })));
    }
  }
  return { ok: true, ledger: 'prescribed', workingSets, totals: result.groups, diagnostics: result.diagnostics };
}
