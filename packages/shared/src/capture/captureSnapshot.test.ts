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

  it('unions the snapshot with a non-empty fresh re-derivation (prefilled next step)', () => {
    const res = resolveCapturePayload(
      [answer('Tell us about a time you improved test suite reliability.', 'I improved it')],
      [],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(true);
    expect(res.answers).toHaveLength(2);
    expect(res.answers.map((a) => a.answerText)).toContain('Automatic testing, Black-box testing');
    expect(res.answers.map((a) => a.answerText)).toContain('I improved it');
  });

  it('lets the fresh answer win when both sides answer the same question', () => {
    const res = resolveCapturePayload(
      [answer('What are the testing tools and methods have you worked with?', 'Load testing')],
      [],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.answers).toHaveLength(1);
    expect(res.answers[0].answerText).toBe('Load testing');
    expect(res.usedSnapshot).toBe(false);
  });

  it('merges the snapshot despite stale "missing in re-derived mapping" mismatches', () => {
    const label = 'What are the testing tools and methods have you worked with?';
    const res = resolveCapturePayload(
      [],
      [{ questionLabel: label, reason: 'missing in re-derived mapping (id q1)' }],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(true);
    expect(res.answers).toHaveLength(1);
    expect(res.answers[0].answerText).toBe('Automatic testing, Black-box testing');
    expect(res.mismatches).toHaveLength(0);
  });

  it('keeps a stale mismatch when no side produced an answer for it', () => {
    const res = resolveCapturePayload(
      [],
      [{ questionLabel: 'Unanswered q', reason: 'missing in re-derived mapping (id q9)' }],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(true);
    expect(res.mismatches).toEqual([
      { questionLabel: 'Unanswered q', reason: 'missing in re-derived mapping (id q9)' },
    ]);
  });

  it('drops the snapshot answer for a real D16 mis-binding on the same question', () => {
    const label = 'What are the testing tools and methods have you worked with?';
    const res = resolveCapturePayload(
      [],
      [{ questionLabel: label, reason: 'selector mismatch: "#a" vs "#b"' }],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot(),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(false);
    expect(res.answers).toHaveLength(0);
    expect(res.mismatches).toHaveLength(1);
  });

  it('carries the snapshot mismatches through the merge', () => {
    const res = resolveCapturePayload(
      [],
      [],
      { roleTitle: 'Staff Automation Engineer', company: 'InnoTech Solutions' },
      'https://www.linkedin.com/jobs/view/123456/',
      snapshot({ mismatches: [{ questionLabel: 'Snapshot q', reason: 'label mismatch: "a" vs "b"' }] }),
      linkedInJobKeyFromUrl,
    );
    expect(res.usedSnapshot).toBe(true);
    expect(res.answers).toHaveLength(1);
    expect(res.mismatches).toEqual([{ questionLabel: 'Snapshot q', reason: 'label mismatch: "a" vs "b"' }]);
  });

  it('backfills the job context from the snapshot when the swapped step lost it', () => {
    const res = resolveCapturePayload([], [], {}, 'https://www.linkedin.com/jobs/view/123456/', snapshot(), linkedInJobKeyFromUrl);
    expect(res.jobContext.roleTitle).toBe('Staff Automation Engineer');
    expect(res.jobContext.company).toBe('InnoTech Solutions');
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
