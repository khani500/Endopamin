/** Step 2j: explicit, dormant V3 allocation from an already fitted 2h week.
 * Additive only: seed IDs, authored intents, order and base provenance never change.
 * Targets are soft lower bounds, not floors/caps. No legacy allocator is called or changed.
 */
import { resolveSlotCandidates } from './slotEligibility.js';
import { resolvePrescription } from './prescriptionResolver.js';
import { canPlaceResolvedSlot, sessionRawSeconds, validateResolvedSlot } from './resolvedSlotContract.js';
import { coverageCreditForSlot, evaluateWeeklyCoverage } from './weeklyCoverageV3.js';
import { groupContributionFor, weeklyPrescribedGroupTotals, MAJOR_GROUPS, SUPPORTING_GROUPS, DELT_HEAD_GROUPS } from './muscleVolumeGroups.js';
import { buildVolumePrescriptionV3 } from './volumePrescriptionV3.js';

const fail = (reason) => ({ ok: false, reason });
const clone = (v) => Array.isArray(v) ? v.map(clone) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
const same = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object'
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k])));
const acc = (accessoryKind) => ({ pattern: 'ACC', intent: 'accessory', accessoryKind });
const secondary = (pattern) => ({ pattern, intent: 'structural_secondary' });
const CORE = { pattern: 'CORE', intent: 'core' };
const key = (kind) => [kind.pattern, kind.intent, kind.accessoryKind].filter(Boolean).join('/');
const DEFAULT_KINDS = [...['SQ', 'HPU', 'HPL', 'HG', 'VPU', 'VPL', 'LU'].map(secondary),
  ...['ham_knee_flexion', 'lateral_delts', 'rear_delts', 'calves', 'biceps', 'triceps', 'glutes'].map(acc), CORE];
export const PRIORITIES = Object.freeze({ 'No preference': null, 'no preference': null, Glutes: 'glutes', glutes: 'glutes',
  Legs: 'legs', legs: 'legs', Back: 'back', back: 'back', Chest: 'chest', chest: 'chest',
  Shoulders: 'shoulders', shoulders: 'shoulders', Arms: 'arms', arms: 'arms' });

/** S4 (generalized): any MAJOR group at zero credited sets first, then the largest relative
 * deficit max(0, min − credited) / min across all MAJOR groups. Ties: side, rear, front,
 * then priority groups, then template group order. Callers skip groups with no fitting candidate.
 */
export function rankMajorGroupsV3(totals, groups, { priorityGroups = [], groupOrder = () => 0 } = {}) {
  const relative = (g) => Math.max(0, groups[g].target.min - totals[g]) / groups[g].target.min;
  const headTie = (g) => { const i = ['side_delts', 'rear_delts', 'front_delts'].indexOf(g); return i < 0 ? 3 : i; };
  return [...MAJOR_GROUPS].sort((a, b) => Number(totals[b] === 0) - Number(totals[a] === 0)
    || relative(b) - relative(a) || headTie(a) - headTie(b)
    || Number(priorityGroups.includes(b)) - Number(priorityGroups.includes(a)) || groupOrder(a) - groupOrder(b));
}

/** { week: 2h resolved week, priorityMuscles?: setup labels (first only), deload?: boolean }.
 * Repeated allocation is refused: input must contain only row-minimum base_template slots.
 * Returns coverage separately; volume shortfalls never create Limited/withheld status.
 */
export function allocateTemplateVolumeV3(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_INPUT');
  const { week: seed, priorityMuscles = [], deload = false } = input;
  if (!Array.isArray(priorityMuscles) || (priorityMuscles.length && !Object.hasOwn(PRIORITIES, priorityMuscles[0])))
    return fail('INVALID_PRIORITY');
  if (typeof deload !== 'boolean') return fail('INVALID_DELOAD');
  if (!seed || !Array.isArray(seed.days)) return fail('INVALID_WEEK');
  const executabilityCache = input.executabilityCache === undefined ? new Map() : input.executabilityCache;
  const durationMinutes = seed.durationMinutes;
  const baseline = evaluateWeeklyCoverage(seed, { durationMinutes, executabilityCache });
  if (!baseline.ok) return baseline;
  const goal = seed.equipmentContext.goal; const tier = seed.tier;
  const prescription = buildVolumePrescriptionV3({ goal, tier });
  if (!prescription.ok) return prescription;
  const priority = priorityMuscles.length ? PRIORITIES[priorityMuscles[0]] : null;
  const mode = durationMinutes === 15 ? 'short_session' : 'standard';
  for (const day of seed.days) {
    if (day.slots.length < 2) return fail('SESSION_EXERCISE_FLOOR_NOT_MET');
    if (new Set(day.slots.map((s) => s.exerciseId)).size !== day.slots.length) return fail('DUPLICATE_IN_SESSION');
    for (const slot of day.slots) {
      if (slot.source !== 'base_template') return fail('TEMPLATE_SEED_REQUIRED');
      const valid = validateResolvedSlot(slot); if (!valid.ok) return valid;
      const approved = resolvePrescription({ exerciseId: slot.exerciseId, slotKind: slot.slotKind, goal, tier, mode });
      if (!approved.ok || !same(slot.resolvedPrescription, approved)) return fail('SEED_PRESCRIPTION_MISMATCH');
      if (slot.sets !== approved.sets.min) return fail('ROW_MINIMUM_SEED_REQUIRED');
    }
    const seconds = sessionRawSeconds(day, durationMinutes);
    if (typeof seconds !== 'number') return seconds;
    if (seconds > durationMinutes * 60 + 60e-9) return fail('SEED_EXCEEDS_BUDGET');
  }
  const week = clone(seed); const decisions = []; const poolCache = new Map();
  const additionsPerDay = week.days.map(() => 0);
  const kinds = [];
  // Authored template order breaks ties; absent kinds use the closed template-schema order.
  for (const kind of [...seed.days.flatMap((d) => d.slots.map((s) => s.slotKind)), ...DEFAULT_KINDS]) {
    const candidate = kind.intent === 'structural_primary' ? secondary(kind.pattern) : kind;
    if (!kinds.some((k) => key(k) === key(candidate))) kinds.push(candidate);
  }
  let volume; let reservedPotential = null;
  const pendingRequirements = Object.entries(baseline.requirements).filter(([, r]) => r.required && r.executable && r.achieved < r.target);
  const creditCache = new Map();
  const credits = (slot) => {
    const k = slot.exerciseId + '/' + key(slot.slotKind);
    if (!creditCache.has(k)) creditCache.set(k, coverageCreditForSlot(slot).credits);
    return creditCache.get(k);
  };
  const refresh = () => {
    reservedPotential = null;
    volume = weeklyPrescribedGroupTotals(week);
    if (!volume.ok) throw new Error(volume.reason);
    for (const day of week.days) {
      day.rawSeconds = sessionRawSeconds(day, durationMinutes);
      if (typeof day.rawSeconds !== 'number') throw new Error(day.rawSeconds.reason);
    }
  };
  const deficit = (group) => Math.max(0, prescription.groups[group].target.min - volume.totals[group]);
  const priorityGroups = priority === 'legs' ? ['quadriceps', 'hamstrings', 'glutes']
    : priority === 'shoulders' ? DELT_HEAD_GROUPS : [priority];
  const relativeDeficit = (head) => deficit(head) / prescription.groups[head].target.min;
  const rankHeads = () => rankMajors().filter((g) => DELT_HEAD_GROUPS.includes(g));
  const rankMajors = () => rankMajorGroupsV3(volume.totals, prescription.groups, { priorityGroups, groupOrder });
  const frontAllowed = (slot) => {
    const contribution = groupContributionFor(slot);
    return contribution.ok && (contribution.groups.front_delts / slot.sets < 1 || deficit('front_delts') > 0);
  };
  const kindOrder = (kind) => kinds.findIndex((k) => key(k) === key(kind));
  const groupOrder = (group) => Math.min(...kinds.map((kind, i) => {
    if (kind.pattern === 'CORE') return group === 'abdominals' ? i : Infinity;
    if (kind.pattern === 'ACC') return ({ ham_knee_flexion: 'hamstrings', lateral_delts: 'side_delts', rear_delts: 'rear_delts' }[kind.accessoryKind] || kind.accessoryKind) === group ? i : Infinity;
    const groups = { SQ: ['quadriceps', 'glutes'], LU: ['quadriceps', 'glutes'], HG: ['hamstrings', 'glutes'],
      HPU: ['chest'], VPU: ['front_delts', 'side_delts'], HPL: ['back', 'rear_delts'], VPL: ['back'] };
    return groups[kind.pattern]?.includes(group) ? i : Infinity;
  }));
  const direct = (slot, group) => {
    const c = groupContributionFor(slot);
    return c.ok && c.groups[group] / slot.sets === 1;
  };
  const pool = (kind) => {
    const k = key(kind);
    if (!poolCache.has(k)) {
      const result = resolveSlotCandidates({ slotKind: kind, goal, tier, mode, athleteContext: week.equipmentContext,
        timingCheck: (p) => validateResolvedSlot({ exerciseId: p.exerciseId, slotKind: kind, mode, sets: p.sets.min, resolvedPrescription: p }) });
      if (!result.ok) throw new Error(result.reason);
      poolCache.set(k, result.candidates.map((c) => ({ ...c, slotKind: kind, mode, sets: c.resolvedPrescription.sets.min,
        source: 'optional_addition' })));
    }
    return poolCache.get(k);
  };
  // Preserve space for achievable, still-missing required exposures. An optional set must
  // not use the last ball-curl-sized gap simply because a bridge supplies fractional volume.
  // This is a feasibility guard, not a repair or a promise of simultaneous feasibility.
  const potentialFor = (proposal, requirement) => {
    const eligible = kinds.flatMap(pool).filter((s) => credits(s)[requirement]);
    return proposal.days.filter((day) => day.slots.some((s) => credits(s)[requirement])
      || eligible.some((s) => !day.slots.some((existing) => existing.exerciseId === s.exerciseId)
        && canPlaceResolvedSlot(day, s, durationMinutes) === true)).length;
  };
  const preservesRequiredSpace = (dayIndex, slot, replaceIndex) => {
    if (!pendingRequirements.length) return true;
    if (reservedPotential === null) reservedPotential = Object.fromEntries(pendingRequirements.map(([k]) => [k, potentialFor(week, k)]));
    const day = week.days[dayIndex];
    const slots = replaceIndex === undefined ? [...day.slots, slot] : day.slots.map((s, i) => i === replaceIndex ? slot : s);
    const proposal = { ...week, days: week.days.map((d, i) => i === dayIndex ? { ...d, slots } : d) };
    return pendingRequirements.every(([k, r]) => reservedPotential[k] < r.target || potentialFor(proposal, k) >= r.target);
  };
  const optionsFor = (group, selectedKinds = kinds, dayAllowed = () => true, qualifying = () => true) => {
    const options = [];
    for (const kind of selectedKinds) for (const slot of pool(kind)) {
      if (!direct(slot, group) || !frontAllowed(slot) || !qualifying(slot)) continue;
      for (const [dayIndex, day] of week.days.entries()) {
        if (!dayAllowed(dayIndex) || day.slots.some((s) => s.exerciseId === slot.exerciseId)) continue;
        if (canPlaceResolvedSlot(day, slot, durationMinutes) === true && preservesRequiredSpace(dayIndex, slot)) options.push({ dayIndex, slot });
      }
    }
    return options;
  };
  const choose = (options, group) => {
    const dayCredits = new Map();
    const dayCredit = (i) => {
      if (!dayCredits.has(i)) dayCredits.set(i, weeklyPrescribedGroupTotals({ days: [week.days[i]] }).totals[group]);
      return dayCredits.get(i);
    };
    return options.sort((a, b) => {
      return additionsPerDay[a.dayIndex] - additionsPerDay[b.dayIndex]
        || dayCredit(a.dayIndex) - dayCredit(b.dayIndex)
        || week.days[a.dayIndex].rawSeconds - week.days[b.dayIndex].rawSeconds
        || a.dayIndex - b.dayIndex || kindOrder(a.slot.slotKind) - kindOrder(b.slot.slotKind)
        || (a.slot.exerciseId < b.slot.exerciseId ? -1 : a.slot.exerciseId > b.slot.exerciseId ? 1 : 0);
    })[0];
  };
  const append = (option, phase, group) => {
    const { dayIndex } = option; const slot = { ...clone(option.slot), allocationPhase: phase, allocationGroup: group };
    // Priority work follows primaries, before supplementary work; base relative order survives.
    const day = week.days[dayIndex];
    const firstNonPrimary = day.slots.findIndex((s) => s.slotKind.intent !== 'structural_primary');
    if (phase === 'priority' && firstNonPrimary >= 0) day.slots.splice(firstNonPrimary, 0, slot);
    else day.slots.push(slot);
    additionsPerDay[dayIndex]++;
    decisions.push({ action: 'add_slot', phase, group, dayIndex, exerciseId: slot.exerciseId, slotKind: slot.slotKind, sets: slot.sets });
    refresh();
  };
  try {
    refresh();
    if (deload) {
      for (const day of week.days) for (const slot of day.slots) {
        const p = slot.resolvedPrescription;
        if (p.targetRir !== null) p.targetRir = { min: p.targetRir.max, max: p.targetRir.max };
      }
    } else if (mode !== 'short_session') {
      // Phase 1: one effective priority, no target increase. Unmet essential coverage prevents
      // this optional phase consuming repair space; the seed remains intact in every phase.
      const essentialMissing = Object.values(baseline.requirements).some((r) => r.required && r.executable && r.status !== 'met');
      if (priority === 'shoulders' && !essentialMissing) {
        for (const head of rankHeads()) {
          if (!deficit(head)) continue;
          const headKinds = head === 'side_delts' ? [acc('lateral_delts')] : head === 'rear_delts' ? [acc('rear_delts')]
            : kinds.filter((k) => k.intent === 'structural_secondary');
          const selected = choose(optionsFor(head, headKinds), head);
          if (selected) { append(selected, 'priority', head); break; }
        }
      } else if (priority && !essentialMissing) {
        let group = priority === 'arms' ? (volume.totals.biceps <= volume.totals.triceps ? 'biceps' : 'triceps')
          : priority === 'legs' ? [...priorityGroups].sort((a, b) => deficit(b) - deficit(a) || groupOrder(a) - groupOrder(b))[0] : priority;
        let selectedKinds; let qualifying = () => true;
        if (priority === 'back') {
          const counts = baseline.exposures.counts;
          const orientation = ['HPL', 'VPL'].sort((a, b) => counts[a] - counts[b] || kindOrder(secondary(a)) - kindOrder(secondary(b)))[0];
          selectedKinds = [secondary(orientation)]; qualifying = (s) => Boolean(coverageCreditForSlot(s).credits[orientation]);
        } else {
          const accessory = group === 'hamstrings' ? 'ham_knee_flexion' : group;
          const kind = acc(accessory);
          const available = DEFAULT_KINDS.some((k) => key(k) === key(kind)) && pool(kind).some((s) => direct(s, group));
          selectedKinds = available ? [kind] : kinds.filter((k) => k.intent === 'structural_secondary');
          if (!available) qualifying = (s) => Boolean(coverageCreditForSlot(s).credits[s.slotKind.pattern]);
        }
        const selected = choose(optionsFor(group, selectedKinds, () => true, qualifying), group);
        if (selected) append(selected, 'priority', group);
      }
      // Phase 2a: exhaust executable one-set increases before adding any MAJOR whole slot.
      const growSets = () => {
      while (true) {
        let selected;
        const groups = rankMajors();
        for (const group of groups) {
          if (!deficit(group)) continue;
          const options = [];
          for (const [dayIndex, day] of week.days.entries()) for (const [slotIndex, current] of day.slots.entries()) {
            if (current.sets >= current.resolvedPrescription.sets.max || !frontAllowed(current)) continue;
            const slot = { ...current, sets: current.sets + 1 };
            const before = groupContributionFor(current); const after = groupContributionFor(slot);
            if (!after.ok || after.groups[group] <= before.groups[group]) continue;
            if (canPlaceResolvedSlot({ slots: day.slots.filter((_, i) => i !== slotIndex) }, slot, durationMinutes) === true
              && preservesRequiredSpace(dayIndex, slot, slotIndex))
              options.push({ dayIndex, slotIndex, slot });
          }
          // S4: a side deficit prefers side-direct work over overhead pressing's half credit.
          const sideDirect = group === 'side_delts' ? options.filter((o) => direct(o.slot, group)) : [];
          const option = choose(sideDirect.length ? sideDirect : options, group);
          if (option) { selected = { ...option, group }; break; }
        }
        if (!selected) break;
        const { dayIndex, slotIndex, slot, group } = selected;
        week.days[dayIndex].slots[slotIndex] = slot; additionsPerDay[dayIndex]++;
        decisions.push({ action: 'add_set', phase: 'major', group, dayIndex, exerciseId: slot.exerciseId, sets: slot.sets });
        refresh();
      }
      };
      growSets();
      // Phase 2b: rank whole-week deficits after every placement, then distribute across days.
      while (true) {
        let placed = false;
        for (const group of rankMajors()) {
          if (!deficit(group)) continue;
          const selected = choose(optionsFor(group), group);
          if (selected) { append(selected, 'major', group); growSets(); placed = true; break; }
        }
        if (!placed) break;
      }
      // Phase 3: only now are all remaining MAJOR deficits closed or unservable in this budget.
      const supportingDays = new Set();
      for (let added = 0; added < 2; added++) {
        let placed = false;
        for (const group of [...SUPPORTING_GROUPS].sort((a, b) => volume.totals[a] - volume.totals[b] || groupOrder(a) - groupOrder(b))) {
          const selected = choose(optionsFor(group, [group === 'abdominals' ? CORE : acc(group)], (i) => !supportingDays.has(i)), group);
          if (selected) { append(selected, 'supporting', group); supportingDays.add(selected.dayIndex); placed = true; break; }
        }
        if (!placed) break;
      }
    }
    refresh();
    const coverage = evaluateWeeklyCoverage(week, { durationMinutes, executabilityCache });
    if (!coverage.ok) return coverage;
    if (coverage.capacity !== baseline.capacity || Object.entries(baseline.requirements).some(([k, r]) => r.required && coverage.requirements[k].achieved < r.achieved))
      return fail('REQUIRED_COVERAGE_LOST');
    const shortfalls = MAJOR_GROUPS.filter((g) => deficit(g)).map((group) => ({ group, prescribed: volume.totals[group], lowerBound: prescription.groups[group].target.min }));
    return { ok: true, allocationMode: 'template_seeded_v3', week, coverage, volume, prescription,
      effectivePriority: priority, decisions, shortfalls,
      headDiagnostics: DELT_HEAD_GROUPS.map((head) => ({ head, prescribed: volume.totals[head],
        range: prescription.groups[head].target, deficit: deficit(head), relativeDeficit: relativeDeficit(head),
        surplus: Math.max(0, volume.totals[head] - prescription.groups[head].target.max) })),
      notes: shortfalls.length && ['muscle_gain', 'fat_loss'].includes(goal) ? [{ type: 'soft_volume_shortfall', groups: shortfalls,
        message: 'This plan fits your available time. Longer sessions could allow more weekly muscle-building work.' }] : [],
      ...(deload ? { skipped: 'DELOAD_NO_ADDITIONS' } : mode === 'short_session' ? { skipped: 'SHORT_SESSION_NO_ADDITIONS' } : {}) };
  } catch (error) { return fail(error.message); }
}
