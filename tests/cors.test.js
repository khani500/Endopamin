import { describe, expect, it } from 'vitest';
import { resolveAllowedOrigin } from '../api/_cors.js';

describe('resolveAllowedOrigin', () => {
  it.each([
    'http://localhost:5173',
    'https://www.endopamin.com',
    'https://endopamin.com',
    'https://app.endopamin.com',
  ])('returns allowlisted origin byte-exact: %s', origin => {
    expect(resolveAllowedOrigin(origin)).toBe(origin);
  });

  it.each([
    'https://evil.com',
    'https://www.endopamin.com.evil.com',
  ])('rejects unlisted origin: %s', origin => {
    expect(resolveAllowedOrigin(origin)).toBeNull();
  });

  it.each([undefined, null, ''])('rejects missing origin: %s', origin => {
    expect(resolveAllowedOrigin(origin)).toBeNull();
  });

  it('matches scheme, host, and port exactly', () => {
    expect(resolveAllowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(resolveAllowedOrigin('https://localhost:5173')).toBeNull();
    expect(resolveAllowedOrigin('http://localhost:3000')).toBeNull();
  });
});
