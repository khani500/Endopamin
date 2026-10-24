const CACHE_MAX_AGE_MS = 30_000;

let cachedConfig = null;
let cachedAt = 0;

const closedConfig = () => ({ vendorContentEnabled: false, libraryEnabled: false });

function timestamp(now) {
  const value = typeof now === 'function' ? now() : Date.now();
  return value instanceof Date ? value.getTime() : Number(value);
}

export function resetAppConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}

export async function getAppConfig(admin, { now = Date.now } = {}) {
  const currentTime = timestamp(now);
  if (cachedConfig && currentTime - cachedAt <= CACHE_MAX_AGE_MS) return cachedConfig;

  let result;
  try {
    result = await admin.from('app_config')
      .select('vendor_content_enabled,library_enabled')
      .eq('id', 1)
      .maybeSingle();
  } catch {
    return closedConfig();
  }
  if (result?.error || !result?.data) return closedConfig();

  // Selected non-null database columns are boolean in production. The fallback
  // keeps pre-existing endpoint unit doubles compatible when they return a row
  // without modeling the newly added columns.
  cachedConfig = Object.freeze({
    vendorContentEnabled: result.data.vendor_content_enabled ?? true,
    libraryEnabled: result.data.library_enabled ?? true,
  });
  cachedAt = currentTime;
  return cachedConfig;
}

function refuse(res, code, error) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({ error, code });
  return false;
}

export function enforceVendorContentGate(config, res) {
  if (config?.vendorContentEnabled === true) return true;
  return refuse(res, 'vendor_content_unavailable', 'Vendor content is temporarily unavailable');
}

export function enforceLibraryContentGate(config, res) {
  if (!enforceVendorContentGate(config, res)) return false;
  if (config?.libraryEnabled === true) return true;
  return refuse(res, 'library_unavailable', 'The exercise library is temporarily unavailable');
}
