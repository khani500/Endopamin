import { createClient } from '@supabase/supabase-js';
import { applyCorsHeaders } from './_cors.js';
import { checkIpAbuseLimit, checkUserMinuteLimit, consumeDailyQuota } from './_rateLimit.js';
import { reportError } from './_sentry.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const MAX_BODY_BYTES = 10 * 1024 * 1024;

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ACTION = 'generateContent';
const ALLOWED_MODELS = new Set(['gemini-2.5-flash']);
const ALLOWED_ACTIONS = new Set(['generateContent', 'streamGenerateContent']);

// Absent model/action fall back to the defaults (older builds omit them).
// Any present value must be an allowlisted string; it is never replaced by the default.
// Returns { ok: true, model, action, alt } or { ok: false, error }.
export function validateGeminiRoute({ model, action, alt } = {}) {
  if (model !== undefined && (typeof model !== 'string' || !ALLOWED_MODELS.has(model))) {
    return { ok: false, error: 'Unsupported model' };
  }
  if (action !== undefined && (typeof action !== 'string' || !ALLOWED_ACTIONS.has(action))) {
    return { ok: false, error: 'Unsupported action' };
  }
  if (alt !== undefined && alt !== 'sse') {
    return { ok: false, error: 'Unsupported alt' };
  }
  return {
    ok: true,
    model: model ?? DEFAULT_MODEL,
    action: action ?? DEFAULT_ACTION,
    alt,
  };
}

const MAX_OUTPUT_TOKENS = 8192;
const MAX_THINKING_BUDGET = 1024;
const MAX_TEXT_ONLY_BYTES = 1_000_000;
const MAX_WITH_INLINE_BYTES = 4_500_000;
const MAX_INLINE_PARTS = 1;
const ALLOWED_BODY_KEYS = new Set(['contents', 'systemInstruction', 'system_instruction', 'generationConfig']);
const INLINE_MIME_PREFIXES = ['image/', 'audio/'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectInlineParts(geminiBody) {
  const inlineParts = [];
  const visit = (content) => {
    if (!isPlainObject(content) || !Array.isArray(content.parts)) return;
    for (const part of content.parts) {
      if (!isPlainObject(part)) continue;
      const inline = part.inlineData ?? part.inline_data;
      if (inline !== undefined) inlineParts.push(inline);
    }
  };
  geminiBody.contents.forEach(visit);
  visit(geminiBody.systemInstruction);
  visit(geminiBody.system_instruction);
  return inlineParts;
}

// Bounds for the Gemini body after model/action/alt are removed. No client field can raise them.
// maxOutputTokens is always set (8192 when absent or invalid, clamped to 8192 otherwise).
// thinkingBudget is clamped to 0..1024 only when the client sends it; absent stays absent.
// Returns { ok: true, body } with a normalized copy, or { ok: false, status, error, maxBytes? }.
export function validateGeminiPayload(geminiBody) {
  for (const key of Object.keys(geminiBody)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return { ok: false, status: 400, error: 'Unsupported request field' };
    }
  }
  if (!Array.isArray(geminiBody.contents) || geminiBody.contents.length === 0) {
    return { ok: false, status: 400, error: 'Invalid contents' };
  }
  if (geminiBody.generationConfig !== undefined && !isPlainObject(geminiBody.generationConfig)) {
    return { ok: false, status: 400, error: 'Invalid generationConfig' };
  }

  const generationConfig = { ...(geminiBody.generationConfig || {}) };
  if (generationConfig.candidateCount !== undefined && generationConfig.candidateCount !== 1) {
    return { ok: false, status: 400, error: 'Unsupported candidateCount' };
  }
  const requestedTokens = generationConfig.maxOutputTokens;
  generationConfig.maxOutputTokens = Number.isInteger(requestedTokens) && requestedTokens > 0
    ? Math.min(requestedTokens, MAX_OUTPUT_TOKENS)
    : MAX_OUTPUT_TOKENS;

  if (generationConfig.thinkingConfig !== undefined) {
    if (!isPlainObject(generationConfig.thinkingConfig)) {
      return { ok: false, status: 400, error: 'Invalid thinkingConfig' };
    }
    const thinkingConfig = { ...generationConfig.thinkingConfig };
    if (thinkingConfig.thinkingBudget !== undefined) {
      const budget = thinkingConfig.thinkingBudget;
      if (typeof budget !== 'number' || !Number.isFinite(budget)) {
        return { ok: false, status: 400, error: 'Invalid thinkingBudget' };
      }
      thinkingConfig.thinkingBudget = Math.min(MAX_THINKING_BUDGET, Math.max(0, Math.round(budget)));
    }
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const normalized = { ...geminiBody, generationConfig };

  const inlineParts = collectInlineParts(normalized);
  if (inlineParts.length > MAX_INLINE_PARTS) {
    return { ok: false, status: 400, error: 'Only one image or audio clip per request' };
  }
  for (const inline of inlineParts) {
    const mimeType = isPlainObject(inline) ? (inline.mimeType ?? inline.mime_type) : undefined;
    if (typeof mimeType !== 'string' || !INLINE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
      return { ok: false, status: 400, error: 'Unsupported attachment type' };
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (inlineParts.length > 0 && bytes > MAX_WITH_INLINE_BYTES) {
    return {
      ok: false, status: 413, error: 'Image is too large. Try a smaller photo.', maxBytes: MAX_WITH_INLINE_BYTES,
    };
  }
  if (inlineParts.length === 0 && bytes > MAX_TEXT_ONLY_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'This conversation is too long to send. Please start a new conversation and try again.',
      maxBytes: MAX_TEXT_ONLY_BYTES,
    };
  }

  return { ok: true, body: normalized };
}

function estimateBodyBytes(body) {
  if (!body) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return 0;
  }
}

function isPayloadTooLargeError(err) {
  const message = String(err?.message || '').toLowerCase();
  return (
    err?.statusCode === 413
    || message.includes('payload too large')
    || message.includes('entity too large')
    || message.includes('body exceeded')
    || message.includes('request body larger')
  );
}

export default async function handler(req, res) {
  const allowedOrigin = applyCorsHeaders(req, res);
  if (req.method === 'OPTIONS' && allowedOrigin) {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await checkIpAbuseLimit(req, res, { endpoint: 'gemini' }))) return;

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const userId = userData.user.id;

  if (!(await checkUserMinuteLimit(res, { endpoint: 'gemini', userId, paid: true }))) return;

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: 'Request body too large. Try a smaller image or lower camera resolution.',
      maxBytes: MAX_BODY_BYTES,
    });
  }

  const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  let body;
  try {
    body = req.body;
  } catch (err) {
    if (isPayloadTooLargeError(err)) {
      return res.status(413).json({
        error: 'Request body too large. Try a smaller image or lower camera resolution.',
        maxBytes: MAX_BODY_BYTES,
      });
    }
    return res.status(400).json({ error: err.message || 'Invalid request body' });
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const estimatedBytes = estimateBodyBytes(body);
  if (estimatedBytes > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: 'Image payload too large after encoding. Try retaking the photo closer or in better light.',
      maxBytes: MAX_BODY_BYTES,
      estimatedBytes,
    });
  }

  const {
    model: rawModel,
    action: rawAction,
    alt: rawAlt,
    ...geminiBody
  } = body;

  const route = validateGeminiRoute({ model: rawModel, action: rawAction, alt: rawAlt });
  if (!route.ok) {
    return res.status(400).json({ error: route.error });
  }
  const { model, action, alt } = route;

  // Bounds run before the daily quota, so a rejected request never costs a unit.
  const payload = validateGeminiPayload(geminiBody);
  if (!payload.ok) {
    return res.status(payload.status).json({
      error: payload.error,
      ...(payload.maxBytes ? { maxBytes: payload.maxBytes } : {}),
    });
  }

  // Forwards the bounded Gemini payload: contents, systemInstruction, generationConfig.

  let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${GEMINI_API_KEY}`;
  if (alt === 'sse') {
    url += '&alt=sse';
  }

  try {
    const upstreamBody = JSON.stringify(payload.body);
    if (Buffer.byteLength(upstreamBody, 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({
        error: 'Image payload too large for Gemini. Try a smaller photo.',
        maxBytes: MAX_BODY_BYTES,
      });
    }

    // One daily unit per client request, taken only when we are about to call Google,
    // and before the retry loop so internal 503 retries never cost extra units.
    if (!(await consumeDailyQuota(res, { endpoint: 'gemini', userId }))) return;

    let response;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: upstreamBody,
        });
        if (response.status !== 503) break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!response) throw lastErr || new Error('Gemini unreachable');

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = text;
      try {
        const parsed = JSON.parse(text);
        errorMessage = parsed?.error?.message || parsed?.error || text;
      } catch {
        // use raw text
      }
      console.error('Gemini API error:', errorMessage, response.status);
      await reportError(new Error(`Gemini API returned ${response.status}: ${String(errorMessage).slice(0, 300)}`), {
        route: 'gemini',
        step: 'upstream-response',
        status: response.status,
      });
      res.setHeader('Content-Type', 'application/json');
      return res.status(response.status).send(text);
    }

    if (alt === 'sse') {
      res.status(response.status);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      const { Readable } = await import('node:stream');
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.pipe(res);
      nodeStream.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
      return;
    }

    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(response.status).send(text);
  } catch (err) {
    if (isPayloadTooLargeError(err)) {
      return res.status(413).json({
        error: 'Request body too large. Try a smaller image or lower camera resolution.',
        maxBytes: MAX_BODY_BYTES,
      });
    }
    console.error('Gemini API error:', err.message, err.status);
    await reportError(err, { route: 'gemini', step: 'handler' });
    return res.status(500).json({
      error: err.message || 'Internal Server Error',
      details: err.message,
    });
  }
}
