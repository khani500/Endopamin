import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  existingObjectDecision,
  parseCli,
  pathsForExternalMediaId,
  validateManifest,
  withOperationTimeout,
} from '../../scripts/media/exerciseMedia.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('maps an ExerciseDB id to exact local and capital-V target paths', () => {
  const mapped = pathsForExternalMediaId('0025', '/pack');
  assert.deepEqual(mapped, {
    animation: { localPath: '/pack/360/0025.gif', targetPath: 'V1/exercisedb/0025/0025-360.gif' },
    thumbnail: { localPath: '/pack/180/0025.gif', targetPath: 'V1/exercisedb/0025/0025-180.gif' },
  });
});

test('accepts the committed manifest and refuses schema, count, or sha256 drift', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'core/data/media-manifest.json'), 'utf8'));
  assert.equal(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, recordCount: 219 }), /recordCount mismatch/);
  assert.throws(() => validateManifest({ ...manifest, sha256: '0'.repeat(64) }), /sha256 mismatch/);
  assert.throws(() => validateManifest({ ...manifest, extra: true }), /top-level fields/);
});

test('CLI rejects unknown, duplicate, conflicting, empty, and missing source options', () => {
  assert.throws(() => parseCli(['--wat']), /unknown option/);
  assert.throws(() => parseCli(['--source=/a', '--source=/b']), /duplicate option/);
  assert.throws(() => parseCli(['--smoke', '--upload']), /duplicate or conflicting mode/);
  assert.throws(() => parseCli(['--source=']), /empty option value/);
  assert.throws(() => parseCli([]), /--source is required/);
  assert.throws(() => parseCli(['--upload']), /--source is required/);
});

test('classifies an existing object as identical or mismatch by full sha256', () => {
  const local = Buffer.from('GIF89a-local');
  assert.equal(existingObjectDecision(local, Buffer.from(local)), 'skipped_identical');
  assert.equal(existingObjectDecision(local, Buffer.from('GIF89a-other')), 'mismatch');
});

test('rejects a request promise that never settles instead of allowing a silent exit', async () => {
  await assert.rejects(
    withOperationTimeout(new Promise(() => {}), 5, 'test request'),
    /test request timed out after 5 ms/,
  );
});
