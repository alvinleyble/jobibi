import { describe, it, expect } from 'vitest';
import { deriveOrigin, levenshtein, verifySingleMapping, findSeenBefore, scoreNearDuplicate } from './capture.ts';
import type { ExtractedQuestion } from '../adapters/types.ts';

function q(over: Partial<ExtractedQuestion> & { id: string; label: string; selector: string }): ExtractedQuestion {
  const base: ExtractedQuestion = {
    id: over.id,
    label: over.label,
    fieldType: 'textarea',
    field: { tagName: 'textarea', selector: over.selector, id: over.id, name: over.id },
    labelSource: 'label-for',
    confidence: 1.0,
  };
  return { ...base, ...over } as ExtractedQuestion;
}

describe('levenshtein', () => {
  it('empty vs text = length', () => {
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('deriveOrigin', () => {
  it('no draft => user_written', () => {
    const r = deriveOrigin(null, 'My answer here');
    expect(r.origin).toBe('user_written');
    expect(r.editDistance).toBe('My answer here'.trim().length);
  });

  it('empty draft => user_written', () => {
    const r = deriveOrigin('   ', 'Something');
    expect(r.origin).toBe('user_written');
  });

  it('exact trimmed match => accepted_verbatim', () => {
    const r = deriveOrigin('Hello world ', ' Hello world');
    expect(r.origin).toBe('accepted_verbatim');
    expect(r.editDistance).toBe(0);
  });

  it('edited => user_edited', () => {
    const r = deriveOrigin('Hello world', 'Hello brave world');
    expect(r.origin).toBe('user_edited');
    expect(r.editDistance).toBeGreaterThan(0);
  });

  it('small whitespace still verbatim after trim', () => {
    const r = deriveOrigin('Answer', 'Answer ');
    expect(r.origin).toBe('accepted_verbatim');
  });
});

describe('verifySingleMapping', () => {
  it('agreement when same id/label/selector', () => {
    const a = q({ id: 'field1', label: 'Why do you want this role?', selector: '#field1' });
    const b = q({ id: 'field1', label: 'Why do you want this role?', selector: '#field1' });
    expect(verifySingleMapping(a, b).ok).toBe(true);
  });

  it('mismatch when label differs', () => {
    const a = q({ id: 'field1', label: 'Why do you want this role?', selector: '#field1' });
    const b = q({ id: 'field1', label: 'What is your salary?', selector: '#field1' });
    const r = verifySingleMapping(a, b);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('label mismatch');
  });

  it('mismatch when selector differs', () => {
    const a = q({ id: 'field1', label: 'Why want?', selector: '#a' });
    const b = q({ id: 'field1', label: 'Why want?', selector: '#b' });
    expect(verifySingleMapping(a, b).ok).toBe(false);
  });

  it('mismatch when fresh missing', () => {
    const a = q({ id: 'field1', label: 'Why?', selector: '#a' });
    expect(verifySingleMapping(a, undefined).ok).toBe(false);
  });
});

describe('findSeenBefore', () => {
  it('finds near-duplicate by keyword overlap', () => {
    const qLabel = 'Why do you want to join Acme?';
    const candidates = [
      { id: '1', question_label: 'Why do you want to join Acme?', question_norm: 'why do you want to join acme', answer_text: 'I love QA' },
      { id: '2', question_label: 'What is your expected salary?', question_norm: 'what is your expected salary', answer_text: '50k' },
    ];
    const found = findSeenBefore(qLabel, candidates as never[], { threshold: 0.85 });
    expect(found?.best.id).toBe('1');
  });

  it('returns null when no near-duplicate', () => {
    const found = findSeenBefore('Why do you want this role?', [
      { id: '1', question_label: 'What salary do you expect?', question_norm: 'what salary', answer_text: 'x' },
    ] as never[]);
    expect(found).toBeNull();
  });

  it('near-duplicate wording still matches (high overlap)', () => {
    const candidates = [
      { id: '1', question_label: 'Tell us why you want to work here', question_norm: 'tell us why you want to work here', answer_text: 'Because...' },
    ];
    const score = scoreNearDuplicate('Why do you want to work here?', candidates[0] as never);
    expect(score).toBeGreaterThan(0.5);
  });
});
