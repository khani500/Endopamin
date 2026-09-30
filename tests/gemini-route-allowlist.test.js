import { describe, expect, it } from 'vitest';
import { validateGeminiRoute } from '../api/gemini.js';

describe('validateGeminiRoute', () => {
  it('allows generateContent with the flash model', () => {
    expect(validateGeminiRoute({ model: 'gemini-2.5-flash', action: 'generateContent' })).toEqual({
      ok: true,
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      alt: undefined,
    });
  });

  it('allows streamGenerateContent with alt=sse', () => {
    expect(validateGeminiRoute({
      model: 'gemini-2.5-flash',
      action: 'streamGenerateContent',
      alt: 'sse',
    })).toEqual({
      ok: true,
      model: 'gemini-2.5-flash',
      action: 'streamGenerateContent',
      alt: 'sse',
    });
  });

  it('uses defaults when model and action are absent', () => {
    expect(validateGeminiRoute({})).toEqual({
      ok: true,
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      alt: undefined,
    });
    expect(validateGeminiRoute()).toMatchObject({ ok: true, model: 'gemini-2.5-flash', action: 'generateContent' });
  });

  it('uses the default action when only model is sent (food scanner shape)', () => {
    expect(validateGeminiRoute({ model: 'gemini-2.5-flash' })).toEqual({
      ok: true,
      model: 'gemini-2.5-flash',
      action: 'generateContent',
      alt: undefined,
    });
  });

  it.each([
    'gemini-2.5-pro',
    'gemini-2.5-flash/../x',
    'Gemini-2.5-flash',
    'gemini-2.5-flash ',
    '',
  ])('rejects unknown model: %j', model => {
    expect(validateGeminiRoute({ model })).toEqual({ ok: false, error: 'Unsupported model' });
  });

  it.each([
    'countTokens',
    'embedContent',
    'generateContent?alt=x',
    '',
  ])('rejects unknown action: %j', action => {
    expect(validateGeminiRoute({ action })).toEqual({ ok: false, error: 'Unsupported action' });
  });

  it.each([123, null, ['gemini-2.5-flash'], {}, true])('rejects non-string model: %j', model => {
    expect(validateGeminiRoute({ model })).toEqual({ ok: false, error: 'Unsupported model' });
  });

  it.each([123, null, ['generateContent'], {}, true])('rejects non-string action: %j', action => {
    expect(validateGeminiRoute({ action })).toEqual({ ok: false, error: 'Unsupported action' });
  });

  it.each(['json', 'SSE', '', null, 1])('rejects alt other than sse: %j', alt => {
    expect(validateGeminiRoute({ alt })).toEqual({ ok: false, error: 'Unsupported alt' });
  });
});
