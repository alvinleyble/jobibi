import { extractGenericQuestions } from '@jobibi/shared';

export default defineContentScript({
  // Generic fallback: runs on all URLs but self-skips on dedicated hosts.
  // Content scripts are isolated worlds; multiple scripts can run on same page
  // without conflict — dedicated adapters handle their hosts, generic handles rest.
  matches: ['<all_urls>'],
  excludeMatches: [
    '*://*.jobstreet.com.ph/*',
    '*://*.jobstreet.com/*',
    '*://*.seek.com.au/*',
    '*://*.seek.co.nz/*',
    '*://*.jobsdb.com/*',
    '*://*.linkedin.com/*',
    '*://*.indeed.com/*',
    '*://*.indeed.co.uk/*',
    '*://*.indeed.com.au/*',
    '*://*.indeed.ca/*',
    '*://*.indeed.co.jp/*',
  ],
  runAt: 'document_idle',
  allFrames: false,

  main(ctx) {
    let lastResult: ReturnType<typeof extractGenericQuestions> | null = null;
    let debounceTimer: number | null = null;

    function scanAndBroadcast() {
      const result = extractGenericQuestions(document);
      const key = JSON.stringify(result.questions.map((q) => [q.id, q.label, q.confidence]));
      const lastKey = lastResult ? JSON.stringify(lastResult.questions.map((q) => [q.id, q.label, q.confidence])) : null;
      if (key !== lastKey || !lastResult) {
        lastResult = result;
        // Only broadcast when we actually found questions — avoid spamming empty results
        // on every generic page. Sidepanel will request on demand if needed.
        if (result.questions.length > 0) {
          browser.runtime.sendMessage({ type: 'JOBIBI_QUESTIONS', payload: result }).catch(() => {});
        } else {
          // Still update lastResult but don't broadcast empties unnecessarily
          // Check for telemetry: form present but nothing extracted
          maybeLogExtractionFailure(result);
        }
      } else {
        lastResult = result;
      }
    }

    function maybeLogExtractionFailure(result: ReturnType<typeof extractGenericQuestions>) {
      // Generic telemetry: page has a form with fields but generic found nothing
      const hasForm = !!document.querySelector('form');
      const hasFields = document.querySelectorAll('textarea, input[type="text"], input[type="email"], select').length > 0;
      const hasQuestionLikeText = /why.*hire|cover letter|expected salary|notice period|years of experience|willing to/i.test(
        document.body?.textContent || '',
      );
      if (hasForm && hasFields && hasQuestionLikeText && result.questions.length === 0) {
        const rawCount = document.querySelectorAll('textarea, input[type="text"], input[type="email"], input[type="tel"], input[type="number"], select, input[type="radio"], input[type="checkbox"]').length;
        browser.runtime
          .sendMessage({
            type: 'JOBIBI_EXTRACTION_FAILURE',
            payload: {
              adapter: 'generic',
              host: location.host,
              url: location.href,
              detected_fields: rawCount,
              extracted_questions: 0,
              failure_reason: 'Generic fallback found form with question-like text but extracted 0 questions',
            },
          })
          .catch(() => {});
      }
    }

    function debouncedScan() {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(scanAndBroadcast, 300);
    }

    const initTimer = window.setTimeout(scanAndBroadcast, 800);
    const observer = new MutationObserver(debouncedScan);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: false });

    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (typeof message === 'object' && message !== null) {
        const t = (message as { type?: string }).type;
        if (t === 'JOBIBI_REQUEST_QUESTIONS') {
          if (!lastResult) lastResult = extractGenericQuestions(document);
          sendResponse({ type: 'JOBIBI_QUESTIONS', payload: lastResult });
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
    });
  },
});
