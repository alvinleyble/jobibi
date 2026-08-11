import { extractJobStreetQuestions, verifySingleMapping } from '@jobibi/shared';
import type { ExtractionResult, ExtractedQuestion } from '@jobibi/shared';

export default defineContentScript({
  // Scoped to apply pages only — homepage/search filters were leaking 38
  // filter checkboxes into the panel (visual test). Generic fallback is S7.
  matches: [
    '*://*.jobstreet.com.ph/*apply*',
    '*://*.jobstreet.com/*apply*',
    '*://*.seek.com.au/*apply*',
    '*://*.seek.co.nz/*apply*',
    '*://*.jobsdb.com/*apply*',
    '*://ph.jobstreet.com/apply/*',
  ],
  runAt: 'document_idle',
  allFrames: false,

  main(ctx) {
    let lastResult: ExtractionResult | null = null;
    let debounceTimer: number | null = null;
    const pendingDraftMap = new Map<string, string>();

    function scanAndBroadcast() {
      const result = extractJobStreetQuestions(document);
      // Only broadcast when something changed (avoid spamming).
      const key = JSON.stringify(result.questions.map((q) => [q.id, q.label, q.confidence]));
      const lastKey = lastResult ? JSON.stringify(lastResult.questions.map((q) => [q.id, q.label, q.confidence])) : null;
      if (key !== lastKey || !lastResult) {
        lastResult = result;
        browser.runtime.sendMessage({ type: 'JOBIBI_QUESTIONS', payload: result }).catch(() => {
          // No listener (panel closed) — ignore.
        });
      } else {
        lastResult = result;
      }
    }

    function debouncedScan() {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(scanAndBroadcast, 300);
    }

    // Initial scan after a short delay (JobStreet renders forms async).
    const initTimer = window.setTimeout(scanAndBroadcast, 800);

    // Watch for DOM mutations (form injected, pagination, etc.).
    const observer = new MutationObserver(debouncedScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    // ---- S6 capture helpers (D16 + D12) ----
    function readFieldValue(el: Element): string {
      if (el instanceof HTMLTextAreaElement) return el.value;
      if (el instanceof HTMLSelectElement) return el.value;
      if (el instanceof HTMLInputElement) {
        const t = el.type.toLowerCase();
        if (t === 'checkbox' || t === 'radio') {
          if (!el.checked) return '';
          // For grouped checkboxes, read value; for radio, same
          return el.value || (el.checked ? 'checked' : '');
        }
        return el.value;
      }
      return (el as HTMLElement).innerText ?? '';
    }

    function getFieldElement(q: ExtractedQuestion): Element | null {
      try {
        const bySelector = document.querySelector(q.field.selector);
        if (bySelector) return bySelector;
      } catch {
        // selector parse error — fallback
      }
      if (q.field.id) {
        const byId = document.getElementById(q.field.id);
        if (byId) return byId;
      }
      if (q.field.name) {
        try {
          // CSS.escape may not exist in all envs
          const esc = (globalThis as unknown as { CSS?: { escape: (v: string) => string } }).CSS?.escape
            ? (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS.escape(q.field.name)
            : q.field.name.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
          const byName = document.querySelector(`${q.field.tagName}[name="${esc}"]`);
          if (byName) return byName;
        } catch {
          // ignore
        }
      }
      return null;
    }

    function performCapture(trigger: string) {
      if (!lastResult || lastResult.questions.length === 0) {
        // Still try fresh scan for D12 (capture all identified fields even if no prior broadcast)
        const freshFallback = extractJobStreetQuestions(document);
        if (!freshFallback.questions.length) return;
        // Capture fresh-only
        lastResult = freshFallback;
      }
      const originalQuestions: ExtractedQuestion[] = lastResult?.questions ?? [];
      const freshResult = extractJobStreetQuestions(document);
      const freshById = new Map<string, ExtractedQuestion>(freshResult.questions.map((q) => [q.id, q]));

      const answers: Array<{
        questionLabel: string;
        answerText: string;
        draftText: string | null;
        fieldSelector: string;
        fieldId: string;
        mappingVerified: boolean;
        mismatchReason?: string;
      }> = [];
      const mismatches: Array<{ questionLabel: string; reason: string }> = [];
      const seenFreshIds = new Set<string>();

      // D16: verify each original mapping against re-derived mapping
      for (const origQ of originalQuestions) {
        const freshQ = freshById.get(origQ.id);
        const verify = verifySingleMapping(origQ, freshQ);
        if (!verify.ok) {
          mismatches.push({ questionLabel: origQ.label, reason: verify.reason ?? 'mapping mismatch' });
          // eslint-disable-next-line no-console
          console.warn(`[Jobibi] D16 capture mismatch for "${origQ.label}": ${verify.reason} — dropping write`);
          continue;
        }
        const el = getFieldElement(origQ);
        if (!el) continue;
        const val = readFieldValue(el).trim();
        if (!val) continue;
        const draft = pendingDraftMap.get(origQ.id) ?? null;
        answers.push({
          questionLabel: origQ.label,
          answerText: val,
          draftText: draft,
          fieldSelector: origQ.field.selector,
          fieldId: origQ.field.id ?? '',
          mappingVerified: true,
        });
        seenFreshIds.add(origQ.id);
      }

      // D12: capture every identified question field, including ones Jobibi did not help with
      for (const freshQ of freshResult.questions) {
        if (seenFreshIds.has(freshQ.id)) continue;
        const el = getFieldElement(freshQ);
        if (!el) continue;
        const val = readFieldValue(el).trim();
        if (!val) continue;
        answers.push({
          questionLabel: freshQ.label,
          answerText: val,
          draftText: pendingDraftMap.get(freshQ.id) ?? null,
          fieldSelector: freshQ.field.selector,
          fieldId: freshQ.field.id ?? '',
          mappingVerified: true,
        });
      }

      if (answers.length === 0 && mismatches.length === 0) return;

      // Expose for testing: attach last capture payload to window for headless verification
      try {
        (window as unknown as { __JOBIBI_LAST_CAPTURE__?: unknown }).__JOBIBI_LAST_CAPTURE__ = {
          answers,
          mismatches,
          trigger,
          jobContext: freshResult.jobContext,
          url: location.href,
          host: location.host,
        };
      } catch {
        // ignore
      }

      browser.runtime
        .sendMessage({
          type: 'JOBIBI_CAPTURE',
          payload: {
            answers,
            mismatches,
            jobContext: freshResult.jobContext,
            trigger,
            url: location.href,
            host: location.host,
          },
        })
        .catch(() => {
          // No listener
        });

      if (mismatches.length) {
        // eslint-disable-next-line no-console
        console.warn(`[Jobibi] capture dropped ${mismatches.length} mismatched write(s)`);
      }
    }

    // Listen for submit / navigation triggers
    const onSubmitCapture = () => {
      // small delay to let DOM settle (e.g., React controlled value flush)
      window.setTimeout(() => performCapture('submit'), 150);
    };
    document.addEventListener('submit', onSubmitCapture, true);

    const onClickCapture = (e: Event) => {
      const target = e.target as Element | null;
      if (!target) return;
      const submitEl = target.closest(
        'button[type="submit"], input[type="submit"], button[data-automation*="submit" i], [class*="submit" i], [data-testid*="submit" i]',
      );
      if (submitEl) {
        window.setTimeout(() => performCapture('click-submit'), 300);
      }
    };
    document.addEventListener('click', onClickCapture, true);

    const onBeforeUnload = () => performCapture('beforeunload');
    window.addEventListener('beforeunload', onBeforeUnload);

    const onVisibilityHidden = () => {
      if (document.visibilityState === 'hidden') performCapture('visibility-hidden');
    };
    document.addEventListener('visibilitychange', onVisibilityHidden);

    // For manual testing: expose performCapture on window
    try {
      (window as unknown as { __JOBIBI_CAPTURE_NOW__?: () => void }).__JOBIBI_CAPTURE_NOW__ = () =>
        performCapture('manual');
    } catch {
      // ignore
    }

    // Respond to sidepanel requesting current questions and draft updates.
    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (typeof message === 'object' && message !== null) {
        const t = (message as { type?: string }).type;
        if (t === 'JOBIBI_REQUEST_QUESTIONS') {
          if (!lastResult) {
            lastResult = extractJobStreetQuestions(document);
          }
          sendResponse({ type: 'JOBIBI_QUESTIONS', payload: lastResult });
          return true;
        }
        if (t === 'JOBIBI_DRAFT_UPDATE') {
          const payload = (message as { payload?: { id?: string; draftText?: string | null; drafts?: Record<string, string | null> } }).payload;
          if (payload?.drafts) {
            for (const [id, txt] of Object.entries(payload.drafts)) {
              if (txt) pendingDraftMap.set(id, txt);
              else pendingDraftMap.delete(id);
            }
          } else if (payload?.id) {
            if (payload.draftText) pendingDraftMap.set(payload.id, payload.draftText);
            else pendingDraftMap.delete(payload.id);
          }
          sendResponse({ ok: true });
          return true;
        }
        if (t === 'JOBIBI_CAPTURE_NOW') {
          performCapture('manual-message');
          sendResponse({ ok: true });
          return true;
        }
      }
      return false;
    };
    browser.runtime.onMessage.addListener(onMessage as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

    ctx.onInvalidated(() => {
      window.clearTimeout(initTimer);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      observer.disconnect();
      browser.runtime.onMessage.removeListener(onMessage as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
      document.removeEventListener('submit', onSubmitCapture, true);
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityHidden);
    });
  },
});
