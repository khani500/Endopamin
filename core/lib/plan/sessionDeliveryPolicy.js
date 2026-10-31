/** Session timing contract v1 T6. Standalone; targets never change the floor. */
import { sessionDurationPolicyV3 } from './sessionDurationV3.js';

export const MIN_MAIN_EXERCISES = 2;

/** Returns a desired count, or { ok: false, reason } for an unsupported duration. */
export function targetMainExercises(selectedMinutes) {
  return sessionDurationPolicyV3(selectedMinutes)?.targetMainExercises ?? { ok: false, reason: 'UNSUPPORTED_DURATION' };
}
