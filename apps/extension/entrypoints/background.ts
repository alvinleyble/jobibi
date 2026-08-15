import { supabase } from './sidepanel/supabase';

export interface CapturePayload {
  answers: Array<{
    questionLabel: string;
    questionNorm?: string;
    answerText: string;
    draftText: string | null;
    fieldSelector: string;
    fieldId: string;
    mappingVerified: boolean;
    mismatchReason?: string;
  }>;
  mismatches?: Array<{
    questionLabel: string;
    reason: string;
    originalMapping?: unknown;
    rederivedMapping?: unknown;
  }>;
  jobContext?: {
    role?: string;
    roleTitle?: string;
    company?: string;
    url?: string;
  };
  trigger?: string;
  url?: string;
  host?: string;
}

export function safeUrlHash(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return typeof btoa !== 'undefined' ? btoa(url).slice(0, 32) : undefined;
  } catch {
    return undefined;
  }
}

export async function handleCapture(payload: CapturePayload): Promise<{ ok: boolean; data?: unknown; error?: unknown }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    const body = {
      application: {
        company: payload.jobContext?.company,
        roleTitle: payload.jobContext?.roleTitle ?? payload.jobContext?.role,
        site: payload.host,
        url: payload.url,
        urlHash: safeUrlHash(payload.url),
      },
      jobContext: {
        role: payload.jobContext?.roleTitle ?? payload.jobContext?.role,
        company: payload.jobContext?.company,
        url: payload.url,
      },
      answers: payload.answers.map((a) => ({
        questionLabel: a.questionLabel,
        questionNorm: a.questionNorm,
        answerText: a.answerText,
        draftText: a.draftText ?? null,
        fieldSelector: a.fieldSelector,
        fieldId: a.fieldId,
        mappingVerified: a.mappingVerified,
        mismatchReason: a.mismatchReason,
      })),
      mismatches: payload.mismatches,
    };

    const invokeHeaders: Record<string, string> = {};
    if (token) {
      invokeHeaders.Authorization = `Bearer ${token}`;
    }

    const { data, error } = await supabase.functions.invoke('capture', {
      body,
      headers: invokeHeaders,
    });

    if (error) {
      console.warn('[background] capture Edge Function error:', error);
      return { ok: false, error };
    }

    if (data) {
      const result = data as { inserted?: number; droppedMismatched?: number; [key: string]: unknown };
      const captureRecord = {
        at: Date.now(),
        ...result,
      };

      await browser.storage.local.set({
        jobibi_last_capture: captureRecord,
      });

      await browser.runtime
        .sendMessage({
          type: 'JOBIBI_CAPTURE_COMPLETED',
          payload: result,
        })
        .catch(() => {});

      return { ok: true, data: result };
    }

    return { ok: false };
  } catch (err) {
    console.error('[background] handleCapture failed:', err);
    return { ok: false, error: err };
  }
}

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null) {
      const msg = message as { type?: string; payload?: CapturePayload };
      if (msg.type === 'JOBIBI_CAPTURE' && msg.payload) {
        void handleCapture(msg.payload);
      }
    }
  });
});
