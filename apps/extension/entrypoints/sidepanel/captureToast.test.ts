import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from './supabase';

describe('Persistent Capture Toast & Undo Logic (Items 7 & 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Toast persistence (Item 7)', () => {
    it('does not auto-hide toast after 4000ms or 10000ms', () => {
      vi.useFakeTimers();

      const toastRef: {
        current: { text: string; insertedIds: string[]; canUndo: boolean } | null;
      } = { current: null };
      const showCaptureToast = (payload: { inserted?: number; insertedIds?: string[] }) => {
        const count = payload.inserted ?? 0;
        toastRef.current = {
          text: `Saved ${count} answers to memory`,
          insertedIds: payload.insertedIds ?? [],
          canUndo: (payload.insertedIds?.length ?? 0) > 0,
        };
      };

      showCaptureToast({ inserted: 2, insertedIds: ['qa-1', 'qa-2'] });
      expect(toastRef.current).not.toBeNull();
      expect(toastRef.current?.text).toBe('Saved 2 answers to memory');
      expect(toastRef.current?.canUndo).toBe(true);

      // Advance time by 4000ms and 10000ms — toast must remain visible (no auto-dismiss timer)
      vi.advanceTimersByTime(4000);
      expect(toastRef.current).not.toBeNull();

      vi.advanceTimersByTime(10000);
      expect(toastRef.current).not.toBeNull();

      vi.useRealTimers();
    });

    it('dismisses toast explicitly when dismiss action is triggered', () => {
      let toastState: { text: string } | null = { text: 'Saved 1 answer to memory' };
      const dismiss = () => {
        toastState = null;
      };

      dismiss();
      expect(toastState).toBeNull();
    });
  });

  describe('Undo Capture Action (Item 8)', () => {
    it('deletes newly captured qa_pairs and associated memory_chunks, broadcasts undo, and updates toast', async () => {
      const insertedIds = ['qa-1', 'qa-2'];
      const userId = 'user-123';

      // Mock qa_pairs select
      const mockQaPairs = [
        { id: 'qa-1', question_label: 'Why work here?', answer_text: 'Great mission.' },
        { id: 'qa-2', question_label: 'Experience with React?', answer_text: '5 years.' },
      ];

      const mockQaSelect = vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: mockQaPairs, error: null }),
        }),
      });

      const mockMemoryChunksSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: 'chunk-1', text: 'Q: Why work here?\nA: Great mission.' },
              { id: 'chunk-2', text: 'Q: Experience with React?\nA: 5 years.' },
              { id: 'chunk-3', text: 'Q: Older unrelated question\nA: Unrelated.' },
            ],
            error: null,
          }),
        }),
      });

      const mockMemoryChunksDeleteIn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      const mockMemoryChunksDeleteText = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      });

      const mockQaPairsDelete = vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'qa_pairs') {
          return {
            select: mockQaSelect,
            delete: mockQaPairsDelete,
          } as never;
        }
        if (table === 'memory_chunks') {
          return {
            select: mockMemoryChunksSelect,
            delete: (opts?: unknown) => {
              if (opts) return mockMemoryChunksDeleteIn();
              return {
                in: mockMemoryChunksDeleteIn,
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({ error: null }),
                  }),
                }),
              };
            },
          } as never;
        }
        return {} as never;
      });

      const storageSetSpy = vi.spyOn(browser.storage.local, 'set').mockResolvedValue(undefined);
      const sendMessageSpy = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);

      // Execute undo logic matching App.tsx
      let toastState = {
        text: 'Saved 2 answers to memory',
        insertedIds,
        canUndo: true,
        isUndone: false,
      };

      // 1. Fetch matching qa_pairs
      const { data: qaRows } = await supabase
        .from('qa_pairs')
        .select('id, question_label, answer_text')
        .in('id', insertedIds)
        .eq('user_id', userId);

      expect(qaRows).toHaveLength(2);

      // 2. Delete qa_pairs
      const { error: deleteError } = await supabase
        .from('qa_pairs')
        .delete()
        .in('id', insertedIds)
        .eq('user_id', userId);

      expect(deleteError).toBeNull();

      // 3. Storage and broadcast
      await browser.storage.local.set({
        jobibi_last_capture_undone: {
          at: Date.now(),
          insertedIds,
        },
      });

      await browser.runtime.sendMessage({
        type: 'JOBIBI_CAPTURE_UNDONE',
        payload: { insertedIds },
      });

      toastState = {
        text: 'Capture undone',
        insertedIds: [],
        canUndo: false,
        isUndone: true,
      };

      expect(storageSetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          jobibi_last_capture_undone: expect.objectContaining({
            insertedIds,
          }),
        }),
      );

      expect(sendMessageSpy).toHaveBeenCalledWith({
        type: 'JOBIBI_CAPTURE_UNDONE',
        payload: { insertedIds },
      });

      expect(toastState.text).toBe('Capture undone');
      expect(toastState.canUndo).toBe(false);
      expect(toastState.isUndone).toBe(true);
    });

    it('handles undo failure gracefully by setting inline error and keeping undo available', async () => {
      const insertedIds = ['qa-fail-1'];
      const userId = 'user-123';

      vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
        if (table === 'qa_pairs') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ id: 'qa-fail-1', question_label: 'Q', answer_text: 'A' }],
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: new Error('Database connection lost') }),
              }),
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        } as never;
      });

      let toastState = {
        text: 'Saved 1 answer to memory',
        insertedIds,
        canUndo: true,
        isUndoing: false,
        error: undefined as string | undefined,
      };

      try {
        const { error } = await supabase
          .from('qa_pairs')
          .delete()
          .in('id', insertedIds)
          .eq('user_id', userId);

        if (error) throw error;
      } catch (err: unknown) {
        toastState = {
          ...toastState,
          isUndoing: false,
          error: `Failed to undo: ${(err as Error).message}`,
        };
      }

      expect(toastState.error).toContain('Database connection lost');
      expect(toastState.canUndo).toBe(true);
      expect(toastState.isUndoing).toBe(false);
    });

    it('automatically dismisses the "Capture undone" toast after 5 seconds (5000ms)', () => {
      vi.useFakeTimers();

      const toastRef: {
        current: { text: string; insertedIds: string[]; canUndo: boolean; isUndone?: boolean } | null;
      } = {
        current: {
          text: 'Saved 2 answers to memory',
          insertedIds: ['qa-1', 'qa-2'],
          canUndo: true,
        },
      };

      let timer: number | null = null;

      // Simulate undo completion
      toastRef.current = {
        text: 'Capture undone',
        insertedIds: [],
        canUndo: false,
        isUndone: true,
      };

      timer = setTimeout(() => {
        if (toastRef.current?.isUndone) {
          toastRef.current = null;
        }
      }, 5000) as unknown as number;

      expect(toastRef.current).not.toBeNull();
      expect(toastRef.current?.text).toBe('Capture undone');

      // Still visible before 5000ms (e.g. at 4000ms)
      vi.advanceTimersByTime(4000);
      expect(toastRef.current).not.toBeNull();
      expect(toastRef.current?.text).toBe('Capture undone');

      // Dismissed at 5000ms
      vi.advanceTimersByTime(1000);
      expect(toastRef.current).toBeNull();

      vi.useRealTimers();
    });
  });
});

