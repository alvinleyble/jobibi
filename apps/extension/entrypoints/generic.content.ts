import { extractGenericQuestions, executeAutofill } from '@jobibi/shared';
import type { ExtractedQuestion, InsertFieldPayload } from '@jobibi/shared';

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
    if (/jobstreet|seek|jobsdb|linkedin|indeed/i.test(location.host)) {
      return;
    }
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

    function getFieldElement(q: ExtractedQuestion): Element | null {
      try {
        const bySelector = document.querySelector(q.field.selector);
        if (bySelector) return bySelector;
      } catch {}
      if (q.field.id) {
        const byId = document.getElementById(q.field.id);
        if (byId) return byId;
      }
      if (q.field.name) {
        try {
          const esc = (globalThis as unknown as { CSS?: { escape: (v: string) => string } }).CSS?.escape
            ? (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS.escape(q.field.name)
            : q.field.name.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
          const byName = document.querySelector(`${q.field.tagName}[name="${esc}"]`);
          if (byName) return byName;
        } catch {}
      }
      return null;
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
        if (t === 'JOBIBI_INSERT_FIELD') {
          const payload = (message as { payload?: InsertFieldPayload }).payload;
          if (!payload) {
            sendResponse({ ok: false, error: 'Missing insert payload' });
            return true;
          }

          let el: Element | null = null;
          let conf: number | undefined = payload.confidence;
          if (payload.questionId) {
            if (!lastResult) lastResult = extractGenericQuestions(document);
            const q = lastResult.questions.find((qq) => qq.id === payload.questionId);
            if (q) {
              if (conf === undefined) conf = q.confidence;
              el = getFieldElement(q);
            }
          }
          if (!el && payload.selector) {
            try {
              el = document.querySelector(payload.selector);
            } catch {}
          }
          if (!el && payload.fieldId) {
            el = document.getElementById(payload.fieldId);
          }

          const res = executeAutofill({
            el,
            text: payload.text,
            confidence: conf,
            isSensitive: payload.isSensitive,
          });

          sendResponse(res);
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
