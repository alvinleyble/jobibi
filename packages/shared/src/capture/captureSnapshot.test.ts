import { describe, it, expect } from 'vitest';
import {
  isSameApplication,
  resolveCapturePayload,
  linkedInJobKeyFromUrl,
  defaultJobKeyFromUrl,
  type CaptureSnapshot,
  type CaptureAnswerEntry,
} from './captureSnapshot.ts';

function answer(questionLabel: string, answerText = 'yes'): CaptureAnswerEntry {
  return {
    questionLabel,
    answerText,
    draftText: null,
    fieldSelector: '#q',
    fieldId: 'q',
    mappingVerified: true,
  };
}

function snapshot(overrides: Partial<CaptureSnapshot> = {}): CaptureSnapshot {
  return {
    answers: [answer('What are the testing tools and methods have you worked with?', 'Automatic testing, Black-box testing')],
    mismatches: [],
    jobContext: { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
    url: 'https://www.linkedin.com/jobs/view/123456/',
    host: 'www.linkedin.com',
    ...overrides,
  };
}

describe('linkedInJobKeyFromUrl', () => {
  it('extracts the job id from /jobs/view/{id}', () => {
    expect(linkedInJobKeyFromUrl('https://www.linkedin.com/jobs/view/123456/')).toBe('view:123456');
  });

  it('falls back to ?currentJobId= for recommended-feed listings', () => {
    expect(linkedInJobKeyFromUrl('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=98765')).toBe(
      'currentJobId:98765',
    );
  });

  it('falls back to the pathname when neither signal is present', () => {
    expect(linkedInJobKeyFromUrl('https://www.linkedin.com/jobs/collections/recommended/')).toBe(
      '/jobs/collections/recommended/',
    );
  });

  it('returns the raw url for unparseable input', () => {
    expect(linkedInJobKeyFromUrl('not a url')).toBe('not a url');
  });
});

describe('defaultJobKeyFromUrl', () => {
  it('returns the path before /apply/', () => {
    expect(defaultJobKeyFromUrl('https://ph.jobstreet.com/jobs/123/apply/role-requirements')).toBe('/jobs/123');
  });
});

describe('isSameApplication (Q3 jobContext/URL discard exception)', () => {
  it('accepts when role/company/url are all identical', () => {
    expect(
      isSameApplication(
        snapshot(),
        { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
        'https://www.linkedin.com/jobs/view/123456/',
        linkedInJobKeyFromUrl,
      ),
    ).toBe(true);
  });

  it('discards when role title differs', () => {
    expect(
      isSameApplication(
        snapshot(),
        { roleTitle: 'QA Lead', company: 'InnoTech Solutions' },
        'https://www.linkedin.com/jobs/view/123456/',
        linkedInJobKeyFromUrl,
      ),
    ).toBe(false);
  });

  it('discards when company differs', () => {
    expect(
      isSameApplication(
        snapshot(),
        { roleTitle: 'Staff Automation Engineer', company: 'Other Corp' },
        'https://www.linkedin.com/jobs/view/123456/',
        linkedInJobKeyFromUrl,
      ),
    ).toBe(false);
  });

  it('discards when the URL job id moved to a different job', () => {
    expect(
      isSameApplication(
        snapshot(),
        { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
        'https://www.linkedin.com/jobs/view/999999/',
        linkedInJobKeyFromUrl,
      ),
    ).toBe(false);
  });

  it('accepts on role/company match alone when both URLs are unparseable', () => {
    expect(
      isSameApplication(
        snapshot({ url: 'garbage' }),
        { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
        'garbage',
        linkedInJobKeyFromUrl,
      ),
    ).toBe(true);
  });

  it('accepts when role/company are absent from both sides but the url matches', () => {
    expect(
      isSameApplication(
        snapshot({ jobContext: {} }),
        {},
        'https://www.linkedin.com/jobs/view/123456/',
        linkedInJobKeyFromUrl,
      ),
    ).toBe(true);
  });

  it('does not reject when only one side has a role title', () => {
    expect(
      isSameApplication(
        snapshot(),
        { company: 'InnoTech Solutions' },
        'https://www.linkedin.com/jobs/view/123456/',
        linkedInJobKeyFromUrl,
      ),
    ).toBe(true);
  });
});

describe('resolveCapturePayload (merge in performCapture)', () => {
  it('merges the stashed snapshot when the fresh re-derivation is empty', () => {
    const res = resolveCapturePayload(
      [],
      [],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(true);
    expect(res.answers).toHaveLength(1);
    expect(res.answers[0].answerText).toBe('Automatic testing, Black-box testing');
  });

  it('keeps fresh answers and discards the snapshot when the fresh re-derivation is non-empty', () => {
    const res = resolveCapturePayload(
      [answer('Tell us about a time you improved test suite reliability.', 'I improved it')],
      [],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(false);
    expect(res.answers).toHaveLength(1);
    expect(res.answers[0].questionLabel).toContain('improved test suite reliability');
  });

  it('discards the snapshot when the user moved to a different job', () => {
    const res = resolveCapturePayload(
      [],
      [],
      { roleTitle: 'QA Lead', company: 'Other Corp' },
      'https://www.linkedin.com/jobs/view/999999/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(false);
    expect(res.answers).toHaveLength(0);
  });

  it('returns empty when fresh is empty and there is no snapshot', () => {
    const res = resolveCapturePayload(
      [],
      [],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      null,
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(false);
    expect(res.answers).toHaveLength(0);
    expect(res.mismatches).toHaveLength(0);
  });

  it('carries mismatches through from the fresh result', () => {
    const res = resolveCapturePayload(
      [],
      [{ questionLabel: 'Mismatched q', reason: 'mapping mismatch' }],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      null,
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(false);
    expect(res.mismatches).toHaveLength(1);
  });
});
