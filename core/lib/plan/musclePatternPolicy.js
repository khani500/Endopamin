/**
 * Muscle / pattern policy — Endopamin
 *
 * The single source of truth for how muscles map to movement patterns and back.
 *
 * These two maps were module-private constants inside planPipeline.js and were
 * exported to nobody. Three copies existed: the pipeline's own, a hand-written
 * fixture inside weeklySlotPlanner.contract.test.mjs, and a verbatim copy in every
 * measurement probe. Two copies of one rule is how equipmentSatisfied diverged in
 * S15; three is worse. The slot builder, any future allocator, and the tests must
 * read the same object.
 *
 * This module holds DATA ONLY. No behaviour, no derivation, no defaults. Moving it
 * here changed nothing: the values below are byte-identical to the ones that lived
 * in planPipeline.js at commit b5ec256, and the resolver baseline is unchanged.
 */

/**
 * Which patterns actually load a given muscle. The slot builder derives slots from focus, not from a split.
 *
 * chest lists horizontal_push ONLY. It used to list vertical_push as well, which produced
 * chest slots that no candidate could serve: measured across 48 profiles, 30 chest slots
 * resolved to an overhead press, and in every one of them NO candidate in the pool named
 * chest as either a primary or a secondary muscle. An overhead press is a shoulder movement;
 * the map was the thing overstating it, not the resolver, which ranked correctly throughout
 * (C25). A home_full beginner had exactly one candidate for that slot and it was wrong.
 *
 * Khani ruling (S16): fewer patterns is not a cost. A slot that cannot be served is worse
 * than no slot. Where chest needs more volume, C28 adds angles within horizontal_push —
 * flat, incline, decline — never an overhead press.
 */

export const PATTERNS_FOR_MUSCLE = {
  chest: ['horizontal_push'],
  lats: ['vertical_pull', 'horizontal_pull'],
  'middle back': ['horizontal_pull'],
  quadriceps: ['squat', 'lunge', 'knee_extension'],
  hamstrings: ['hinge', 'knee_flexion'],
  glutes: ['hinge', 'lunge'],
  shoulders: ['vertical_push', 'shoulder_iso'],
  biceps: ['arms_pull'],
  triceps: ['arms_push'],
  abdominals: ['core', 'rotation'],
  calves: ['calves'],
};

export const MUSCLES_FOR_PATTERN = {
  squat: ['quadriceps', 'glutes'], hinge: ['hamstrings', 'glutes'], lunge: ['quadriceps', 'glutes'],
  horizontal_push: ['chest', 'triceps'], vertical_push: ['shoulders', 'triceps'],
  horizontal_pull: ['middle back', 'lats'], vertical_pull: ['lats', 'biceps'],
  shoulder_iso: ['shoulders'], shoulder_extension: ['lats'], arms_push: ['triceps'],
  arms_pull: ['biceps'], knee_flexion: ['hamstrings'],
  // Migration 008 split leg_iso into four joint actions. leg_iso itself is gone
  // from this map: it retains one record (fx_hip_flexion_with_band) and zero
  // resolver-active ones, so any query against it returns nothing.
  knee_extension: ['quadriceps'],
  hip_abduction: ['glutes', 'abductors'],
  hip_adduction: ['adductors'],
  hip_extension: ['glutes'],
  calves: ['calves'], core: ['abdominals'], rotation: ['abdominals'], carry: ['forearms', 'traps'],
};
