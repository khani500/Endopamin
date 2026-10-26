// V3 is an additive contract. Legacy thresholds, target seeds and assessment stay in volumePrescription.js.
import { MAJOR_GROUPS, SUPPORTING_GROUPS, DELT_HEAD_GROUPS } from './muscleVolumeGroups.js';

/** Prescription table v2 §5: soft group ranges, never completeness floors or hard caps.
 * No priority bonus, capacity scaling, habitual inference or independent back-muscle targets.
 * SUPPORTING groups remain tracked without a target, including priority/template work.
 */
export function buildVolumePrescriptionV3({ goal, tier } = {}) {
  if (!['muscle_gain', 'fat_loss', 'endurance'].includes(goal)) return { ok: false, reason: 'INVALID_GOAL' };
  if (!['beginner', 'intermediate', 'advanced'].includes(tier)) return { ok: false, reason: 'INVALID_TIER' };
  const min = goal === 'endurance' || tier === 'beginner' ? 8 : 12;
  const max = min === 8 ? 12 : 20;
  return { ok: true, version: 'group-volume-prescription.v3', goal, tier,
    groups: Object.fromEntries([...MAJOR_GROUPS, ...SUPPORTING_GROUPS].map((group) => [group, {
      group, tier: MAJOR_GROUPS.includes(group) ? 'MAJOR' : 'SUPPORTING',
      target: DELT_HEAD_GROUPS.includes(group) ? { min: tier === 'beginner' ? 4 : 6, max: tier === 'beginner' ? 8 : 12 }
        : MAJOR_GROUPS.includes(group) ? { min, max } : null,
      mandatory: false,
    }])) };
}
