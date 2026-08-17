import { describe, it, expect, vi } from 'vitest';
import { dispatchBackgroundRebuild, shouldTriggerRebuild } from './styleProfile.ts';

describe('styleProfile background dispatch & trigger logic', () => {
  describe('dispatchBackgroundRebuild', () => {
    it('dispatches task to edgeRuntime.waitUntil if available', () => {
      const mockWaitUntil = vi.fn();
      const mockRuntime = { waitUntil: mockWaitUntil };
      const task = vi.fn().mockResolvedValue({ ok: true });

      dispatchBackgroundRebuild(task, mockRuntime);

      expect(mockWaitUntil).toHaveBeenCalledTimes(1);
      expect(mockWaitUntil).toHaveBeenCalledWith(expect.any(Promise));
    });

    it('runs task safely without throwing when edgeRuntime is undefined', () => {
      const task = vi.fn().mockResolvedValue({ ok: true });

      expect(() => {
        dispatchBackgroundRebuild(task, undefined);
      }).not.toThrow();
    });

    it('isolates errors if task throws asynchronously', async () => {
      const mockWaitUntil = vi.fn((p: Promise<unknown>) => p.catch(() => {}));
      const mockRuntime = { waitUntil: mockWaitUntil };
      const failingTask = vi.fn().mockRejectedValue(new Error('Async compute failure'));

      expect(() => {
        dispatchBackgroundRebuild(failingTask, mockRuntime);
      }).not.toThrow();
    });

    it('handles synchronous throw in task safely', () => {
      const mockWaitUntil = vi.fn();
      const mockRuntime = { waitUntil: mockWaitUntil };
      const syncThrowTask = vi.fn().mockImplementation(() => {
        throw new Error('Sync compute failure');
      });

      expect(() => {
        dispatchBackgroundRebuild(syncThrowTask, mockRuntime);
      }).not.toThrow();
    });
  });

  describe('shouldTriggerRebuild', () => {
    it('triggers when currentCount - lastCorpusSize >= 10', () => {
      expect(shouldTriggerRebuild(10, 0)).toBe(true);
      expect(shouldTriggerRebuild(25, 15)).toBe(true);
      expect(shouldTriggerRebuild(19, 10)).toBe(false);
      expect(shouldTriggerRebuild(5, 0)).toBe(false);
    });
  });
});
