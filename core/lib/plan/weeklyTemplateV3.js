/** Template v3 §3 and D4/D5. Dormant structure only: no IDs, sets, costing or calendar. */
import { normalizeSessionDurationV3 } from './sessionDurationV3.js';
import { validateSlotKind, resolveSlotCandidates } from './slotEligibility.js';
import { getReviewedPrescriptionInputs } from './reviewedPrescriptionInputs.js';

const VERSION = 'weekly-template.v3';
const SP = 'structural_primary';
const SS = 'structural_secondary';
const structural = (pattern, intent, variation = false) => ({ pattern, intent, ...(variation ? { variation: true } : {}) });
const acc = (accessoryKind) => ({ pattern: 'ACC', intent: 'accessory', accessoryKind });
const core = () => ({ pattern: 'CORE', intent: 'core' });
const BASE = {
  'FB-A': [structural('SQ', SP), structural('HPU', SP), structural('HPL', SP), structural('HG', SS), structural('VPU', SS), structural('VPL', SS), acc('lateral_delts'), core()],
  'FB-B': [structural('HG', SP), structural('VPU', SP), structural('VPL', SP), structural('LU', SS), structural('HPU', SS), structural('HPL', SS), acc('rear_delts'), core()],
  'FB-C': [structural('LU', SP), structural('HPU', SP), structural('VPL', SP), structural('HG', SS), structural('VPU', SS), structural('HPL', SS), core()],
  U1: [structural('HPU', SP), structural('HPL', SP), structural('VPU', SS), structural('VPL', SS), acc('biceps'), acc('lateral_delts')],
  U2: [structural('VPU', SP), structural('VPL', SP), structural('HPU', SS), structural('HPL', SS), acc('rear_delts'), acc('triceps')],
  L1: [structural('SQ', SP), structural('HG', SS), structural('LU', SS), acc('ham_knee_flexion'), acc('calves'), core()],
  L2: [structural('HG', SP), structural('SQ', SS, true), structural('LU', SS), acc('calves'), core()],
  'Push-1': [structural('HPU', SP), structural('VPU', SS), structural('HPU', SS, true), acc('lateral_delts'), acc('triceps')],
  'Push-2': [structural('VPU', SP), structural('HPU', SS), structural('HPU', SS, true), acc('lateral_delts'), acc('triceps')],
  'Pull-1': [structural('VPL', SP), structural('HPL', SS), structural('VPL', SS, true), acc('rear_delts'), acc('biceps')],
  'Pull-2': [structural('HPL', SP), structural('VPL', SS), structural('HPL', SS, true), acc('rear_delts'), acc('biceps')],
};
BASE['Legs-1'] = BASE.L1;
BASE['Legs-2'] = BASE.L2;
const WEEKS = {
  2: ['FB-A', 'FB-B'],
  3: ['FB-A', 'FB-B', 'FB-C'],
  4: ['U1', 'L1', 'U2', 'L2'],
  5: ['U1', 'L1', 'U2', 'L2', 'FB-C'],
};
const PPL = ['Push-1', 'Pull-1', 'Legs-1', 'Push-2', 'Pull-2', 'Legs-2'];
const UL6 = ['U1', 'L1', 'U2', 'L2', 'U1-variation', 'L1-variation'];
// R-A: full-body week for the same day count when upper days cannot form a session.
const FULL_BODY = ['FB-A', 'FB-B', 'FB-C', 'FB-A-variation', 'FB-B-variation', 'FB-C-variation'];
const UPPER_DAYS = ['U1', 'U2'];
const MIN_UPPER_DEPTH = 2;
const fail = (reason) => ({ ok: false, reason });

function inputs(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_INPUT');
  const { daysPerWeek, durationMinutes, equipmentContext, tier } = input;
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 2 || daysPerWeek > 6) return fail('INVALID_DAYS_PER_WEEK');
  const duration = normalizeSessionDurationV3(durationMinutes);
  if (!duration.ok) return fail(duration.reason);
  if (!['beginner', 'intermediate', 'advanced'].includes(tier)) return fail('INVALID_TIER');
  if (!equipmentContext || typeof equipmentContext !== 'object' || Array.isArray(equipmentContext)
      || !Array.isArray(equipmentContext.availableEquipment)
      || equipmentContext.availableEquipment.some((token) => typeof token !== 'string' || !token)) return fail('INVALID_EQUIPMENT_CONTEXT');
  // §1 requires a goal. Availability uses its approved prescription, never an invented default.
  if (!['muscle_gain', 'fat_loss', 'endurance'].includes(equipmentContext.goal)) return fail('INVALID_GOAL');
  if (equipmentContext.athleteTier !== undefined && equipmentContext.athleteTier !== tier) return fail('TIER_CONTEXT_MISMATCH');
  return { ok: true, daysPerWeek, durationMinutes: duration.sessionMinutes, equipmentContext, tier };
}

function availability(context) {
  const cache = new Map();
  return (pattern, intent) => {
    const key = `${pattern}/${intent}`;
    if (!cache.has(key)) {
      const result = resolveSlotCandidates({
        slotKind: { pattern, intent }, goal: context.equipmentContext.goal, tier: context.tier,
        mode: context.durationMinutes === 15 ? 'short_session' : 'standard',
        athleteContext: context.equipmentContext,
      });
      if (!result.ok) throw new Error(result.reason);
      cache.set(key, result.candidates);
    }
    return cache.get(key);
  };
}

function approvedPrimaryBasis(exerciseId, pattern) {
  return getReviewedPrescriptionInputs(exerciseId)?.eligibility.some((entry) =>
    entry.slotKind.pattern === pattern && entry.slotKind.intent === SP
    && entry.reviewStatus === 'approved' && entry.movementEligibility === 'eligible') === true;
}

/** §2.2, for the §3 depth gate only. A fly's volume never supplies press depth. */
function coverageDepth(patterns, candidatesFor) {
  const ids = new Set();
  for (const pattern of patterns) {
    for (const intent of [SP, SS]) {
      for (const candidate of candidatesFor(pattern, intent)) {
        if (approvedPrimaryBasis(candidate.exerciseId, pattern)
            || (intent === SS && candidate.resolvedPrescription.prescriptionRole === 'accessory_compound')) ids.add(candidate.exerciseId);
      }
    }
  }
  return ids.size;
}

function shell(context, split, days) {
  return {
    ok: true, version: VERSION, kind: 'structure_only', daysPerWeek: context.daysPerWeek,
    durationMinutes: context.durationMinutes, split, days, limitations: [],
    // D5: canonical §3 order already interleaves UL/PPL lower days. Reordering FB or D4
    // would violate authored sequences. Preserve authored order on a tie/unavoidable conflict;
    // actual heavy loading and calendar spacing remain unknown until selection/scheduling.
    recovery: { preference: 'avoid_consecutive_heavy_SQ_HG', tieBreak: 'authored_order', calendarAssigned: false },
    injuryEnforcement: 'not_implemented',
  };
}

function standardDay(templateId) {
  const baseTemplateId = templateId.replace('-variation', '');
  return {
    templateId, baseTemplateId,
    ...(templateId.endsWith('-variation') ? { variationOf: baseTemplateId } : {}),
    // variation marks a different ID from the earlier same-pattern/paired-day slot;
    // selection in 2h will prefer a different family when depth permits.
    slots: BASE[baseTemplateId].map((slot) => ({ ...slot })),
  };
}

function shortRotation(daysPerWeek) {
  let push = 0;
  let pull = 0;
  return Array.from({ length: daysPerWeek }, (_, index) => {
    const lowerFamily = index % 2 === 0 ? 'knee' : 'hinge';
    const upperFamily = [0, 3].includes(index % 4) ? 'push' : 'pull';
    const upper = upperFamily === 'push'
      ? ['HPU', 'VPU'][push++ % 2] : ['HPL', 'VPL'][pull++ % 2];
    return [
      { family: lowerFamily, preferredPattern: lowerFamily === 'knee' ? 'SQ' : 'HG' },
      { family: upperFamily, preferredPattern: upper },
    ];
  });
}

const SHORT_FAMILIES = { knee: ['SQ', 'LU'], hinge: ['HG'], push: ['HPU', 'VPU'], pull: ['HPL', 'VPL'] };
const OTHER_FAMILY = { knee: 'hinge', hinge: 'knee', push: 'pull', pull: 'push' };

/** D4: two authored primaries only; availability changes pattern/markers, never selects an ID. */
export function buildShortSessionTemplate(input) {
  const context = inputs(input);
  if (!context.ok) return context;
  if (context.durationMinutes !== 15) return fail('SHORT_SESSION_REQUIRES_15_MINUTES');
  const candidatesFor = availability(context);
  // Count actual family appearances, including substitutions. An unavailable orientation
  // falls back within its family; availability still comes exclusively from 2d.
  const appearances = { push: 0, pull: 0 };
  const executablePattern = (family) => {
    const patterns = SHORT_FAMILIES[family];
    const preferred = family === 'push' || family === 'pull' ? appearances[family] % 2 : 0;
    const ordered = [...patterns.slice(preferred), ...patterns.slice(0, preferred)];
    return ordered.find((pattern) => candidatesFor(pattern, SP).length > 0);
  };
  try {
    const days = shortRotation(context.daysPerWeek).map((rotation, index) => ({
      templateId: `Short-${index + 1}`,
      slots: rotation.map(({ family, preferredPattern }) => {
        let selectedFamily = family;
        let pattern = executablePattern(family);
        const missingFamily = !pattern;
        if (missingFamily) {
          selectedFamily = OTHER_FAMILY[family];
          pattern = executablePattern(selectedFamily);
        }
        if (pattern && (selectedFamily === 'push' || selectedFamily === 'pull')) appearances[selectedFamily]++;
        return {
          pattern: pattern || preferredPattern, intent: SP, family, preferredPattern,
          ...(missingFamily ? { limited: {
            status: 'limited', reason: 'NO_EXECUTABLE_STRUCTURAL_PRIMARY', family, preferredPattern,
            ...(pattern ? { substitutionFamily: selectedFamily } : {}),
          } } : {}),
        };
      }),
    }));
    const result = shell(context, 'short_session', days);
    for (const day of days) day.slots.forEach((slot, slotIndex) => {
      if (slot.limited) result.limitations.push({ templateId: day.templateId, slotIndex, ...slot.limited });
    });
    return result;
  } catch (error) { return fail(error.message); }
}

/** R-A depth: per upper base day, the number of its authored slot kinds with an executable approved
 * candidate for this athlete. Same discovery as the PPL depth gate; never selects an ID. */
function upperDayDepth(context) {
  const depth = {};
  for (const templateId of UPPER_DAYS) {
    depth[templateId] = BASE[templateId].filter((slot) => {
      const slotKind = { pattern: slot.pattern, intent: slot.intent, ...(slot.accessoryKind ? { accessoryKind: slot.accessoryKind } : {}) };
      const result = resolveSlotCandidates({ slotKind, goal: context.equipmentContext.goal, tier: context.tier,
        mode: 'standard', athleteContext: context.equipmentContext });
      if (!result.ok) throw new Error(result.reason);
      return result.candidates.length > 0;
    }).length;
  }
  return depth;
}
const upperTooShallow = (depth) => UPPER_DAYS.some((templateId) => depth[templateId] < MIN_UPPER_DEPTH);

/** equipmentContext carries canonical equipment/extras tokens and the explicit profile goal. */
export function buildWeeklyTemplateV3(input) {
  const context = inputs(input);
  if (!context.ok) return context;
  if (context.durationMinutes === 15) return buildShortSessionTemplate(input);
  let sequence = WEEKS[context.daysPerWeek];
  let split = context.daysPerWeek <= 3 ? 'full_body' : context.daysPerWeek === 5 ? 'upper_lower_full_body' : 'upper_lower';
  let pplDepth;
  if (context.daysPerWeek === 6) {
    try {
      const candidatesFor = availability(context);
      pplDepth = { pushDistinctIds: coverageDepth(['HPU', 'VPU'], candidatesFor), pullDistinctIds: coverageDepth(['HPL', 'VPL'], candidatesFor) };
    } catch (error) { return fail(error.message); }
    const usePPL = pplDepth.pushDistinctIds >= 3 && pplDepth.pullDistinctIds >= 3;
    sequence = usePPL ? PPL : UL6;
    split = usePPL ? 'push_pull_legs' : 'upper_lower_variation';
  }
  let upperDepth;
  if (sequence.some((templateId) => UPPER_DAYS.includes(templateId.replace('-variation', '')))) {
    try { upperDepth = upperDayDepth(context); } catch (error) { return fail(error.message); }
    if (upperTooShallow(upperDepth)) { sequence = FULL_BODY.slice(0, context.daysPerWeek); split = 'full_body'; }
  }
  return { ...shell(context, split, sequence.map(standardDay)), ...(pplDepth ? { pplDepth } : {}), ...(upperDepth ? { upperDepth } : {}) };
}

const validUpperDepth = (depth) => depth !== null && typeof depth === 'object' && !Array.isArray(depth)
  && UPPER_DAYS.every((templateId) => Number.isInteger(depth[templateId]) && depth[templateId] >= 0 && depth[templateId] <= BASE[templateId].length);

/** Private structural gate; existing failures precede contextual comparison. */
function validateTemplateStructure(template) {
  if (!template || template.ok !== true || template.version !== VERSION || template.kind !== 'structure_only') return fail('INVALID_WEEKLY_TEMPLATE');
  if (!Number.isInteger(template.daysPerWeek) || template.daysPerWeek < 2 || template.daysPerWeek > 6) return fail('INVALID_DAYS_PER_WEEK');
  if (![15, 30, 45, 60, 75].includes(template.durationMinutes)) return fail('INVALID_TEMPLATE_DURATION');
  if (!Array.isArray(template.days) || template.days.length !== template.daysPerWeek) return fail('INVALID_TEMPLATE_DAY_COUNT');
  const short = template.durationMinutes === 15;
  let sequence;
  if (short) {
    if (template.split !== 'short_session') return fail('INVALID_TEMPLATE_SPLIT');
  } else if (template.daysPerWeek === 6) {
    const depth = template.pplDepth;
    if (!depth || !Number.isInteger(depth.pushDistinctIds) || depth.pushDistinctIds < 0
        || !Number.isInteger(depth.pullDistinctIds) || depth.pullDistinctIds < 0) return fail('INVALID_PPL_DEPTH');
    const ppl = depth.pushDistinctIds >= 3 && depth.pullDistinctIds >= 3;
    sequence = ppl ? PPL : UL6;
    if (!ppl && !validUpperDepth(template.upperDepth)) return fail('INVALID_UPPER_DEPTH');
    const fullBody = !ppl && upperTooShallow(template.upperDepth);
    if (fullBody) sequence = FULL_BODY.slice(0, 6);
    if (template.split !== (ppl ? 'push_pull_legs' : fullBody ? 'full_body' : 'upper_lower_variation')) return fail('INVALID_TEMPLATE_SPLIT');
  } else {
    let split = template.daysPerWeek <= 3 ? 'full_body' : template.daysPerWeek === 5 ? 'upper_lower_full_body' : 'upper_lower';
    sequence = WEEKS[template.daysPerWeek];
    if (template.daysPerWeek >= 4) {
      if (!validUpperDepth(template.upperDepth)) return fail('INVALID_UPPER_DEPTH');
      if (upperTooShallow(template.upperDepth)) { split = 'full_body'; sequence = FULL_BODY.slice(0, template.daysPerWeek); }
    }
    if (template.split !== split) return fail('INVALID_TEMPLATE_SPLIT');
  }
  const rotation = short ? shortRotation(template.daysPerWeek) : null;
  const expectedLimitations = [];
  for (const [index, day] of template.days.entries()) {
    if (!day || !Array.isArray(day.slots)) return fail('INVALID_TEMPLATE_DAY');
    if (short) {
      if (day.templateId !== `Short-${index + 1}` || day.slots.length !== 2) return fail('INVALID_SHORT_SESSION_STRUCTURE');
    } else {
      const expected = standardDay(sequence[index]);
      if (day.templateId !== expected.templateId || day.baseTemplateId !== expected.baseTemplateId
          || day.variationOf !== expected.variationOf || day.slots.length !== expected.slots.length) return fail('INVALID_AUTHORED_SEQUENCE');
    }
    for (const [slotIndex, slot] of day.slots.entries()) {
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return fail('INVALID_TEMPLATE_SLOT');
      const allowed = short ? ['pattern', 'intent', 'family', 'preferredPattern', 'limited'] : ['pattern', 'intent', 'accessoryKind', 'variation'];
      if (Object.keys(slot).some((key) => !allowed.includes(key))) return fail('INVALID_TEMPLATE_SLOT');
      const slotKind = { pattern: slot.pattern, intent: slot.intent, ...(Object.hasOwn(slot, 'accessoryKind') ? { accessoryKind: slot.accessoryKind } : {}) };
      if (!validateSlotKind(slotKind).ok) return fail('INVALID_TEMPLATE_SLOT');
      if (!short) {
        const expected = standardDay(sequence[index]).slots[slotIndex];
        if (['pattern', 'intent', 'accessoryKind', 'variation'].some((key) => slot[key] !== expected[key])) return fail('INVALID_AUTHORED_SEQUENCE');
      }
      if (short) {
        const expected = rotation[index][slotIndex];
        const patterns = SHORT_FAMILIES[expected.family];
        const substituted = !patterns.includes(slot.pattern);
        if (slot.intent !== SP || slot.family !== expected.family || slot.preferredPattern !== expected.preferredPattern
            || (substituted && (!slot.limited || !SHORT_FAMILIES[OTHER_FAMILY[expected.family]].includes(slot.pattern))))
          return fail('INVALID_SHORT_SESSION_ROTATION');
        if (slot.limited && (slot.limited.status !== 'limited' || slot.limited.reason !== 'NO_EXECUTABLE_STRUCTURAL_PRIMARY'
            || slot.limited.family !== slot.family || slot.limited.preferredPattern !== slot.preferredPattern
            || (substituted ? slot.limited.substitutionFamily !== OTHER_FAMILY[expected.family]
              : slot.limited.substitutionFamily !== undefined || slot.pattern !== slot.preferredPattern))) return fail('INVALID_LIMITED_MARKER');
        if (slot.limited) expectedLimitations.push({ templateId: day.templateId, slotIndex, ...slot.limited });
      }
    }
  }
  if (!Array.isArray(template.limitations) || template.limitations.length !== expectedLimitations.length
      || template.limitations.some((marker, index) => !marker
        || Object.keys(expectedLimitations[index]).some((key) => marker[key] !== expectedLimitations[index][key]))) return fail('INVALID_TEMPLATE_LIMITATIONS');
  return { ok: true };
}

const plainObject = (value) => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Data equality: object key order is irrelevant; array order is authoritative. */
function sameTemplateData(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length
        || Object.getPrototypeOf(left) !== Array.prototype || Object.getPrototypeOf(right) !== Array.prototype
        || Reflect.ownKeys(left).length !== left.length + 1 || Reflect.ownKeys(right).length !== right.length + 1) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!Object.hasOwn(left, i) || !Object.hasOwn(right, i) || !sameTemplateData(left[i], right[i])) return false;
    }
    return true;
  }
  if ((left !== null && typeof left === 'object') || (right !== null && typeof right === 'object')) {
    if (!plainObject(left) || !plainObject(right)) return false;
    const keys = Reflect.ownKeys(left);
    return keys.length === Reflect.ownKeys(right).length
      && keys.every((key) => Object.hasOwn(right, key) && sameTemplateData(left[key], right[key]));
  }
  return typeof left !== 'function' && typeof right !== 'function' && left === right;
}

/** Required independent builder context; never trust recorded depth or short-session markers. */
export function validateWeeklyTemplate(template, context) {
  if (!plainObject(context)) return fail('MISSING_TEMPLATE_CONTEXT');
  const structural = validateTemplateStructure(template);
  if (!structural.ok) return structural;
  const validatedContext = inputs(context);
  if (!validatedContext.ok) return { ...fail('INVALID_TEMPLATE_CONTEXT'), contextReason: validatedContext.reason };
  const rebuilt = buildWeeklyTemplateV3(context);
  if (!rebuilt.ok) return { ...fail('TEMPLATE_REBUILD_FAILED'), rebuildReason: rebuilt.reason };
  return sameTemplateData(template, rebuilt) ? { ok: true } : fail('TEMPLATE_CONTEXT_MISMATCH');
}
