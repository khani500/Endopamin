/** Pure M1 computation from adapter context; no authentication, I/O or safety clearance.
 * Publication metadata is required caller input, verified by the wrapper, never guessed here.
 * Legacy fallback is a shadow diagnostic only, not an Engine A serving policy.
 */
import { normalizeSessionDurationV3 } from './sessionDurationV3.js';
import { resolveEquipmentCapability, EQUIPMENT_STATUS_OK, EQUIPMENT_EXTRA_TOKENS } from './equipmentContract.js';
import { buildWeeklyTemplateV3 } from './weeklyTemplateV3.js';
import { allocateTemplateWeek } from './templateWeekAllocator.js';
import { allocateTemplateVolumeV3, PRIORITIES } from './templateVolumeAllocatorV3.js';
import { repairThinSessionsV3 } from './sessionRepairV3.js';
import { deliverV3Shadow } from './v3ShadowDelivery.js';

export const ENGINE_WEEK_V3_VERSION = 'engine-week-v3.v3';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const absent = (v) => v === null || v === undefined || v === '';
const refuse = (reasons) => ({ verdict: 'not_deliverable', fallback: 'legacy', reasons,
  week: null, coverage: null, limitations: [], templateLimitations: [], notes: [], diagnostics: {} });

export function engineWeekV3(input) {
  const envelope = record(input) ? input : {};
  const publicationMetadata = envelope.publicationMetadata;
  let injuryStatus;
  const finish = (result) => ({ ...result, version: 'v3-shadow-runner.v1', injuryStatus,
    engineVersion: ENGINE_WEEK_V3_VERSION, publicationMetadata,
    coreHash: publicationMetadata?.coreHash,
    resolverContractVersion: publicationMetadata?.resolverContractVersion,
    seed: 'none', history: 'not_read', recentIds: [], deload: false,
    injuryEnforcement: 'not_implemented' });
  try {
    // Read only disclosure kinds; never enumerate, copy or inspect text/tokens.
    injuryStatus = envelope.injuryState?.kind;
    const healthKind = envelope.healthState?.kind;
    const reasons = [];
    if (!record(publicationMetadata)
        || typeof publicationMetadata.coreHash !== 'string' || !/^[a-f0-9]{64}$/.test(publicationMetadata.coreHash)
        || !Number.isInteger(publicationMetadata.resolverContractVersion) || publicationMetadata.resolverContractVersion <= 0) {
      reasons.push({ code: 'INVALID_PUBLICATION_METADATA', field: 'publicationMetadata' });
    }
    if (!['unknown', 'none', 'prefer_not', 'reported', 'invalid'].includes(injuryStatus)) {
      reasons.push({ code: 'INVALID_INJURY_STATE', field: 'injuryState.kind' });
    }
    if (!['unknown', 'none', 'prefer_not', 'reported'].includes(healthKind)) {
      reasons.push({ code: 'INVALID_HEALTH_STATE', field: 'healthState.kind' });
    }
    const source = envelope.context;
    if (!record(source)) return finish(refuse([...reasons, { code: 'INVALID_CONTEXT', field: 'context' }]));
    const { tier, daysPerWeek, durationMinutes, goal, equipmentBucket, equipmentContext, priorityMuscles } = source;
    if (absent(tier)) reasons.push({ code: 'MISSING_TIER', field: 'experience' });
    else if (!['beginner', 'intermediate', 'advanced'].includes(tier)) reasons.push({ code: 'INVALID_TIER', field: 'experience' });
    if (absent(daysPerWeek)) reasons.push({ code: 'MISSING_DAYS_PER_WEEK', field: 'days_per_week' });
    else if (!Number.isInteger(daysPerWeek) || daysPerWeek < 2 || daysPerWeek > 6)
      reasons.push({ code: 'INVALID_DAYS_PER_WEEK', field: 'days_per_week' });
    const duration = normalizeSessionDurationV3(durationMinutes);
    if (!duration.ok) reasons.push({ code: duration.reason, field: 'session_duration' });
    if (absent(goal)) reasons.push({ code: 'MISSING_GOAL', field: 'goal' });
    else if (typeof goal !== 'string') reasons.push({ code: 'INVALID_GOAL', field: 'goal' });
    else if (!['muscle_gain', 'fat_loss', 'endurance'].includes(goal)) reasons.push({ code: 'UNSUPPORTED_GOAL', field: 'goal' });
    const available = record(equipmentContext) ? equipmentContext.availableEquipment : null;
    const extras = Array.isArray(available) ? available.filter((token) => EQUIPMENT_EXTRA_TOKENS.includes(token)) : [];
    const equipment = resolveEquipmentCapability(equipmentBucket, extras);
    if (equipment.equipmentStatus !== EQUIPMENT_STATUS_OK) {
      reasons.push({ code: equipment.equipmentReasonCode || equipment.equipmentStatus, field: 'equipment' });
    } else if (!record(equipmentContext) || equipmentContext.goal !== goal || !Array.isArray(available)
        || available.length !== equipment.availableEquipment.length
        || available.some((token, index) => token !== equipment.availableEquipment[index])) {
      reasons.push({ code: 'INVALID_EQUIPMENT_CONTEXT', field: 'equipmentContext' });
    }
    let priorities;
    if (Array.isArray(priorityMuscles) && priorityMuscles.length <= 1
        && priorityMuscles.every((value) => typeof value === 'string')) {
      priorities = priorityMuscles.map((value) => value.toLowerCase());
      if (!priorities.length || priorities[0] === '' || priorities[0] === 'no preference') priorities = [];
      else if (!Object.hasOwn(PRIORITIES, priorities[0])) priorities = null;
    }
    if (!priorities) reasons.push({ code: 'INVALID_PRIORITY', field: 'priority_muscle' });
    if (reasons.length) return finish(refuse(reasons));
    // Copy capability tokens: no caller-owned arrays are passed into the stages.
    const ctx = { daysPerWeek, durationMinutes: duration.sessionMinutes, tier, goal,
      equipmentContext: { availableEquipment: [...available], goal } };
    const executabilityCache = new Map();
    const stages = { template: buildWeeklyTemplateV3(ctx) };
    if (stages.template.ok) {
      stages.allocation = allocateTemplateWeek({ template: stages.template, athleteContext: ctx.equipmentContext,
        daysPerWeek, durationMinutes: ctx.durationMinutes, tier, goal, recentIds: [], executabilityCache });
      if (stages.allocation.ok) {
        stages.volume = allocateTemplateVolumeV3({ week: stages.allocation.week, priorityMuscles: priorities,
          deload: false, executabilityCache });
        if (stages.volume.ok) stages.repair = repairThinSessionsV3(stages.volume.week, { executabilityCache });
      }
    }
    return finish(deliverV3Shadow({ ...stages, context: ctx, executabilityCache }));
  } catch {
    return finish(refuse([{ code: 'RUNNER_ERROR' }]));
  }
}
