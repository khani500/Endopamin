#!/usr/bin/env node
/**
 * Exercise-media production smoke checks and resumable uploader.
 *
 * Credentials come only from process.env. This script never reads dotenv files,
 * prints keys, or writes credentials to its JSON reports.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(ROOT, 'core/data/media-manifest.json');
const BUCKET = 'exercise-media';
const SMOKE_OBJECT = 'V1/exercisedb/0025/0025-360.gif';
const CONCURRENCY = 4;
const RETRIES = 2;
const MANIFEST_KEYS = ['manifestVersion', 'mediaVersion', 'recordCount', 'media', 'sha256'];
const MEDIA_KEYS = ['provider', 'externalMediaId', 'mediaVersion', 'animationPath', 'thumbnailPath'];
const EXERCISE_ID = /^[a-z][a-z0-9_]*$/;
const MEDIA_ID = /^[0-9]{4}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const codeUnitCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));

export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(codeUnitCompare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error(`unsupported manifest value: ${typeof value}`);
}

export function pathsForExternalMediaId(externalMediaId, sourceRoot) {
  if (!MEDIA_ID.test(externalMediaId)) throw new Error(`invalid externalMediaId: ${externalMediaId}`);
  const prefix = `V1/exercisedb/${externalMediaId}`;
  return {
    animation: {
      localPath: path.join(sourceRoot, '360', `${externalMediaId}.gif`),
      targetPath: `${prefix}/${externalMediaId}-360.gif`,
    },
    thumbnail: {
      localPath: path.join(sourceRoot, '180', `${externalMediaId}.gif`),
      targetPath: `${prefix}/${externalMediaId}-180.gif`,
    },
  };
}

export function validateManifest(manifest) {
  if (!exactKeys(manifest, MANIFEST_KEYS)) throw new Error('manifest has unexpected or missing top-level fields');
  if (manifest.manifestVersion !== 1) throw new Error('manifestVersion must be 1');
  if (!Number.isInteger(manifest.mediaVersion) || manifest.mediaVersion < 1) throw new Error('mediaVersion must be positive');
  if (!Number.isInteger(manifest.recordCount) || manifest.recordCount < 1) throw new Error('recordCount must be positive');
  if (!SHA256.test(manifest.sha256)) throw new Error('manifest sha256 is malformed');
  if (!manifest.media || typeof manifest.media !== 'object' || Array.isArray(manifest.media)) throw new Error('manifest media must be an object');

  const exerciseIds = Object.keys(manifest.media);
  const sortedIds = [...exerciseIds].sort(codeUnitCompare);
  if (exerciseIds.some((id, index) => id !== sortedIds[index])) throw new Error('manifest media keys are not in code-unit order');
  if (exerciseIds.length !== manifest.recordCount) throw new Error('manifest recordCount mismatch');

  const externalIds = new Set();
  for (const exerciseId of exerciseIds) {
    const item = manifest.media[exerciseId];
    if (!EXERCISE_ID.test(exerciseId)) throw new Error(`invalid exerciseId: ${exerciseId}`);
    if (!exactKeys(item, MEDIA_KEYS)) throw new Error(`${exerciseId}: unexpected or missing fields`);
    if (item.provider !== 'exercisedb') throw new Error(`${exerciseId}: invalid provider`);
    if (!MEDIA_ID.test(item.externalMediaId)) throw new Error(`${exerciseId}: invalid externalMediaId`);
    if (externalIds.has(item.externalMediaId)) throw new Error(`${exerciseId}: duplicate externalMediaId`);
    externalIds.add(item.externalMediaId);
    if (item.mediaVersion !== manifest.mediaVersion) throw new Error(`${exerciseId}: mediaVersion mismatch`);
    const expected = pathsForExternalMediaId(item.externalMediaId, '.');
    if (item.animationPath !== expected.animation.targetPath) throw new Error(`${exerciseId}: invalid animationPath`);
    if (item.thumbnailPath !== expected.thumbnail.targetPath) throw new Error(`${exerciseId}: invalid thumbnailPath`);
  }

  const hashed = {
    manifestVersion: manifest.manifestVersion,
    mediaVersion: manifest.mediaVersion,
    recordCount: manifest.recordCount,
    media: manifest.media,
  };
  const calculated = sha256(canonical(hashed));
  if (calculated !== manifest.sha256) throw new Error(`manifest sha256 mismatch: expected ${calculated}`);
  return manifest;
}

export function parseCli(argv) {
  const modeFlags = new Map([
    ['--smoke', 'smoke'],
    ['--client-check', 'client-check'],
    ['--dry-run', 'dry-run'],
    ['--upload', 'upload'],
  ]);
  let mode = null;
  let source = null;
  for (const arg of argv) {
    if (modeFlags.has(arg)) {
      if (mode !== null) throw new Error(`duplicate or conflicting mode option: ${arg}`);
      mode = modeFlags.get(arg);
      continue;
    }
    if (arg.startsWith('--source=')) {
      if (source !== null) throw new Error('duplicate option: --source');
      source = arg.slice('--source='.length);
      if (source === '') throw new Error('empty option value: --source');
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }
  mode ||= 'dry-run';
  if ((mode === 'dry-run' || mode === 'upload') && source === null) {
    throw new Error(`--source is required for ${mode}`);
  }
  if ((mode === 'smoke' || mode === 'client-check') && source !== null) {
    throw new Error(`--source is not accepted for ${mode}`);
  }
  return { mode, source: source === null ? null : path.resolve(source) };
}

export function existingObjectDecision(localBytes, remoteBytes) {
  return sha256(localBytes) === sha256(remoteBytes) ? 'skipped_identical' : 'mismatch';
}

export function hasGifMagic(bytes) {
  if (!bytes || bytes.length < 6) return false;
  const magic = Buffer.from(bytes).subarray(0, 6).toString('ascii');
  return magic === 'GIF87a' || magic === 'GIF89a';
}

function requiredEnv(names) {
  const missing = names.filter((name) => typeof process.env[name] !== 'string' || process.env[name] === '');
  if (missing.length > 0) throw new Error(`missing environment variables: ${missing.join(', ')}`);
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function client(url, key) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function retry(label, operation, retries = RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(250 * (2 ** attempt));
    }
  }
  throw new Error(`${label} failed after ${retries + 1} attempts: ${message(lastError)}`);
}

async function dataOrThrow(label, operation) {
  return retry(label, async () => {
    const result = await operation();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });
}

async function dataOnce(label, operation) {
  const result = await operation();
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function bytesFromBlob(blob) {
  return Buffer.from(await blob.arrayBuffer());
}

async function concurrent(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

async function loadManifest() {
  const bytes = await fs.readFile(MANIFEST_PATH);
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`manifest JSON is invalid: ${message(error)}`); }
  return validateManifest(parsed);
}

async function runSmoke() {
  const env = requiredEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const admin = client(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const token = randomUUID();
  let insertedId = null;
  let primaryError = null;
  let cleanupError = null;
  try {
    const row = {
      canonical_exercise_id: null,
      provider: 'd3-service-role-smoke',
      external_media_id: token,
      animation_path: `__smoke__/${token}-360.gif`,
      thumbnail_path: `__smoke__/${token}-180.gif`,
      resolution: '360',
      license_source: 'd3-service-role-smoke',
      media_version: 1,
      format: 'gif',
      active: false,
    };
    const inserted = await dataOnce('smoke INSERT', () => admin.from('exercise_media').insert(row).select('id,license_source').single());
    insertedId = inserted.id;
    if (!insertedId) throw new Error('smoke INSERT returned no id');

    const selected = await dataOrThrow('smoke SELECT', () => admin.from('exercise_media').select('id,external_media_id,active').eq('id', insertedId).single());
    if (selected.external_media_id !== token || selected.active !== false) throw new Error('smoke SELECT returned unexpected data');

    const updated = await dataOnce('smoke UPDATE', () => admin.from('exercise_media')
      .update({ license_source: 'd3-service-role-smoke-updated' }).eq('id', insertedId).select('id,license_source').single());
    if (updated.license_source !== 'd3-service-role-smoke-updated') throw new Error('smoke UPDATE did not persist');

    const deleted = await dataOnce('smoke DELETE', () => admin.from('exercise_media').delete().eq('id', insertedId).select('id').single());
    if (deleted.id !== insertedId) throw new Error('smoke DELETE returned the wrong row');
    insertedId = null;

    const storage = admin.storage.from(BUCKET);
    const listed = await dataOrThrow('smoke storage list', () => storage.list('V1/exercisedb/0025', { limit: 100 }));
    if (!listed.some((entry) => entry.name === '0025-360.gif')) throw new Error(`smoke object is absent: ${SMOKE_OBJECT}`);
    const signed = await dataOrThrow('smoke signed URL', () => storage.createSignedUrl(SMOKE_OBJECT, 60));
    if (!signed?.signedUrl) throw new Error('smoke signed URL response was empty');
    const downloaded = await retry('smoke signed download', async () => {
      const response = await fetch(signed.signedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });
    if (downloaded.length === 0 || !hasGifMagic(downloaded)) throw new Error('smoke signed download is empty or not GIF');
  } catch (error) {
    primaryError = error;
  } finally {
    if (insertedId !== null) {
      try {
        await dataOrThrow('smoke cleanup DELETE', () => admin.from('exercise_media').delete().eq('id', insertedId));
        const residue = await dataOrThrow('smoke cleanup verification', () => admin.from('exercise_media').select('id').eq('id', insertedId).maybeSingle());
        if (residue !== null) throw new Error('smoke cleanup verification found the disposable row');
      } catch (error) {
        cleanupError = error;
        console.error(`SMOKE CLEANUP FAILED: ${message(error)}`);
      }
    }
  }
  if (primaryError && cleanupError) throw new Error(`${message(primaryError)}; cleanup also failed: ${message(cleanupError)}`);
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  console.log('SMOKE_OK: service-role table CRUD and private storage list/sign/download passed');
}

async function firstPublicAvatar(storage) {
  const queue = [{ prefix: '', depth: 0 }];
  let listings = 0;
  while (queue.length > 0 && listings < 100) {
    const { prefix, depth } = queue.shift();
    const entries = await dataOrThrow('anonymous avatar list', () => storage.list(prefix, { limit: 100 }));
    listings += 1;
    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) return objectPath;
      if (depth < 4) queue.push({ prefix: objectPath, depth: depth + 1 });
    }
  }
  return null;
}

async function runClientCheck() {
  const env = requiredEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
  const anon = client(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  const tableResult = await anon.from('exercise_media').select('canonical_exercise_id').limit(1);
  if (!tableResult.error) throw new Error('anonymous exercise_media SELECT unexpectedly succeeded');

  const mediaStorage = anon.storage.from(BUCKET);
  const listResult = await mediaStorage.list('V1/exercisedb/0025', { limit: 100 });
  if (!listResult.error && listResult.data?.some((entry) => entry.name === '0025-360.gif')) {
    throw new Error('anonymous exercise-media list exposed the known object');
  }
  const signResult = await mediaStorage.createSignedUrl(SMOKE_OBJECT, 60);
  if (!signResult.error || signResult.data?.signedUrl) throw new Error('anonymous exercise-media signing unexpectedly succeeded');
  const downloadResult = await mediaStorage.download(SMOKE_OBJECT);
  if (!downloadResult.error || downloadResult.data) throw new Error('anonymous exercise-media download unexpectedly succeeded');

  const avatarStorage = anon.storage.from('avatars');
  const avatarPath = await firstPublicAvatar(avatarStorage);
  if (!avatarPath) throw new Error('no public avatar object was discoverable for anonymous regression check');
  const avatar = await dataOrThrow('anonymous avatar download', () => avatarStorage.download(avatarPath));
  const avatarBytes = await bytesFromBlob(avatar);
  if (avatarBytes.length === 0) throw new Error('anonymous avatar download was empty');

  console.log('CLIENT_CHECK_OK: anon table/list/sign/download denial and public avatar read passed');
  console.log('MANUAL_REQUIRED: sign in as the dedicated test user; confirm authenticated exercise_media and exercise-media list/sign/download are denied, then confirm that user can upload and update only its own avatar.');
}

async function inspectLocalFiles(manifest, source, report) {
  const records = [];
  for (const [exerciseId, item] of Object.entries(manifest.media)) {
    const mapped = pathsForExternalMediaId(item.externalMediaId, source);
    const record = { exerciseId, item, objects: [] };
    for (const [kind, expectedPath] of [['animation', item.animationPath], ['thumbnail', item.thumbnailPath]]) {
      const mappedObject = mapped[kind];
      if (mappedObject.targetPath !== expectedPath) throw new Error(`${exerciseId}: manifest path differs from target mapping`);
      try {
        const bytes = await fs.readFile(mappedObject.localPath);
        if (bytes.length === 0 || !hasGifMagic(bytes)) {
          report.counts.failed += 1;
          report.nonUploadedIds.add(exerciseId);
          report.errors.push(`${exerciseId}:${kind}: empty or invalid GIF`);
          continue;
        }
        report.totalBytes += bytes.length;
        record.objects.push({
          kind,
          localPath: mappedObject.localPath,
          targetPath: mappedObject.targetPath,
          size: bytes.length,
          sha256: sha256(bytes),
          status: 'unchecked',
        });
      } catch (error) {
        if (error?.code === 'ENOENT') report.counts.missing_local += 1;
        else report.counts.failed += 1;
        report.nonUploadedIds.add(exerciseId);
        report.errors.push(`${exerciseId}:${kind}: ${message(error)}`);
      }
    }
    records.push(record);
  }
  return records;
}

async function verifySeededRows(admin, manifest) {
  const rows = await dataOrThrow('active exercise_media read', () => admin.from('exercise_media')
    .select('canonical_exercise_id,provider,external_media_id,animation_path,thumbnail_path,media_version,resolution,license_source')
    .eq('active', true).limit(1000));
  if (rows.length !== manifest.recordCount) throw new Error(`active row count ${rows.length}, expected ${manifest.recordCount}`);
  const byId = new Map(rows.map((row) => [row.canonical_exercise_id, row]));
  if (byId.size !== rows.length) throw new Error('active rows contain duplicate canonical_exercise_id values');
  for (const [exerciseId, item] of Object.entries(manifest.media)) {
    const row = byId.get(exerciseId);
    if (!row) throw new Error(`${exerciseId}: active seeded row missing`);
    if (row.provider !== item.provider || row.external_media_id !== item.externalMediaId
      || row.animation_path !== item.animationPath || row.thumbnail_path !== item.thumbnailPath
      || row.media_version !== item.mediaVersion || row.resolution !== '360'
      || row.license_source !== 'exercisedb-starter') {
      throw new Error(`${exerciseId}: active seeded row differs from manifest/seed contract`);
    }
  }
}

async function listPrefix(storage, externalMediaId) {
  return dataOrThrow(`list prefix ${externalMediaId}`, () => storage.list(`V1/exercisedb/${externalMediaId}`, { limit: 100 }));
}

async function downloadObject(storage, targetPath) {
  const blob = await dataOrThrow(`download ${targetPath}`, () => storage.download(targetPath));
  return bytesFromBlob(blob);
}

async function inspectRemoteObjects(storage, records, report) {
  await concurrent(records, CONCURRENCY, async (record) => {
    try {
      const listed = await listPrefix(storage, record.item.externalMediaId);
      const names = new Set(listed.map((entry) => entry.name));
      for (const object of record.objects) {
        const name = path.posix.basename(object.targetPath);
        if (!names.has(name)) {
          object.status = 'absent';
          continue;
        }
        const remote = await downloadObject(storage, object.targetPath);
        object.status = existingObjectDecision(await fs.readFile(object.localPath), remote);
        if (object.status === 'skipped_identical') report.counts.skipped_identical += 1;
        else {
          report.counts.mismatch += 1;
          report.nonUploadedIds.add(record.exerciseId);
        }
      }
    } catch (error) {
      report.counts.failed += record.objects.length;
      report.nonUploadedIds.add(record.exerciseId);
      report.errors.push(`${record.exerciseId}: remote inspection failed: ${message(error)}`);
      for (const object of record.objects) object.status = 'failed';
    }
  });
}

async function uploadAbsentObjects(storage, records, report) {
  const absent = records.flatMap((record) => record.objects
    .filter((object) => object.status === 'absent').map((object) => ({ exerciseId: record.exerciseId, object })));
  await concurrent(absent, CONCURRENCY, async ({ exerciseId, object }) => {
    try {
      const bytes = await fs.readFile(object.localPath);
      await dataOrThrow(`upload ${object.targetPath}`, () => storage.upload(object.targetPath, bytes, {
        contentType: 'image/gif',
        upsert: false,
      }));
      object.status = 'uploaded';
      report.counts.uploaded += 1;
    } catch (error) {
      try {
        const remote = await downloadObject(storage, object.targetPath);
        const local = await fs.readFile(object.localPath);
        const decision = existingObjectDecision(local, remote);
        object.status = decision;
        report.counts[decision] += 1;
        if (decision === 'mismatch') report.nonUploadedIds.add(exerciseId);
      } catch {
        object.status = 'failed';
        report.counts.failed += 1;
        report.nonUploadedIds.add(exerciseId);
        report.errors.push(`${exerciseId}:${object.kind}: upload failed: ${message(error)}`);
      }
    }
  });
}

async function verifyUploadedObjects(storage, records, report) {
  await concurrent(records, CONCURRENCY, async (record) => {
    if (record.objects.some((object) => object.status === 'failed')) return;
    try {
      const listed = await listPrefix(storage, record.item.externalMediaId);
      const byName = new Map(listed.map((entry) => [entry.name, entry]));
      for (const object of record.objects) {
        if (object.status === 'mismatch') continue;
        const entry = byName.get(path.posix.basename(object.targetPath));
        const remoteSize = Number(entry?.metadata?.size);
        if (!entry || remoteSize !== object.size) {
          object.status = 'failed';
          report.counts.failed += 1;
          report.nonUploadedIds.add(record.exerciseId);
          report.errors.push(`${record.exerciseId}:${object.kind}: post-upload object missing or size mismatch`);
        }
      }
    } catch (error) {
      report.counts.failed += 1;
      report.nonUploadedIds.add(record.exerciseId);
      report.errors.push(`${record.exerciseId}: post-upload list failed: ${message(error)}`);
    }
  });
}

async function writeReport(report) {
  const output = {
    ...report,
    nonUploadedIds: [...report.nonUploadedIds].sort(codeUnitCompare),
  };
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const reportPath = path.join(os.tmpdir(), `exercise-media-${report.mode}-${stamp}-${process.pid}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`counts: ${JSON.stringify(report.counts)}`);
  console.log(`total bytes: ${report.totalBytes}`);
  console.log(`report: ${reportPath}`);
  return reportPath;
}

async function runTransfer({ mode, source }) {
  const report = {
    mode,
    source,
    manifestSha256: null,
    recordCount: null,
    counts: { uploaded: 0, would_upload: 0, skipped_identical: 0, mismatch: 0, missing_local: 0, failed: 0 },
    nonUploadedIds: new Set(),
    totalBytes: 0,
    errors: [],
  };
  let fatal = null;
  try {
    const manifest = await loadManifest();
    report.manifestSha256 = manifest.sha256;
    report.recordCount = manifest.recordCount;
    const records = await inspectLocalFiles(manifest, source, report);
    if (report.counts.missing_local > 0 || report.counts.failed > 0 || records.some((record) => record.objects.length !== 2)) {
      throw new Error('local preflight failed; no upload attempted');
    }

    const env = requiredEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    const admin = client(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    await verifySeededRows(admin, manifest);
    const storage = admin.storage.from(BUCKET);
    await inspectRemoteObjects(storage, records, report);
    if (report.counts.failed > 0) throw new Error('remote preflight failed; no upload attempted');

    const absentCount = records.flatMap((record) => record.objects).filter((object) => object.status === 'absent').length;
    if (mode === 'dry-run') {
      report.counts.would_upload = absentCount;
      for (const record of records) {
        if (record.objects.some((object) => object.status === 'absent')) report.nonUploadedIds.add(record.exerciseId);
      }
    } else {
      await uploadAbsentObjects(storage, records, report);
      await verifyUploadedObjects(storage, records, report);
    }
    if (report.counts.mismatch > 0 || report.counts.failed > 0) throw new Error('one or more objects remain mismatched or failed');
  } catch (error) {
    fatal = error;
    report.errors.push(message(error));
  } finally {
    await writeReport(report);
  }
  if (fatal) throw fatal;
  console.log(mode === 'dry-run' ? 'DRY_RUN_OK' : 'UPLOAD_OK');
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.mode === 'smoke') await runSmoke();
  else if (options.mode === 'client-check') await runClientCheck();
  else await runTransfer(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`exercise media ${process.argv.slice(2).find((arg) => arg.startsWith('--')) || 'dry-run'} failed: ${message(error)}`);
    process.exitCode = 1;
  });
}
