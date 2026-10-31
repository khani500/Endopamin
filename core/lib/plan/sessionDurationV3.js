export const SUPPORTED_SESSION_MINUTES_V3 = Object.freeze([20, 30, 45, 60, 75]);
export const SHORT_SESSION_MINUTES_V3 = 20;

/** D1: V3-only internal normalization; never changes a stored value or legacy caller.
 * Accept numeric minutes only. Refusals carry no usable duration or default.
 */
export function normalizeSessionDurationV3(value) {
  if (value === null || value === undefined) {
    return { ok: false, reason: 'MISSING_SESSION_DURATION' };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, reason: 'INVALID_SESSION_DURATION' };
  }
  if (value === 90) return { ok: true, sessionMinutes: 75 };
  if (SUPPORTED_SESSION_MINUTES_V3.includes(value)) {
    return { ok: true, sessionMinutes: value };
  }
  return { ok: false, reason: 'UNSUPPORTED_SESSION_DURATION' };
}

const row = (mode, warmupSeconds, targetMainExercises, maxMainExercises, thirdSlotCap, requiredExtensionCapSeconds) =>
  Object.freeze({ mode, warmupSeconds, targetMainExercises, maxMainExercises, thirdSlotCap, requiredExtensionCapSeconds });
// Session timing contract v1 §3/§5/§6. A null limit means this table adds no limit at that duration.
const POLICY = Object.freeze({
  20: row('short_session', 180, 3, 3, 1, 0),
  30: row('standard', 300, 4, null, null, 300),
  45: row('standard', 480, 4, null, null, 300),
  60: row('standard', 480, 4, null, null, 600),
  75: row('standard', 480, 4, null, null, 600),
});

/** The per-duration row, or null for anything but an exact supported number. Saved 90 normalizes first. */
export function sessionDurationPolicyV3(minutes) {
  return SUPPORTED_SESSION_MINUTES_V3.includes(minutes) ? POLICY[minutes] : null;
}

/** The one mode derivation. Every stage still refuses unsupported minutes through its own duration check. */
export function sessionModeV3(minutes) {
  return sessionDurationPolicyV3(minutes)?.mode === 'short_session' ? 'short_session' : 'standard';
}
