import { extractJobStreetQuestions } from '@jobibi/shared';
import type { ExtractionResult } from '@jobibi/shared';

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

    // Respond to sidepanel requesting current questions.
    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'JOBIBI_REQUEST_QUESTIONS'
      ) {
        if (!lastResult) {
          lastResult = extractJobStreetQuestions(document);
        }
        sendResponse({ type: 'JOBIBI_QUESTIONS', payload: lastResult });
        return true;
      }
      return false;
    };
    browser.runtime.onMessage.addListener(onMessage as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

    ctx.onInvalidated(() => {
      window.clearTimeout(initTimer);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      observer.disconnect();
      browser.runtime.onMessage.removeListener(onMessage as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
    });
  },
});
