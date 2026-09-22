import { describe, expect, it } from 'vitest';
import { classifyStoredAge } from '../src/lib/adultAge.js';
import { MAX_AGE, MIN_AGE } from '../src/lib/profileValidation.js';

describe('classifyStoredAge', () => {
  it.each([null, undefined, '', '   ', '\t', '\n'])(
    'returns missing for %s',
    (value) => {
      expect(classifyStoredAge(value)).toBe('missing');
    },
  );

  it.each(['abc', 17.5, '17.5', '28.0', 101, 0, -1, '0', '-3'])(
    'returns invalid for %s',
    (value) => {
      expect(classifyStoredAge(value)).toBe('invalid');
    },
  );

  it.each([16, 17, '16', ' 17 '])('returns underage for %s', (value) => {
    expect(classifyStoredAge(value)).toBe('underage');
    expect(MIN_AGE).toBe(18);
  });

  it.each([18, 35, 100, '18', ' 35 '])('returns ok for %s', (value) => {
    expect(classifyStoredAge(value)).toBe('ok');
  });

  it('uses imported MIN_AGE and MAX_AGE rather than a hardcoded 18', () => {
    expect(classifyStoredAge(MIN_AGE - 1)).toBe('underage');
    expect(classifyStoredAge(MIN_AGE)).toBe('ok');
    expect(classifyStoredAge(MAX_AGE)).toBe('ok');
    expect(classifyStoredAge(MAX_AGE + 1)).toBe('invalid');
  });

  it('parses numeric strings the same way validateAge parseInteger does', () => {
    expect(classifyStoredAge('18')).toBe('ok');
    expect(classifyStoredAge(' 18 ')).toBe('ok');
    expect(classifyStoredAge('18.0')).toBe('invalid');
    expect(classifyStoredAge('17.5')).toBe('invalid');
    expect(classifyStoredAge('abc')).toBe('invalid');
  });
});
