/** Session timing contract v1 T6. Standalone; targets never change the floor. */
export const MIN_MAIN_EXERCISES = 2;

/** Returns a desired count, or { ok: false, reason } for an unsupported duration. */
export function targetMainExercises(selectedMinutes) {
  switch (selectedMinutes) {
    case 15: return 3;
    case 30:
    case 45:
    case 60:
    case 75: return 4;
    default: return { ok: false, reason: 'UNSUPPORTED_DURATION' };
  }
}
