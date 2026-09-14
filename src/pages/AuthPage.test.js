import { describe, expect, it } from 'vitest';
import { buildSignupProfilePayload } from './AuthPage.jsx';

describe('buildSignupProfilePayload', () => {
  it('does not fabricate onboarding answers, and still bootstraps id and display_name', () => {
    const payload = buildSignupProfilePayload('user-1', 'Ada');

    expect(payload).toHaveProperty('id', 'user-1');
    expect(payload).toHaveProperty('display_name', 'Ada');
    expect(payload).not.toHaveProperty('goal');
    expect(payload).not.toHaveProperty('experience');
    expect(payload).not.toHaveProperty('gender');
    expect(payload).not.toHaveProperty('job_type');
  });
});
