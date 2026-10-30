/** Informational equipment diagnostics only; never changes selection or coverage. */
import { getExerciseById } from '../../data/exerciseRegistryIndex.js';
import { EQUIPMENT_BUCKETS, EQUIPMENT_EXTRA_TOKENS } from './equipmentContract.js';
import { resolveSlotCandidates } from './slotEligibility.js';
import { coverageCreditForSlot } from './weeklyCoverageV3.js';

const TOKENS = [...new Set([...Object.values(EQUIPMENT_BUCKETS).flat(), ...EQUIPMENT_EXTRA_TOKENS])].sort();
const PULL_KINDS = ['HPL', 'VPL'].flatMap((pattern) =>
  ['structural_primary', 'structural_secondary'].map((intent) => ({ pattern, intent })));
const canonicalCompare = (a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
const eligible = (context, slotKind, availableEquipment) => resolveSlotCandidates({
  slotKind, goal: context.goal, tier: context.tier, mode: context.mode, athleteContext: { ...context.athleteContext, availableEquipment },
}).candidates;
const pullCandidates = (context, tokens) => PULL_KINDS.flatMap((kind) => eligible(context, kind, tokens))
  .filter((candidate) => coverageCreditForSlot(candidate).credits?.pull === 1);

/** Missing tokens from Registry records, replayed through the exact profile and roles.
 * A currently executable pull (even unselected) is never an equipment limitation.
 * Registry equipment is authoritative: bands do not imply a door anchor.
 * Only the equipment contract's one-way door_anchor -> bands constraint is added.
 * Minimal means no retained set has a proper subset that is also a valid suggestion.
 */
export function suggestedPullEquipment(context) {
  const owned = context.athleteContext.availableEquipment;
  if (pullCandidates(context, owned).length) return [];
  const proposals = new Map();
  // Discover with all canonical capabilities, preserving every other eligibility gate.
  const candidates = pullCandidates(context, TOKENS);
  for (const candidate of candidates) {
    const record = getExerciseById(candidate.exerciseId);
    if (!Array.isArray(record?.equipment) || !record.equipment.length) continue;
    const required = new Set(record.equipment);
    if ([...required].some((token) => !TOKENS.includes(token))) continue;
    if (required.has('door_anchor')) required.add('bands');
    const missing = [...required].filter((token) => token !== 'bodyweight' && !owned.includes(token)).sort();
    if (!missing.length || missing.length > 2) continue;
    proposals.set(JSON.stringify(missing), missing);
  }
  const valid = [...proposals.values()].filter((set) => pullCandidates(context, [...owned, ...set]).length > 0);
  const minimal = valid.filter((set) => !valid.some((other) => other.length < set.length && other.every((token) => set.includes(token))))
    .sort(canonicalCompare);
  // Fail closed on unexpected catalog growth; presentation limits belong to the UI.
  return minimal.length <= 8 ? minimal : [];
}

/** No accessory requirement is introduced by these notes. */
export function accessoryEquipmentNotes(context) {
  const availableEquipment = context.athleteContext.availableEquipment;
  return ['biceps', 'ham_knee_flexion'].filter((accessoryKind) =>
    eligible(context, { pattern: 'ACC', intent: 'accessory', accessoryKind }, availableEquipment).length === 0)
    .map((accessoryKind) => ({ code: 'EQUIPMENT_CAPABILITY_LIMITED', informational: true,
      scope: { accessoryKind, availableEquipment: [...availableEquipment] } }));
}
