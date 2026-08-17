import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleCapture, safeUrlHash, type CapturePayload } from '../background';
import { supabase } from './supabase';

describe('Background Service Worker Capture Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('safeUrlHash', () => {
    it('returns 32-char btoa substring for valid URLs', () => {
      const url = 'https://ph.jobstreet.com/job/12345/apply';
      const hash = safeUrlHash(url);
      expect(hash).toBeDefined();
      expect(hash?.length).toBeLessThanOrEqual(32);
      expect(hash).toBe(btoa(url).slice(0, 32));
    });

    it('returns undefined when URL is undefined or empty', () => {
      expect(safeUrlHash(undefined)).toBeUndefined();
      expect(safeUrlHash('')).toBeUndefined();
    });
  });

  describe('handleCapture', () => {
    const samplePayload: CapturePayload = {
      answers: [
        {
          questionLabel: 'Why do you want to work here?',
          answerText: 'Because of your great culture.',
          draftText: null,
          fieldSelector: '#q1',
          fieldId: 'q1',
          mappingVerified: true,
        },
      ],
      mismatches: [],
      jobContext: {
        roleTitle: 'Software Engineer',
        company: 'Acme Corp',
        url: 'https://indeed.com/apply/1',
      },
      trigger: 'submit',
      url: 'https://indeed.com/apply/1',
      host: 'indeed.com',
    };

    it('invokes capture Edge Function, stores jobibi_last_capture, and broadcasts JOBIBI_CAPTURE_COMPLETED', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: {
          session: {
            access_token: 'fake-jwt-token',
            refresh_token: 'fake-refresh',
            expires_in: 3600,
            token_type: 'bearer',
            user: { id: 'user-123', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
          },
        },
        error: null,
      });

      const mockInvoke = vi.fn().mockResolvedValue({
        data: {
          ok: true,
          inserted: 1,
          insertedIds: ['qa-1'],
          droppedMismatched: 0,
        },
        error: null,
      });

      // Stub functions client
      vi.spyOn(supabase, 'functions', 'get').mockReturnValue({
        invoke: mockInvoke,
      } as never);

      const setSpy = vi.spyOn(browser.storage.local, 'set').mockResolvedValue(undefined);
      const sendSpy = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);

      const res = await handleCapture(samplePayload);

      expect(res.ok).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('capture', {
        body: expect.objectContaining({
          application: expect.objectContaining({
            company: 'Acme Corp',
            roleTitle: 'Software Engineer',
            site: 'indeed.com',
          }),
          answers: expect.arrayContaining([
            expect.objectContaining({
              questionLabel: 'Why do you want to work here?',
              answerText: 'Because of your great culture.',
              mappingVerified: true,
            }),
          ]),
        }),
        headers: {
          Authorization: 'Bearer fake-jwt-token',
        },
      });

      expect(setSpy).toHaveBeenCalledWith({
        jobibi_last_capture: expect.objectContaining({
          at: expect.any(Number),
          inserted: 1,
          droppedMismatched: 0,
        }),
      });

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'JOBIBI_CAPTURE_COMPLETED',
        payload: expect.objectContaining({
          inserted: 1,
          droppedMismatched: 0,
        }),
      });
    });

    it('handles large multi-answer captures (~15 items) with 200 OK and broadcasts completion', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: {
          session: {
            access_token: 'fake-jwt-token',
            refresh_token: 'fake-refresh',
            expires_in: 3600,
            token_type: 'bearer',
            user: { id: 'user-123', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
          },
        },
        error: null,
      });

      const fifteenAnswers = Array.from({ length: 15 }, (_, i) => ({
        questionLabel: `Requirement question ${i + 1}`,
        answerText: `Answer for requirement ${i + 1}`,
        draftText: null,
        fieldSelector: `#q_${i + 1}`,
        fieldId: `q_${i + 1}`,
        mappingVerified: true,
      }));

      const largePayload: CapturePayload = {
        ...samplePayload,
        answers: fifteenAnswers,
      };

      const mockInvoke = vi.fn().mockResolvedValue({
        data: {
          ok: true,
          applicationId: 'app-456',
          inserted: 15,
          insertedIds: fifteenAnswers.map((_, i) => `qa-${i + 1}`),
          droppedMismatched: 0,
          memoryChunksFailed: 0,
          dedupSkipped: 0,
        },
        error: null,
      });

      vi.spyOn(supabase, 'functions', 'get').mockReturnValue({
        invoke: mockInvoke,
      } as never);

      const setSpy = vi.spyOn(browser.storage.local, 'set').mockResolvedValue(undefined);
      const sendSpy = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);

      const res = await handleCapture(largePayload);

      expect(res.ok).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('capture', expect.objectContaining({
        body: expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({ questionLabel: 'Requirement question 1' }),
            expect.objectContaining({ questionLabel: 'Requirement question 15' }),
          ]),
        }),
      }));
      expect(setSpy).toHaveBeenCalledWith({
        jobibi_last_capture: expect.objectContaining({
          inserted: 15,
          droppedMismatched: 0,
        }),
      });
      expect(sendSpy).toHaveBeenCalledWith({
        type: 'JOBIBI_CAPTURE_COMPLETED',
        payload: expect.objectContaining({
          inserted: 15,
        }),
      });
    });

    it('surfaces capture Edge Function errors via storage and a failure broadcast', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const mockInvoke = vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Network error or 401'),
      });

      vi.spyOn(supabase, 'functions', 'get').mockReturnValue({
        invoke: mockInvoke,
      } as never);

      const setSpy = vi.spyOn(browser.storage.local, 'set');
      const sendSpy = vi.spyOn(browser.runtime, 'sendMessage');

      const res = await handleCapture(samplePayload);

      expect(res.ok).toBe(false);
      expect(setSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          jobibi_last_capture_error: expect.objectContaining({ message: expect.any(String) }),
        }),
      );
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'JOBIBI_CAPTURE_FAILED' }),
      );
    });
  });
});

