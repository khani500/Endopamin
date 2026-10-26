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
  if ([15, 30, 45, 60, 75].includes(value)) {
    return { ok: true, sessionMinutes: value };
  }
  return { ok: false, reason: 'UNSUPPORTED_SESSION_DURATION' };
}

