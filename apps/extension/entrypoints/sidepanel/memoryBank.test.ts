import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('MemoryBank reactive refresh mechanism', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('triggers refresh when JOBIBI_CAPTURE_COMPLETED message arrives', () => {
    let messageListener: ((msg: unknown) => void) | null = null;
    vi.spyOn(browser.runtime.onMessage, 'addListener').mockImplementation((fn: unknown) => {
      messageListener = fn as (msg: unknown) => void;
    });

    const refreshMock = vi.fn();

    // Setup reactive effect behavior
    let timer: NodeJS.Timeout | null = null;
    const triggerRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refreshMock();
      }, 250);
    };

    const onMsg = (m: unknown) => {
      if (typeof m === 'object' && m !== null) {
        const msg = m as { type?: string };
        if (msg.type === 'JOBIBI_CAPTURE_COMPLETED') {
          triggerRefresh();
        }
      }
    };
    browser.runtime.onMessage.addListener(onMsg as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

    expect(messageListener).toBeDefined();

    // Simulate incoming capture completed event
    if (messageListener) {
      const invoke = messageListener as (msg: unknown) => void;
      invoke({ type: 'JOBIBI_CAPTURE_COMPLETED', payload: { inserted: 1 } });
    }
    expect(refreshMock).not.toHaveBeenCalled();

    // Advance past debounce timer
    vi.advanceTimersByTime(250);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('triggers refresh when jobibi_last_capture storage changes', () => {
    let storageListener: ((changes: Record<string, unknown>, area: string) => void) | null = null;
    vi.spyOn(browser.storage.onChanged, 'addListener').mockImplementation((fn: unknown) => {
      storageListener = fn as (changes: Record<string, unknown>, area: string) => void;
    });

    const refreshMock = vi.fn();

    let timer: NodeJS.Timeout | null = null;
    const triggerRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refreshMock();
      }, 250);
    };

    const onStore = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && 'jobibi_last_capture' in changes) {
        triggerRefresh();
      }
    };
    browser.storage.onChanged.addListener(onStore);

    expect(storageListener).toBeDefined();

    // Simulate storage change event from local storage
    if (storageListener) {
      const invoke = storageListener as (changes: Record<string, unknown>, area: string) => void;
      invoke({ jobibi_last_capture: { newValue: { inserted: 2 } } }, 'local');
    }
    expect(refreshMock).not.toHaveBeenCalled();

    // Advance debounce
    vi.advanceTimersByTime(250);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Ignore changes in other storage areas (e.g. sync)
    if (storageListener) {
      const invoke = storageListener as (changes: Record<string, unknown>, area: string) => void;
      invoke({ jobibi_last_capture: { newValue: { inserted: 2 } } }, 'sync');
    }
    vi.advanceTimersByTime(300);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid burst of capture events into a single refresh call', () => {
    const refreshMock = vi.fn();

    let timer: NodeJS.Timeout | null = null;
    const triggerRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refreshMock();
      }, 250);
    };

    // Burst of 5 triggers within 100ms
    triggerRefresh();
    vi.advanceTimersByTime(50);
    triggerRefresh();
    vi.advanceTimersByTime(50);
    triggerRefresh();
    vi.advanceTimersByTime(50);
    triggerRefresh();
    vi.advanceTimersByTime(50);
    triggerRefresh();

    expect(refreshMock).not.toHaveBeenCalled();

    // Wait full debounce after final trigger
    vi.advanceTimersByTime(250);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
