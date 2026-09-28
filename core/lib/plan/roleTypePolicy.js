/**
 * Role -> allowed exerciseType values for plan resolution.
 * primary, accessory and finisher are resistance roles in this pipeline.
 * Any role outside this closed vocabulary (including inherited object keys
 * such as 'constructor' or '__proto__') returns null.
 * Canonical home: EndopaminRegistry core/lib/plan/. Mirrored byte-for-byte
 * to EndopaminMobile src/lib/plan/. Do not edit the Mobile copy directly.
 */
export const ALLOWED_TYPES_BY_ROLE = Object.freeze({
  primary: Object.freeze(['resistance']),
  accessory: Object.freeze(['resistance']),
  finisher: Object.freeze(['resistance']),
});

export function allowedTypesForRole(role) {
  return Object.hasOwn(ALLOWED_TYPES_BY_ROLE, role)
    ? ALLOWED_TYPES_BY_ROLE[role]
    : null;
}
