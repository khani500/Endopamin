/**
 * Equipment contract: bucket -> token lists, extras tokens, status and reason
 * vocabulary, and the resolver that turns a stored bucket plus stored extras
 * into the final capability.
 * Fail-closed: a bucket is an own key of EQUIPMENT_BUCKETS or no tokens are
 * granted. Missing and invalid values never collapse to bodyweight.
 * Extras are validated first, on the extras array alone, then the bucket.
 * Every returned token array is a fresh copy.
 * Contract revisions: omitted or 'current' is the contract above, unchanged.
 * Only an explicit 'home_kit_v1' grants the Home kit; unknown revisions are refused.
 * Canonical home: EndopaminRegistry resolver core (core/lib/plan/). Mirrored
 * byte-for-byte to published destinations. Do not edit a mirrored copy.
 */

export const EQUIPMENT_STATUS_OK = 'ok';
export const EQUIPMENT_STATUS_NOT_LOADED = 'equipment_not_loaded';
export const EQUIPMENT_STATUS_INVALID = 'invalid_equipment';

/**
 * Cause tagged onto invalid_equipment when equipment_extras failed validation.
 * Not a status constant: status stays invalid_equipment.
 */
export const EQUIPMENT_STATUS_REASON_EXTRAS = 'equipment_extras';

export const EQUIPMENT_EXTRAS_REASONS = Object.freeze({
  notArray: 'not_array',
  invalidElement: 'invalid_element',
  unknownToken: 'unknown_token',
  duplicateToken: 'duplicate_token',
  doorAnchorRequiresBands: 'door_anchor_requires_bands',
});

/**
 * Bucket reason codes. Key names match the Server's EQUIPMENT_REASON_CODES,
 * plus blank. blank is a save-boundary code; the planning resolver reports a
 * blank bucket as equipment_not_loaded with no reason code.
 */
export const EQUIPMENT_REASON_CODES = Object.freeze({
  legacyObjectString: 'equipment_legacy_object_string',
  unknownToken: 'equipment_unknown_token',
  arrayNotAllowed: 'equipment_array_not_allowed',
  objectNotAllowed: 'equipment_object_not_allowed',
  invalidType: 'equipment_invalid_type',
  blank: 'equipment_blank',
});

export const EQUIPMENT_EXTRA_TOKENS = Object.freeze([
  'bands',
  'pullup_bar',
  'door_anchor',
]);

export const EQUIPMENT_BUCKETS = Object.freeze({
  full_gym: Object.freeze([
    'bodyweight', 'barbell', 'dumbbell', 'cable', 'machine',
    'kettlebell', 'bands', 'plate', 'pullup_bar', 'exercise_ball',
    'foam_roller', 'medicine_ball', 'suspension',
    'conditioning_tool', 'sled', 'strongman', 'bench',
  ]),
  home_full: Object.freeze([
    'bodyweight', 'dumbbell', 'bands', 'kettlebell',
    'exercise_ball', 'foam_roller',
  ]),
  home_basic: Object.freeze(['bodyweight', 'bands', 'foam_roller', 'exercise_ball']),
  bodyweight: Object.freeze(['bodyweight']),
});

export const EQUIPMENT_BUCKET_IDS = Object.freeze(Object.keys(EQUIPMENT_BUCKETS));

/** Unclassified registry buckets. Excluded from every bucket until audited. */
export const EQUIPMENT_REVIEW_REQUIRED = Object.freeze(['other', 'misc_tool']);

export const EQUIPMENT_CONTRACT_REVISION_CURRENT = 'current';
export const EQUIPMENT_CONTRACT_REVISIONS = Object.freeze([EQUIPMENT_CONTRACT_REVISION_CURRENT, 'home_kit_v1']);

/** Reason for a refused revision. Status stays invalid_equipment. */
export const EQUIPMENT_CONTRACT_REVISION_UNKNOWN = 'equipment_contract_revision_unknown';

// home_kit_v1: each current bucket array unchanged, implied Home kit tokens appended.
const HOME_KIT_V1_BUCKETS = Object.freeze({
  full_gym: Object.freeze([...EQUIPMENT_BUCKETS.full_gym, 'chair']),
  home_full: Object.freeze([...EQUIPMENT_BUCKETS.home_full, 'door_anchor', 'chair']),
  home_basic: Object.freeze([...EQUIPMENT_BUCKETS.home_basic, 'door_anchor', 'chair']),
  bodyweight: Object.freeze([...EQUIPMENT_BUCKETS.bodyweight, 'bands', 'door_anchor', 'chair']),
});

const contractOf = (revision, buckets) => Object.freeze({
  revision,
  buckets,
  // Raw extras rules are identical under every revision.
  extraTokens: EQUIPMENT_EXTRA_TOKENS,
  tokenUniverse: Object.freeze([...new Set([...Object.values(buckets).flat(), ...EQUIPMENT_EXTRA_TOKENS])]),
});

const CONTRACTS = new Map([
  [EQUIPMENT_CONTRACT_REVISION_CURRENT, contractOf(EQUIPMENT_CONTRACT_REVISION_CURRENT, EQUIPMENT_BUCKETS)],
  ['home_kit_v1', contractOf('home_kit_v1', HOME_KIT_V1_BUCKETS)],
]);

const REVISION_REFUSAL = Object.freeze({ ok: false, reason: EQUIPMENT_CONTRACT_REVISION_UNKNOWN });

/**
 * Pure revision lookup. Only undefined means omitted (current); every other
 * value must name a known revision exactly.
 *
 * @param {unknown} revision
 * @returns {Readonly<{ revision: string, buckets: object, extraTokens: string[], tokenUniverse: string[] }>
 *   | Readonly<{ ok: false, reason: string }>}
 */
export function equipmentContractFor(revision) {
  if (revision === undefined) return CONTRACTS.get(EQUIPMENT_CONTRACT_REVISION_CURRENT);
  return typeof revision === 'string' && CONTRACTS.has(revision) ? CONTRACTS.get(revision) : REVISION_REFUSAL;
}

/** Contract declared by a canonical equipment context: an absent equipmentContractRevision means current. */
export function equipmentContractForContext(context) {
  return equipmentContractFor(context?.equipmentContractRevision);
}

// Options are omitted or a plain object; anything else is refused, never read as current.
function contractFromOptions(options) {
  if (options === undefined) return equipmentContractFor(undefined);
  if (options === null || typeof options !== 'object') return REVISION_REFUSAL;
  // Only plain objects: arrays, Date, Map, class instances and custom prototypes are refused.
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) return REVISION_REFUSAL;
  return equipmentContractFor(options.revision);
}

const TOKEN_SET = new Set(EQUIPMENT_EXTRA_TOKENS);

/**
 * @param {unknown} value
 * @param {{ revision?: string }} [options]
 * @returns {{ ok: true, value: string[] } | { ok: false, reason: string }}
 */
export function validateEquipmentExtras(value, options) {
  if (contractFromOptions(options).ok === false) {
    return { ok: false, reason: EQUIPMENT_CONTRACT_REVISION_UNKNOWN };
  }
  if (value === null || value === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, reason: EQUIPMENT_EXTRAS_REASONS.notArray };
  }
  if (value.length === 0) {
    return { ok: true, value: [] };
  }

  for (const token of value) {
    if (typeof token !== 'string') {
      return { ok: false, reason: EQUIPMENT_EXTRAS_REASONS.invalidElement };
    }
    if (!TOKEN_SET.has(token)) {
      return { ok: false, reason: EQUIPMENT_EXTRAS_REASONS.unknownToken };
    }
  }
  if (new Set(value).size !== value.length) {
    return { ok: false, reason: EQUIPMENT_EXTRAS_REASONS.duplicateToken };
  }
  if (value.includes('door_anchor') && !value.includes('bands')) {
    return { ok: false, reason: EQUIPMENT_EXTRAS_REASONS.doorAnchorRequiresBands };
  }

  const ordered = EQUIPMENT_EXTRA_TOKENS.filter((token) => value.includes(token));
  return { ok: true, value: ordered };
}

function isBlankEquipment(raw) {
  return raw === null
    || raw === undefined
    || raw === ''
    || (typeof raw === 'string' && raw.trim() === '');
}

function invalidBucket(reasonCode) {
  return {
    equipmentStatus: EQUIPMENT_STATUS_INVALID,
    availableEquipment: null,
    equipmentBucket: null,
    equipmentReasonCode: reasonCode,
  };
}

// Classification order matches the Server validator.
function resolveBucket(raw, buckets) {
  if (isBlankEquipment(raw)) {
    return {
      equipmentStatus: EQUIPMENT_STATUS_NOT_LOADED,
      availableEquipment: null,
      equipmentBucket: null,
      equipmentReasonCode: null,
    };
  }
  if (raw === '{}') return invalidBucket(EQUIPMENT_REASON_CODES.legacyObjectString);
  if (typeof raw === 'string') {
    if (!Object.hasOwn(buckets, raw)) {
      return invalidBucket(EQUIPMENT_REASON_CODES.unknownToken);
    }
    return {
      equipmentStatus: EQUIPMENT_STATUS_OK,
      availableEquipment: [...buckets[raw]],
      equipmentBucket: raw,
      equipmentReasonCode: null,
    };
  }
  if (Array.isArray(raw)) return invalidBucket(EQUIPMENT_REASON_CODES.arrayNotAllowed);
  if (typeof raw === 'object') return invalidBucket(EQUIPMENT_REASON_CODES.objectNotAllowed);
  return invalidBucket(EQUIPMENT_REASON_CODES.invalidType);
}

/**
 * Resolve the final equipment capability from a stored bucket and stored extras.
 * A stored extra the revision's bucket already implies is a duplicate and adds nothing.
 *
 * @param {unknown} bucket
 * @param {unknown} extras
 * @param {{ revision?: string }} [options]
 * @returns {{
 *   availableEquipment: string[]|null,
 *   equipmentBucket: string|null,
 *   equipmentStatus: string,
 *   equipmentStatusReason: string|null,
 *   equipmentReasonCode: string|null,
 * }}
 */
export function resolveEquipmentCapability(bucket, extras, options) {
  const contract = contractFromOptions(options);
  if (contract.ok === false) {
    return {
      availableEquipment: null,
      equipmentBucket: null,
      equipmentStatus: EQUIPMENT_STATUS_INVALID,
      equipmentStatusReason: EQUIPMENT_CONTRACT_REVISION_UNKNOWN,
      equipmentReasonCode: EQUIPMENT_CONTRACT_REVISION_UNKNOWN,
    };
  }
  const extrasResult = validateEquipmentExtras(extras);

  // Extras validation runs on the extras array alone: bands in the bucket
  // do not make ['door_anchor'] valid.
  if (!extrasResult.ok) {
    return {
      availableEquipment: null,
      equipmentBucket: null,
      equipmentStatus: EQUIPMENT_STATUS_INVALID,
      equipmentStatusReason: EQUIPMENT_STATUS_REASON_EXTRAS,
      equipmentReasonCode: extrasResult.reason,
    };
  }

  const resolved = resolveBucket(bucket, contract.buckets);
  if (resolved.equipmentStatus !== EQUIPMENT_STATUS_OK) {
    return {
      availableEquipment: resolved.availableEquipment,
      equipmentBucket: resolved.equipmentBucket,
      equipmentStatus: resolved.equipmentStatus,
      equipmentStatusReason: null,
      equipmentReasonCode: resolved.equipmentReasonCode,
    };
  }

  const bucketTokens = resolved.availableEquipment;
  const validExtras = extrasResult.value;
  const seen = new Set(bucketTokens);
  const merged = [...bucketTokens];
  for (const token of contract.extraTokens) {
    if (!validExtras.includes(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    merged.push(token);
  }

  return {
    availableEquipment: merged,
    equipmentBucket: resolved.equipmentBucket,
    equipmentStatus: EQUIPMENT_STATUS_OK,
    equipmentStatusReason: null,
    equipmentReasonCode: null,
  };
}
