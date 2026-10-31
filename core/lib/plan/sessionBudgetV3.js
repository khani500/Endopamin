/** REQUIRED-only budget authority. Selected duration, warm-up and prescription never change. */
import { sessionRawSeconds, validateResolvedSlot } from './resolvedSlotContract.js';
import { resolveSlotCandidates } from './slotEligibility.js';
import { evaluateWeeklyCoverage, coverageCreditForSlot } from './weeklyCoverageV3.js';
import { buildWeeklyTemplateV3 } from './weeklyTemplateV3.js';
import { selectionPreferenceIndex } from './selectionPreference.js';
import { validateSlotPriorityV3 } from './slotPriorityV3.js';
import { sessionDurationPolicyV3, sessionModeV3 } from './sessionDurationV3.js';

const VERSION = 'required-session-extension.v1';
const EPSILON = 60e-9;
const fail = (reason = 'INVALID_REQUIRED_EXTENSION') => ({ ok: false, reason });
const clone = (v) => Array.isArray(v) ? v.map(clone) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
const same = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object'
  && Object.keys(a).length === Object.keys(b).length
  && Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k])));
const kindOf = (slot) => ({ pattern: slot.pattern, intent: slot.intent,
  ...(slot.accessoryKind === undefined ? {} : { accessoryKind: slot.accessoryKind }) });
const missing = (coverage) => Object.entries(coverage.requirements)
  .filter(([, r]) => r.required && r.achieved < r.target).map(([key]) => key);
const lost = (before, after) => Object.entries(before.requirements).some(([k, r]) => r.required
  && after.requirements[k].achieved < Math.min(r.achieved, r.target));

export function requiredExtensionCapSeconds(selectedMinutes) {
  return sessionDurationPolicyV3(selectedMinutes)?.requiredExtensionCapSeconds ?? 0;
}

/** Existing D5 proxy; shared with repair, not a new calendar/fatigue clearance. */
export function recoveryConflictsV3(week) {
  const heavy = (s) => s.slotKind.intent === 'structural_primary' && ['SQ', 'HG'].includes(s.slotKind.pattern);
  let count = 0;
  for (let i = 1; i < week.days.length; i++)
    if (week.days[i - 1].slots.some(heavy) && week.days[i].slots.some(heavy)) count++;
  return count;
}

function approved(week, kind, cache) {
  const key = JSON.stringify(kind);
  if (!cache.has(key)) {
    const result = resolveSlotCandidates({ slotKind: kind, goal: week.equipmentContext.goal,
      tier: week.tier, mode: sessionModeV3(week.durationMinutes),
      athleteContext: week.equipmentContext });
    if (!result.ok) throw new Error(result.reason);
    cache.set(key, result.candidates);
  }
  return cache.get(key);
}
const descriptor = (slot) => ({ exerciseId: slot.exerciseId, slotKind: clone(slot.slotKind),
  sets: slot.sets, source: slot.source, templateSlotIndex: slot.templateSlotIndex });
const matches = (slot, d) => slot.exerciseId === d.exerciseId && slot.sets === d.sets
  && slot.source === d.source && slot.templateSlotIndex === d.templateSlotIndex && same(slot.slotKind, d.slotKind);

/** Restore only absent authored slots; every transaction must reduce REQUIRED missing-item count. */
export function extendRequiredCoverageV3(input, template, options = {}) {
  if (input.requiredTimeExtension !== undefined) return fail('REQUIRED_EXTENSION_ALREADY_APPLIED');
  const week = clone(input);
  const selected = week.durationMinutes;
  const cap = requiredExtensionCapSeconds(selected);
  if (!cap) return { ok: true, week, placements: [] };
  const executabilityCache = options.executabilityCache ?? new Map();
  const evaluate = (w) => evaluateWeeklyCoverage(w, { durationMinutes: selected, executabilityCache });
  let coverage = evaluate(week);
  if (!coverage.ok) return coverage;
  const seedDays = week.days.map((d) => ({ templateId: d.templateId, slots: d.slots.map(descriptor) }));
  const placements = [];
  const poolCache = new Map();
  while (missing(coverage).length) {
    const choices = [];
    for (const [dayIndex, day] of week.days.entries()) {
      for (const [templateSlotIndex, authored] of template.days[dayIndex].slots.entries()) {
        if (day.slots.some((s) => s.templateSlotIndex === templateSlotIndex)) continue;
        const slotKind = kindOf(authored);
        for (const candidate of approved(week, slotKind, poolCache)) {
          if (day.slots.some((s) => s.exerciseId === candidate.exerciseId)) continue;
          const slot = { ...clone(authored), ...clone(candidate), slotKind,
            sets: candidate.resolvedPrescription.sets.min, mode: candidate.resolvedPrescription.mode,
            source: 'base_template', templateSlotIndex, requiredCoveragePlacement: true };
          const credit = coverageCreditForSlot(slot);
          if (!credit.ok || !missing(coverage).some((k) => credit.credits[k]
              && !day.slots.some((s) => coverageCreditForSlot(s).credits[k]))) continue;
          const proposal = { ...week, days: week.days.map((d, i) => i !== dayIndex ? d
            : { ...d, slots: [...d.slots, slot].sort((a, b) => a.templateSlotIndex - b.templateSlotIndex) }) };
          const raw = sessionRawSeconds(proposal.days[dayIndex], selected);
          if (typeof raw !== 'number' || raw > selected * 60 + cap + EPSILON) continue;
          const after = evaluate(proposal);
          if (!after.ok || lost(coverage, after) || missing(after).length >= missing(coverage).length
              || recoveryConflictsV3(proposal) > recoveryConflictsV3(week)) continue;
          choices.push({ dayIndex, templateSlotIndex, slot, after, raw,
            extra: Math.max(0, raw - selected * 60), gain: missing(coverage).length - missing(after).length,
            preference: selectionPreferenceIndex(slotKind, week.tier, slot.exerciseId) });
        }
      }
    }
    if (!choices.length) break;
    choices.sort((a, b) => Number(a.extra > 0) - Number(b.extra > 0) || b.gain - a.gain
      || a.dayIndex - b.dayIndex || a.templateSlotIndex - b.templateSlotIndex || a.preference - b.preference
      || (a.slot.exerciseId < b.slot.exerciseId ? -1 : 1));
    const pick = choices[0];
    week.days[pick.dayIndex].slots.push(pick.slot);
    week.days[pick.dayIndex].slots.sort((a, b) => a.templateSlotIndex - b.templateSlotIndex);
    placements.push({ dayIndex: pick.dayIndex, ...descriptor(pick.slot) });
    coverage = pick.after;
  }
  if (placements.length) week.requiredTimeExtension = { version: VERSION, selectedMinutes: selected,
    seedDays, placements };
  return { ok: true, week, placements };
}

/** Rebuild approved seed packets and replay REQUIRED gains. Caller-supplied cap fields grant nothing. */
export function validateRequiredExtensionV3(week, options = {}) {
  const selected = week.durationMinutes;
  const ordinary = { ok: true, budgetSecondsByDay: week.days.map(() => selected * 60), extendedTemplateIds: [] };
  const proof = week.requiredTimeExtension;
  if (proof === undefined) return ordinary;
  try {
    if (!proof || proof.version !== VERSION || proof.selectedMinutes !== selected
        || !requiredExtensionCapSeconds(selected) || !Array.isArray(proof.seedDays)
        || proof.seedDays.length !== week.days.length || !Array.isArray(proof.placements)
        || proof.placements.length === 0) return fail();
    const context = { daysPerWeek: week.days.length, durationMinutes: selected, tier: week.tier,
      equipmentContext: week.equipmentContext };
    const template = buildWeeklyTemplateV3(context);
    if (!template.ok) return fail();
    const pools = new Map();
    const replay = { ...week, days: proof.seedDays.map((d, i) => {
      if (d.templateId !== week.days[i].templateId || d.templateId !== template.days[i].templateId
          || !Array.isArray(d.slots)) throw new Error('INVALID_SEED_DAY');
      const indices = new Set();
      const slots = d.slots.map((s) => {
        if (s.source !== 'base_template' || !Number.isInteger(s.templateSlotIndex)
            || indices.has(s.templateSlotIndex)
            || !same(s.slotKind, kindOf(template.days[i].slots[s.templateSlotIndex] ?? {}))) throw new Error('INVALID_SEED_ORIGIN');
        indices.add(s.templateSlotIndex);
        const candidate = approved(week, s.slotKind, pools).find((c) => c.exerciseId === s.exerciseId);
        if (!candidate || s.sets !== candidate.resolvedPrescription.sets.min) throw new Error('INVALID_SEED_PRESCRIPTION');
        return { ...clone(candidate), ...clone(s), mode: candidate.resolvedPrescription.mode };
      });
      const day = { templateId: d.templateId, slots };
      if (new Set(slots.map((s) => s.exerciseId)).size !== slots.length
          || sessionRawSeconds(day, selected) > selected * 60 + EPSILON) throw new Error('INVALID_SEED_BUDGET');
      return day;
    }) };
    delete replay.requiredTimeExtension;
    const executabilityCache = options.executabilityCache ?? new Map();
    const evaluate = () => evaluateWeeklyCoverage(replay, { durationMinutes: selected, executabilityCache });
    let coverage = evaluate();
    if (!coverage.ok) return fail();
    for (const entry of proof.placements) {
      if (!Number.isInteger(entry.dayIndex) || !replay.days[entry.dayIndex]) return fail();
      const day = replay.days[entry.dayIndex];
      if (entry.source !== 'base_template' || !same(entry.slotKind,
        kindOf(template.days[entry.dayIndex].slots[entry.templateSlotIndex] ?? {}))
          || day.slots.some((s) => s.exerciseId === entry.exerciseId || s.templateSlotIndex === entry.templateSlotIndex)) return fail();
      const c = approved(week, entry.slotKind, pools).find((s) => s.exerciseId === entry.exerciseId);
      if (!c || entry.sets !== c.resolvedPrescription.sets.min) return fail();
      const beforeRecovery = recoveryConflictsV3(replay);
      day.slots.push({ ...clone(c), ...clone(entry), mode: c.resolvedPrescription.mode });
      const raw = sessionRawSeconds(day, selected);
      const after = evaluate();
      if (!after.ok || typeof raw !== 'number' || raw > selected * 60 + requiredExtensionCapSeconds(selected) + EPSILON
          || lost(coverage, after) || missing(after).length >= missing(coverage).length
          || recoveryConflictsV3(replay) > beforeRecovery) return fail();
      coverage = after;
      const final = week.days[entry.dayIndex].slots.find((s) => matches(s, entry));
      if (!final || final.requiredCoveragePlacement !== true
          || !same(final.resolvedPrescription, c.resolvedPrescription)) return fail();
    }
    const budgetSecondsByDay = replay.days.map((d) => Math.max(selected * 60, sessionRawSeconds(d, selected)));
    const extendedTemplateIds = [];
    for (const [i, day] of week.days.entries()) {
      if (budgetSecondsByDay[i] <= selected * 60 + EPSILON) continue;
      extendedTemplateIds.push(day.templateId);
      const raw = sessionRawSeconds(day, selected);
      if (typeof raw !== 'number' || raw > budgetSecondsByDay[i] + EPSILON) return fail();
      // While any extension is used, the session may only retain its approved minimum-set seed/witness slots.
      if (raw > selected * 60 + EPSILON && day.slots.some((s) => !replay.days[i].slots.some((r) => matches(s, r)
          && same(s.resolvedPrescription, r.resolvedPrescription)))) return fail();
    }
    return { ok: true, budgetSecondsByDay, extendedTemplateIds };
  } catch { return fail(); }
}

/** Budget authority also verifies any post-2j transaction proof, including on
 * ordinary non-extended weeks. 2k is allowed to move whole packets only. */
export function validateRequiredBudgetV3(week, options = {}) {
  const proof = validateSlotPriorityV3(week, { final: true });
  if (!proof.ok) return proof;
  return validateRequiredExtensionV3(week, options);
}

export function sessionEstimateV3(day, selectedMinutes) {
  const estimatedSeconds = sessionRawSeconds(day, selectedMinutes);
  return typeof estimatedSeconds !== 'number' ? estimatedSeconds : {
    selectedMinutes, estimatedSeconds, estimatedMinutes: Math.ceil(estimatedSeconds / 60),
    requiredExtensionSeconds: Math.max(0, estimatedSeconds - selectedMinutes * 60),
  };
}
