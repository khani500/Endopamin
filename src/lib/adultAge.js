import { MAX_AGE, MIN_AGE } from './profileValidation.js';

// Same rules as validateAge's parseInteger: integer numbers, or a trimmed
// string of optional minus + digits. "18" and " 18 " parse; "18.0", "17.5",
// and "abc" do not.
function parseInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function isMissing(value) {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

export function classifyStoredAge(value) {
  if (isMissing(value)) return 'missing';
  const parsed = parseInteger(value);
  if (parsed === null || parsed <= 0 || parsed > MAX_AGE) return 'invalid';
  if (parsed < MIN_AGE) return 'underage';
  return 'ok';
}
