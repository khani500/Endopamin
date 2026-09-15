/**
 * Copy-identical in EndopaminMobile and Edopamin.
 * The repos cannot share a test in CI; keep this object in lockstep.
 *
 * fields.health_conditions on POST /api/save-profile for each Level 1 answer.
 * value is a token array; intent is confirmed. No provenance state.
 */
export const HEALTH_CONDITIONS_WIRE = Object.freeze({
  none: Object.freeze({ value: Object.freeze(['none']), intent: 'confirmed' }),
  prefer_not_to_answer: Object.freeze({
    value: Object.freeze(['prefer_not_to_answer']),
    intent: 'confirmed',
  }),
  yes_breathing: Object.freeze({ value: Object.freeze(['breathing']), intent: 'confirmed' }),
  yes_pregnancy_routine: Object.freeze({
    value: Object.freeze(['pregnancy', 'pregnancy_routine']),
    intent: 'confirmed',
  }),
  yes_musculoskeletal_acute: Object.freeze({
    value: Object.freeze(['musculoskeletal', 'musculoskeletal_acute']),
    intent: 'confirmed',
  }),
});

export const HEALTH_CONDITIONS_STORED = Object.freeze({
  none: '["none"]',
  prefer_not_to_answer: '["prefer_not_to_answer"]',
  yes_breathing: '["breathing"]',
  yes_pregnancy_routine: '["pregnancy","pregnancy_routine"]',
  yes_musculoskeletal_acute: '["musculoskeletal","musculoskeletal_acute"]',
});
