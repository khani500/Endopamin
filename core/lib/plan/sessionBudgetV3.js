/** REQUIRED-only budget authority. Selected duration, warm-up and prescription never change. */
import { sessionRawSeconds, validateResolvedSlot } from './resolvedSlotContract.js';
import { resolveSlotCandidates } from './slotEligibility.js';
import { evaluateWeeklyCoverage, coverageCreditForSlot } from './weeklyCoverageV3.js';
import { buildWeeklyTemplateV3 } from './weeklyTemplateV3.js';
import { selectionPreferenceIndex } from './selectionPreference.js';
import { validateSlotPriorityV3 } from './slotPriorityV3.js';
import { sessionDurationPolicyV3, sessionModeV3 } from './sessionDurationV3.js';

const VERSION = 'required-session-extension.v2';
const LEGACY_VERSION = 'required-session-extension.v1';
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

const insert = (week, placements) => ({ ...week, days: week.days.map((day, dayIndex) => {
  const added = placements.filter((entry) => entry.dayIndex === dayIndex).map((entry) => entry.slot);
  return added.length ? { ...day, slots: [...day.slots, ...added].sort((a, b) => a.templateSlotIndex - b.templateSlotIndex) } : day;
}) });
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function comparePairs(a, b) {
  let order = a.extendedDays - b.extendedDays || b.gain - a.gain;
  for (let i = 0; !order && i < 2; i++) order = a.entries[i].dayIndex - b.entries[i].dayIndex
    || a.entries[i].templateSlotIndex - b.entries[i].templateSlotIndex;
  for (let i = 0; !order && i < 2; i++) order = a.entries[i].preference - b.entries[i].preference;
  for (let i = 0; !order && i < 2; i++) order = compareId(a.entries[i].slot.exerciseId, b.entries[i].slot.exerciseId);
  return order;
}

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
  if (week.days.some((day) => {
    const raw = sessionRawSeconds(day, selected);
    return !Number.isFinite(raw) || raw > selected * 60 + EPSILON;
  })) return fail();
  const placements = [];
  const poolCache = new Map();
  let bundleIndex = 0;
  while (missing(coverage).length) {
    const choices = [];
    const offers = [];
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
          if (!Number.isFinite(raw) || raw > selected * 60 + cap + EPSILON) continue;
          // Keep partial gains for pair search, before the singleton acceptance filter.
          offers.push({ dayIndex, templateSlotIndex, slot, raw,
            preference: selectionPreferenceIndex(slotKind, week.tier, slot.exerciseId) });
          const after = evaluate(proposal);
          if (!after.ok || lost(coverage, after) || missing(after).length >= missing(coverage).length
              || recoveryConflictsV3(proposal) > recoveryConflictsV3(week)) continue;
          choices.push({ dayIndex, templateSlotIndex, slot, after, raw,
            extra: Math.max(0, raw - selected * 60), gain: missing(coverage).length - missing(after).length,
            preference: selectionPreferenceIndex(slotKind, week.tier, slot.exerciseId) });
        }
      }
    }
    choices.sort((a, b) => Number(a.extra > 0) - Number(b.extra > 0) || b.gain - a.gain
      || a.dayIndex - b.dayIndex || a.templateSlotIndex - b.templateSlotIndex || a.preference - b.preference
      || (a.slot.exerciseId < b.slot.exerciseId ? -1 : 1));
    let pick = choices.length ? { entries: [choices[0]], after: choices[0].after } : null;
    if (!pick) {
      const beforeRaw = week.days.map((day) => sessionRawSeconds(day, selected));
      for (let i = 0; i < offers.length; i++) for (let j = i + 1; j < offers.length; j++) {
        if (offers[i].dayIndex === offers[j].dayIndex) continue;
        const entries = [offers[i], offers[j]]; // Enumerated in canonical day/slot order.
        const proposal = insert(week, entries);
        const after = evaluate(proposal);
        if (!after.ok || lost(coverage, after) || missing(after).length >= missing(coverage).length
            || recoveryConflictsV3(proposal) > recoveryConflictsV3(week)) continue;
        const raw = beforeRaw.slice();
        for (const entry of entries) raw[entry.dayIndex] = entry.raw;
        const pair = { entries, after, extendedDays: raw.filter((seconds) => seconds > selected * 60).length,
          gain: missing(coverage).length - missing(after).length };
        if (!pick || comparePairs(pair, pick) < 0) pick = pair;
      }
    }
    if (!pick) break;
    for (const entry of pick.entries) {
      week.days[entry.dayIndex].slots.push(entry.slot);
      week.days[entry.dayIndex].slots.sort((a, b) => a.templateSlotIndex - b.templateSlotIndex);
      placements.push({ dayIndex: entry.dayIndex, ...descriptor(entry.slot), bundleIndex });
    }
    bundleIndex++;
    coverage = pick.after;
  }
  if (placements.length) week.requiredTimeExtension = { version: VERSION, selectedMinutes: selected,
    seedDays, placements };
  return { ok: true, week, placements };
}

const DESCRIPTOR_KEYS = ['exerciseId', 'sets', 'slotKind', 'source', 'templateSlotIndex'];
function descriptorKeys(entry, extra = []) {
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    && same(Object.keys(entry).sort(), [...DESCRIPTOR_KEYS, ...extra].sort());
}

/** Construct packets from authorities; a descriptor can select a packet, never overwrite it. */
function rebuildSlot(week, template, dayIndex, entry, pools, placement, legacy) {
  if (!descriptorKeys(entry, placement ? ['dayIndex', ...(legacy ? [] : ['bundleIndex'])] : [])
      || entry.source !== 'base_template' || !Number.isInteger(entry.templateSlotIndex) || entry.templateSlotIndex < 0) {
    throw new Error('INVALID_PACKET_DESCRIPTOR');
  }
  const authored = template.days[dayIndex]?.slots[entry.templateSlotIndex];
  if (!authored || !same(entry.slotKind, kindOf(authored))) throw new Error('INVALID_AUTHORED_ORIGIN');
  const candidate = approved(week, kindOf(authored), pools).find((c) => c.exerciseId === entry.exerciseId);
  if (!candidate || entry.sets !== candidate.resolvedPrescription.sets.min) throw new Error('INVALID_APPROVED_PACKET');
  const slot = { ...clone(authored), ...clone(candidate), slotKind: kindOf(authored),
    sets: candidate.resolvedPrescription.sets.min, mode: candidate.resolvedPrescription.mode,
    source: 'base_template', templateSlotIndex: entry.templateSlotIndex,
    ...(placement ? { requiredCoveragePlacement: true } : {}) };
  if (!validateResolvedSlot(slot).ok) throw new Error('INVALID_RESOLVED_PACKET');
  return slot;
}

/** Independent singleton enumeration for the validator, using its reconstructed before-state. */
function legalSingletonExists(week, template, coverage, evaluate, pools) {
  const selected = week.durationMinutes, cap = requiredExtensionCapSeconds(selected);
  const beforeRecovery = recoveryConflictsV3(week);
  for (const [dayIndex, day] of week.days.entries()) {
    for (const [templateSlotIndex, authored] of template.days[dayIndex].slots.entries()) {
      if (day.slots.some((slot) => slot.templateSlotIndex === templateSlotIndex)) continue;
      const kind = kindOf(authored);
      for (const candidate of approved(week, kind, pools)) {
        if (day.slots.some((slot) => slot.exerciseId === candidate.exerciseId)) continue;
        let slot;
        try {
          slot = rebuildSlot(week, template, dayIndex, { exerciseId: candidate.exerciseId, slotKind: kind,
            sets: candidate.resolvedPrescription.sets.min, source: 'base_template', templateSlotIndex }, pools, false, false);
        } catch {
          // Counterfactual offers may be unusable; proof-supplied packets still fail closed.
          continue;
        }
        const credit = coverageCreditForSlot(slot);
        if (!credit.ok || !missing(coverage).some((key) => credit.credits[key]
            && !day.slots.some((existing) => coverageCreditForSlot(existing).credits[key]))) continue;
        const proposal = insert(week, [{ dayIndex, slot }]);
        const raw = sessionRawSeconds(proposal.days[dayIndex], selected);
        if (!Number.isFinite(raw) || raw > selected * 60 + cap + EPSILON) continue;
        const after = evaluate(proposal);
        if (after.ok && !lost(coverage, after) && missing(after).length < missing(coverage).length
            && recoveryConflictsV3(proposal) <= beforeRecovery) return true;
      }
    }
  }
  return false;
}

/** Rebuild approved seed packets and replay REQUIRED gains. Caller-supplied cap fields grant nothing. */
export function validateRequiredExtensionV3(week, options = {}) {
  try {
    const selected = week.durationMinutes;
    if (!Number.isFinite(selected * 60)) return fail();
    const ordinary = { ok: true, budgetSecondsByDay: week.days.map(() => selected * 60), extendedTemplateIds: [] };
    const proof = week.requiredTimeExtension;
    if (proof === undefined) return ordinary;
    if (!proof || ![VERSION, LEGACY_VERSION].includes(proof.version) || proof.selectedMinutes !== selected
        || !requiredExtensionCapSeconds(selected) || !Array.isArray(proof.seedDays)
        || proof.seedDays.length !== week.days.length || !Array.isArray(proof.placements)
        || proof.placements.length === 0) return fail();
    const legacy = proof.version === LEGACY_VERSION;
    const context = { daysPerWeek: week.days.length, durationMinutes: selected, tier: week.tier,
      equipmentContext: week.equipmentContext };
    const template = buildWeeklyTemplateV3(context);
    if (!template.ok) return fail();
    const pools = new Map();
    let replay = { ...week, days: proof.seedDays.map((d, i) => {
      if (d.templateId !== week.days[i].templateId || d.templateId !== template.days[i].templateId
          || !Array.isArray(d.slots)) throw new Error('INVALID_SEED_DAY');
      const indices = new Set();
      const slots = d.slots.map((s) => {
        if (indices.has(s.templateSlotIndex)) throw new Error('DUPLICATE_SEED_ORIGIN');
        indices.add(s.templateSlotIndex);
        return rebuildSlot(week, template, i, s, pools, false, legacy);
      });
      const day = { templateId: d.templateId, slots };
      const raw = sessionRawSeconds(day, selected);
      if (new Set(slots.map((s) => s.exerciseId)).size !== slots.length
          || !Number.isFinite(raw) || raw > selected * 60 + EPSILON) throw new Error('INVALID_SEED_BUDGET');
      return day;
    }) };
    delete replay.requiredTimeExtension;
    const executabilityCache = options.executabilityCache ?? new Map();
    const evaluate = (value) => evaluateWeeklyCoverage(value, { durationMinutes: selected, executabilityCache,
      applicabilityPolicy: legacy ? 'legacy' : 's4' });
    let coverage = evaluate(replay);
    if (!coverage.ok) return fail();
    const bundles = [];
    for (const entry of proof.placements) {
      if (legacy) bundles.push([entry]);
      else {
        if (!Number.isInteger(entry.bundleIndex) || entry.bundleIndex < 0) return fail();
        if (entry.bundleIndex === bundles.length) bundles.push([]);
        if (entry.bundleIndex !== bundles.length - 1) return fail();
        bundles[entry.bundleIndex].push(entry);
        if (bundles[entry.bundleIndex].length > 2) return fail();
      }
    }
    for (const entries of bundles) {
      if (new Set(entries.map((entry) => entry.dayIndex)).size !== entries.length) return fail();
      if (entries.length === 2 && legalSingletonExists(replay, template, coverage, evaluate, pools)) return fail();
      const additions = entries.map((entry) => {
        if (!Number.isInteger(entry.dayIndex) || !replay.days[entry.dayIndex]) throw new Error('INVALID_PLACEMENT_DAY');
        const day = replay.days[entry.dayIndex];
        if (day.slots.some((s) => s.exerciseId === entry.exerciseId || s.templateSlotIndex === entry.templateSlotIndex)) {
          throw new Error('DUPLICATE_PLACEMENT');
        }
        return { dayIndex: entry.dayIndex, slot: rebuildSlot(week, template, entry.dayIndex, entry, pools, true, legacy) };
      });
      const beforeRecovery = recoveryConflictsV3(replay);
      const proposal = insert(replay, additions);
      if (proposal.days.some((day) => {
        const raw = sessionRawSeconds(day, selected);
        return !Number.isFinite(raw) || raw > selected * 60 + requiredExtensionCapSeconds(selected) + EPSILON;
      })) return fail();
      const after = evaluate(proposal);
      if (!after.ok
          || lost(coverage, after) || missing(after).length >= missing(coverage).length
          || recoveryConflictsV3(proposal) > beforeRecovery) return fail();
      replay = proposal;
      coverage = after;
      for (const [i, entry] of entries.entries()) {
        const finals = week.days[entry.dayIndex].slots.filter((s) => matches(s, entry));
        if (finals.length !== 1 || finals[0].requiredCoveragePlacement !== true
            || !same(finals[0].resolvedPrescription, additions[i].slot.resolvedPrescription)) return fail();
      }
    }
    const budgetSecondsByDay = replay.days.map((day) => {
      const raw = sessionRawSeconds(day, selected);
      if (!Number.isFinite(raw)) throw new Error('INVALID_REPLAY_TIMING');
      return Math.max(selected * 60, raw);
    });
    const extendedTemplateIds = [];
    for (const [i, day] of week.days.entries()) {
      const raw = sessionRawSeconds(day, selected);
      if (!Number.isFinite(raw) || raw > budgetSecondsByDay[i] + EPSILON
          || new Set(day.slots.map((s) => s.exerciseId)).size !== day.slots.length) return fail();
      if (budgetSecondsByDay[i] <= selected * 60 + EPSILON) continue;
      extendedTemplateIds.push(day.templateId);
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
