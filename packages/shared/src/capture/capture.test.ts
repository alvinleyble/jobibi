import { describe, it, expect } from 'vitest';
import {
  deriveOrigin,
  levenshtein,
  verifySingleMapping,
  findSeenBefore,
  scoreNearDuplicate,
  scoreMemoryChunkDuplicate,
  isDuplicateQuestion,
  groupQaPairs,
  extractQuestionFromChunkText,
  MEMORY_CHUNK_DEDUP_THRESHOLD,
} from './capture.ts';
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

describe('MEMORY_CHUNK_DEDUP_THRESHOLD', () => {
  it('is locked at 0.90', () => {
    expect(MEMORY_CHUNK_DEDUP_THRESHOLD).toBe(0.90);
  });
});

describe('scoreMemoryChunkDuplicate', () => {
  it('identical question scores 1.0 (>=0.90)', () => {
    const chunk = { id: 'c1', text: 'Q: Years of experience in React?\nA: 5 years' };
    const score = scoreMemoryChunkDuplicate('Years of experience in React?', chunk);
    expect(score).toBeGreaterThanOrEqual(0.90);
    expect(score).toBe(1);
  });

  it('near-identical punctuation variant still >=0.90 (normalized grouping)', () => {
    const chunk = { id: 'c1', text: 'Q: Tell us about yourself\nA: I am ...' };
    const score = scoreMemoryChunkDuplicate('Tell us about yourself?', chunk);
    expect(score).toBeGreaterThanOrEqual(0.90);
  });

  it('distinct questions score <0.90', () => {
    const chunk = { id: 'c1', text: 'Q: What is your expected salary?\nA: 50000' };
    const score = scoreMemoryChunkDuplicate('Why do you want to join Acme?', chunk);
    expect(score).toBeLessThan(0.90);
  });

  it('partial overlap below threshold is not duplicate', () => {
    const chunk = { id: 'c1', text: 'Q: Why do you want to work here?\nA: Because...' };
    // Different question family
    const score = scoreMemoryChunkDuplicate('What is your notice period?', chunk);
    expect(score).toBeLessThan(0.90);
  });
});

describe('isDuplicateQuestion', () => {
  it('returns true when qa candidate is near-identical (>=0.90)', () => {
    const qas = [{ id: '1', question_label: 'Years of experience in React?', question_norm: 'years of experience in react', answer_text: '5 years' }];
    const chunks: Array<{ id: string; text: string }> = [];
    expect(isDuplicateQuestion('Years of experience in React?', qas as never, chunks as never)).toBe(true);
  });

  it('returns true when chunk candidate is near-identical', () => {
    const qas: never[] = [];
    const chunks = [{ id: 'c1', text: 'Q: Tell us about yourself\nA: I love building things' }];
    expect(isDuplicateQuestion('Tell us about yourself?', qas as never, chunks as never)).toBe(true);
  });

  it('returns false when no candidate crosses threshold', () => {
    const qas = [{ id: '1', question_label: 'What salary do you expect?', question_norm: 'what salary', answer_text: 'x' }];
    const chunks = [{ id: 'c1', text: 'Q: What salary do you expect?\nA: 50k' }];
    expect(isDuplicateQuestion('Why do you want this role?', qas as never, chunks as never)).toBe(false);
  });

  it('respects custom threshold', () => {
    const qas = [{ id: '1', question_label: 'Tell us why you want to work here', question_norm: 'tell us why you want to work here', answer_text: 'Because...' }];
    // keyword overlap ~0.71, below 0.90 but above 0.5
    expect(isDuplicateQuestion('Why do you want to work here?', qas as never, [] as never, { threshold: 0.5 })).toBe(true);
    expect(isDuplicateQuestion('Why do you want to work here?', qas as never, [] as never, { threshold: 0.90 })).toBe(false);
  });
});

describe('extractQuestionFromChunkText', () => {
  it('extracts Q part from Q/A chunk', () => {
    expect(extractQuestionFromChunkText('Q: Hello?\nA: World')).toBe('Hello?');
    expect(extractQuestionFromChunkText('Q: Hello\nA: World')).toBe('Hello');
  });
  it('falls back to raw text when not Q:-prefixed', () => {
    expect(extractQuestionFromChunkText('Some raw text')).toBe('Some raw text');
  });
});

describe('groupQaPairs', () => {
  it('groups identical normalized questions into one', () => {
    const pairs = [
      { id: '1', question_label: 'Years of experience in React?', question_norm: 'years of experience in react', answer_text: '5 years', created_at: '2026-08-10T00:00:00Z' },
      { id: '2', question_label: 'Years of experience in React?', question_norm: 'years of experience in react', answer_text: '5 years again', created_at: '2026-08-11T00:00:00Z' },
      { id: '3', question_label: 'Tell us about yourself', question_norm: 'tell us about yourself', answer_text: 'I am ...', created_at: '2026-08-12T00:00:00Z' },
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(2);
    const reactGroup = groups.find((g) => g.normalizedQuestion === 'years of experience in react')!;
    expect(reactGroup.count).toBe(2);
    expect(reactGroup.items.length).toBe(2);
    // latest is most recent
    expect(reactGroup.latest.id).toBe('2');
  });

  it('groups punctuation variants via normalized equality', () => {
    const pairs = [
      { id: '1', question_label: 'Tell us about yourself', question_norm: 'tell us about yourself', answer_text: 'A', created_at: '2026-08-10T00:00:00Z' },
      { id: '2', question_label: 'Tell us about yourself?', question_norm: 'tell us about yourself', answer_text: 'B', created_at: '2026-08-11T00:00:00Z' },
      { id: '3', question_label: 'Tell us about yourself! ', question_norm: 'tell us about yourself', answer_text: 'C', created_at: '2026-08-12T00:00:00Z' },
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(3);
  });

  it('does not group distinct questions', () => {
    const pairs = [
      { id: '1', question_label: 'Why do you want to join Acme?', question_norm: 'why do you want to join acme', answer_text: 'A', created_at: '2026-08-10T00:00:00Z' },
      { id: '2', question_label: 'What is your expected salary?', question_norm: 'what is your expected salary', answer_text: '50k', created_at: '2026-08-11T00:00:00Z' },
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(2);
  });

  it('latest is newest by created_at', () => {
    const pairs = [
      { id: 'old', question_label: 'Q?', question_norm: 'q', answer_text: 'old answer', created_at: '2026-08-09T00:00:00Z' },
      { id: 'new', question_label: 'Q?', question_norm: 'q', answer_text: 'new answer', created_at: '2026-08-15T00:00:00Z' },
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups[0].latest.id).toBe('new');
    expect(groups[0].latest.answer_text).toBe('new answer');
  });

  it('groups 10 identical captures into one group with count 10', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      question_label: 'Years of experience in React?',
      question_norm: 'years of experience in react',
      answer_text: `Answer ${i}`,
      created_at: `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
    }));
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(10);
  });
});
