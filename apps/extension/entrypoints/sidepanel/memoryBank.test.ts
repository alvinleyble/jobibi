import { describe, it, expect } from 'vitest';
import { groupQaPairs, normalizeQuestion } from '@jobibi/shared';

describe('MemoryBank grouped Q&A display', () => {
  function qa(id: string, label: string, answer: string, created_at: string, origin = 'user_written') {
    return { id, question_label: label, question_norm: normalizeQuestion(label), answer_text: answer, origin, created_at, embedding: null as never };
  }

  it('groups identical questions into one card with frequency badge >1', () => {
    const pairs = [
      qa('1', 'Years of experience in React?', '5 years', '2026-08-10T00:00:00Z'),
      qa('2', 'Years of experience in React?', '6 years', '2026-08-11T00:00:00Z'),
      qa('3', 'Years of experience in React?', '7 years', '2026-08-12T00:00:00Z'),
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(1);
    expect(groups[0]!.count).toBe(3);
    // badge text
    const badge = `Used in ${groups[0]!.count} applications`;
    expect(badge).toBe('Used in 3 applications');
    // latest answer is newest
    expect(groups[0]!.latest.answer_text).toBe('7 years');
  });

  it('does not show frequency badge when count is 1', () => {
    const pairs = [qa('1', 'Tell us about yourself', 'I am ...', '2026-08-10T00:00:00Z')];
    const groups = groupQaPairs(pairs as never);
    expect(groups[0]!.count).toBe(1);
    const showBadge = groups[0]!.count > 1;
    expect(showBadge).toBe(false);
  });

  it('renders single card for 10 identical captures instead of 10 rows', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => qa(String(i), 'Tell us about yourself', `Answer ${i}`, `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00Z`));
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(1);
    expect(groups[0]!.count).toBe(10);
  });

  it('keeps distinct questions as separate cards', () => {
    const pairs = [
      qa('1', 'Why do you want to join Acme?', 'A', '2026-08-10T00:00:00Z'),
      qa('2', 'What is your expected salary?', '50k', '2026-08-11T00:00:00Z'),
      qa('3', 'Years of experience in React?', '5', '2026-08-12T00:00:00Z'),
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(3);
  });

  it('groups punctuation variants (normalizeQuestion) as same card', () => {
    const pairs = [
      qa('1', 'Tell us about yourself', 'A', '2026-08-10T00:00:00Z'),
      qa('2', 'Tell us about yourself?', 'B', '2026-08-11T00:00:00Z'),
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups.length).toBe(1);
  });

  it('preserves origin badge from latest answer', () => {
    const pairs = [
      qa('1', 'Why join?', 'old', '2026-08-10T00:00:00Z', 'user_written'),
      qa('2', 'Why join?', 'new', '2026-08-11T00:00:00Z', 'accepted_verbatim'),
    ];
    const groups = groupQaPairs(pairs as never);
    expect(groups[0]!.latest.origin).toBe('accepted_verbatim');
  });
});
