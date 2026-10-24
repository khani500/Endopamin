import { exerciseMediaBatchHandler } from './_exerciseMediaBatch.js';
import { exerciseMediaHandler } from './_exerciseMediaSingle.js';

export { exerciseMediaBatchHandler, handleExerciseMediaBatch, parseBatchBody } from './_exerciseMediaBatch.js';
export { exerciseMediaHandler, handleExerciseMedia } from './_exerciseMediaSingle.js';
export { checkMediaEntitlement, readMediaManifest } from './_exerciseMediaShared.js';

export async function exerciseMediaDispatcher(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const route = req.query?.__route;
  if (route === undefined) return exerciseMediaHandler(req, res, deps);
  if (route === 'batch') return exerciseMediaBatchHandler(req, res, deps);
  return res.status(404).json({ error: 'Not found', code: 'not_found' });
}

export default function handler(req, res) {
  return exerciseMediaDispatcher(req, res);
}
