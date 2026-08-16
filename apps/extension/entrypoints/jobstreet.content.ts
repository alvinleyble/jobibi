import { extractJobStreetQuestions, verifySingleMapping, executeAutofill, readHumanValue, readHumanCheckboxGroupValue } from '@jobibi/shared';
import type { ExtractionResult, ExtractedQuestion, InsertFieldPayload } from '@jobibi/shared';

// Answer entry shape shared between the live capture path and the eager
// pre-navigation snapshot (Slice 2: reliable Continue trigger).
interface CaptureAnswerEntry {
  questionLabel: string;
  answerText: string;
  draftText: string | null;
  fieldSelector: string;
  fieldId: string;
  mappingVerified: boolean;
  mismatchReason?: string;
}

interface CaptureSnapshot {
  answers: CaptureAnswerEntry[];
  mismatches: Array<{ questionLabel: string; reason: string }>;
  jobContext: ExtractionResult['jobContext'];
  url: string;
  host: string;
}


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
    '<all_urls>',
  ],
  runAt: 'document_idle',
  allFrames: false,

  main(ctx) {
    if (!/jobstreet|seek|jobsdb/i.test(location.host) || !/apply/i.test(location.pathname + location.href)) {
      return;
    }
    let lastResult: ExtractionResult | null = null;
    let debounceTimer: number | null = null;
    const pendingDraftMap = new Map<string, string>();
    // D16: mapping snapshot taken at the moment a draft is offered for a question —
    // this, not a later re-scan, is "the mapping used at suggestion time".
    const suggestionMappingById = new Map<string, ExtractedQuestion>();
    // Slice 2: eager pre-navigation capture snapshot (see performCapture).
    let pendingCaptureSnapshot: CaptureSnapshot | null = null;

    function scanAndBroadcast() {
      const result = extractJobStreetQuestions(document);
      // Only broadcast when something changed (avoid spamming).
      const key = JSON.stringify(result.questions.map((q) => [q.id, q.label, q.confidence]));
      const lastKey = lastResult ? JSON.stringify(lastResult.questions.map((q) => [q.id, q.label, q.confidence])) : null;
      if (key !== lastKey || !lastResult) {
        lastResult = result;
        browser.runtime.sendMessage({ type: 'JOBIBI_QUESTIONS', payload: { ...result, adapter: 'jobstreet' } }).catch(() => {
          // No listener (panel closed) — ignore.
        });
      } else {
        lastResult = result;
      }
      // S7 telemetry: log when JobStreet adapter expected questions but found none
      const hasApplyMarkers = /_Q_/.test(document.body?.innerHTML || '') || document.body?.textContent?.includes('Answer employer questions');
      const rawCount = document.querySelectorAll('textarea, input[type="text"], input[type="email"], input[type="tel"], input[type="number"], select, input[type="radio"], input[type="checkbox"]').length;
      if (hasApplyMarkers && rawCount > 0 && result.questions.length === 0) {
        browser.runtime
          .sendMessage({
            type: 'JOBIBI_EXTRACTION_FAILURE',
            payload: {
              adapter: 'jobstreet',
              host: location.host,
              url: location.href,
              detected_fields: rawCount,
              extracted_questions: 0,
              failure_reason: 'JobStreet apply flow detected but no questions extracted',
            },
          })
          .catch(() => {});
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
    // Human-readable value resolution (Findings A & B): delegated to shared
    // readHumanValue / readHumanCheckboxGroupValue. Checkbox groups are read
    // as a joined ", " list rather than a single token.
    function readFieldValue(el: Element): string {
      if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'checkbox' && el.getAttribute('name')) {
        const gv = readHumanCheckboxGroupValue(el, document);
        // gv is '' when none checked — matches previous "skip empty" contract
        if (gv) return gv;
        // fall through to single-elt handling so unchecked firstEl returns ''
        // (group case with 0 checked is correctly '' even without this)
      }
      return readHumanValue(el, document);
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

    // D16 + D12: read answered values from a given extraction result. Reuses
    // the suggestion-time mapping (verifySingleMapping) for questions Jobibi
    // helped with, then falls through to every identified question field.
    function readAnswersFrom(
      result: ExtractionResult,
    ): { answers: CaptureAnswerEntry[]; mismatches: Array<{ questionLabel: string; reason: string }> } {
      const freshById = new Map<string, ExtractedQuestion>(result.questions.map((q) => [q.id, q]));
      const answers: CaptureAnswerEntry[] = [];
      const mismatches: Array<{ questionLabel: string; reason: string }> = [];
      const seenFreshIds = new Set<string>();

      // D16: verify each mapping snapshotted at suggestion time against the re-derived mapping
      for (const [qId, origQ] of suggestionMappingById) {
        const freshQ = freshById.get(qId);
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
        const draft = pendingDraftMap.get(qId) ?? null;
        answers.push({
          questionLabel: origQ.label,
          answerText: val,
          draftText: draft,
          fieldSelector: origQ.field.selector,
          fieldId: origQ.field.id ?? '',
          mappingVerified: true,
        });
        seenFreshIds.add(qId);
      }

      // D12: capture every identified question field, including ones Jobibi did not help with
      for (const freshQ of result.questions) {
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

      return { answers, mismatches };
    }

    // Slice 2: snapshot field values + mapping synchronously BEFORE the SPA
    // navigation that a Continue click triggers. Re-deriving here (at click
    // time) is the D16 "capture time" — the deferred performCapture may run
    // after the DOM has already swapped to the next step.
    function captureSnapshotNow(): CaptureSnapshot | null {
      const result = extractJobStreetQuestions(document);
      const { answers, mismatches } = readAnswersFrom(result);
      if (answers.length === 0 && mismatches.length === 0) return null;
      return {
        answers,
        mismatches,
        jobContext: result.jobContext,
        url: location.href,
        host: location.host,
      };
    }

    // D16 cross-job guard for the stashed snapshot: after an SPA step
    // transition the old mapping is gone, so verify the application is still
    // the same job (role/company match when both are present, and the URL's
    // job path — everything before /apply/ — is unchanged) instead of
    // re-deriving the now-gone question→field mapping.
    function isSameApplication(snapshot: CaptureSnapshot, fresh: ExtractionResult): boolean {
      const s = snapshot.jobContext;
      const f = fresh.jobContext;
      if (s.roleTitle && f.roleTitle && s.roleTitle !== f.roleTitle) return false;
      if (s.company && f.company && s.company !== f.company) return false;
      try {
        const snapJob = new URL(snapshot.url).pathname.split('/apply/')[0] ?? '';
        const freshJob = location.pathname.split('/apply/')[0] ?? '';
        if (snapJob && freshJob && snapJob !== freshJob) return false;
      } catch {
        // URL unparseable — fall back to jobContext check alone.
      }
      return true;
    }

    function performCapture(trigger: string) {
      const freshResult = extractJobStreetQuestions(document);
      const fresh = readAnswersFrom(freshResult);
      let answers = fresh.answers;
      let mismatches = fresh.mismatches;
      let jobContext = freshResult.jobContext;

      // Eager-snapshot fallback: when the deferred capture re-derives an empty
      // result (the SPA already navigated to the next step), merge the answers
      // stashed at click time — guarded by the same-application check.
      const snap = pendingCaptureSnapshot;
      pendingCaptureSnapshot = null;
      if (
        answers.length === 0 &&
        mismatches.length === 0 &&
        snap &&
        snap.answers.length > 0 &&
        isSameApplication(snap, freshResult)
      ) {
        answers = snap.answers;
        mismatches = snap.mismatches;
        jobContext = snap.jobContext;
      }

      if (answers.length === 0 && mismatches.length === 0) return;

      // Expose for testing: attach last capture payload to window for headless verification
      try {
        (window as unknown as { __JOBIBI_LAST_CAPTURE__?: unknown }).__JOBIBI_LAST_CAPTURE__ = {
          answers,
          mismatches,
          trigger,
          jobContext,
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
            jobContext,
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

    // Listen for submit / navigation triggers.
    // Single-flight: a shared scheduling timer means a click on a
    // <button type="submit"> (which fires both `click` and `submit` for the
    // same user action) collapses to one performCapture call, not two. A
    // cooldown after any capture suppresses the beforeunload/visibility
    // fallbacks from re-capturing values that were already captured moments
    // earlier by the same submission.
    let captureTimer: number | null = null;
    let pendingCaptureTrigger: string | null = null;
    let lastCaptureAt = 0;
    const CAPTURE_COOLDOWN_MS = 4000;

    const runCapture = (trigger: string) => {
      lastCaptureAt = Date.now();
      performCapture(trigger);
    };

    const scheduleCapture = (trigger: string, delay: number) => {
      if (captureTimer !== null) window.clearTimeout(captureTimer);
      pendingCaptureTrigger = trigger;
      captureTimer = window.setTimeout(() => {
        captureTimer = null;
        pendingCaptureTrigger = null;
        runCapture(trigger);
      }, delay);
    };

    const captureIfNotCoolingDown = (trigger: string) => {
      if (captureTimer !== null) {
        // A submit/click capture is already scheduled but the page may unload
        // before its timer fires (setTimeout is not guaranteed to run during
        // teardown) — flush it synchronously now instead of dropping it.
        window.clearTimeout(captureTimer);
        const flushTrigger = pendingCaptureTrigger ?? trigger;
        captureTimer = null;
        pendingCaptureTrigger = null;
        runCapture(flushTrigger);
        return;
      }
      if (Date.now() - lastCaptureAt < CAPTURE_COOLDOWN_MS) return;
      runCapture(trigger);
    };

    // Expanded submit-like button selector. JobStreet/Seek "Continue" is often
    // a hash-classed <button> or an <a role="button"> outside a <form>, so a
    // bare type=submit match misses it. The text fallback below covers the rest.
    const BUTTON_SELECTOR = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-automation*="submit" i]',
      'button[data-automation*="continue" i]',
      'button[data-automation*="next" i]',
      'button[data-automation*="review" i]',
      '[data-testid*="submit" i]',
      '[data-testid*="continue" i]',
      '[data-testid*="next" i]',
      '[data-testid*="review" i]',
      'button[aria-label*="Submit" i]',
      'button[aria-label*="Continue" i]',
      'button[aria-label*="Next" i]',
      'button[aria-label*="Review" i]',
      'button[aria-label*="Save" i]',
      'button[aria-label*="Update" i]',
    ].join(', ');

    // Broader matchers with no reliable intent signal on their own — only fire
    // capture when the element's visible text also passes isSubmitText().
    const BROAD_BUTTON_SELECTOR = [
      'a[role="button"]',
      '[class*="submit" i]',
      '[class*="continue" i]',
      '[class*="next" i]',
      '[class*="review" i]',
    ].join(', ');

    const isSubmitText = (raw: string): boolean => {
      const t = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      if (/^(submit|continue|next|update|save|save and continue|review|done|next step)$/.test(t)) return true;
      // Contains-match with a step indicator ("Continue (2/3)", "Review →").
      return /(^|\s)(continue|review|next|submit|save|update)(\s|$|\(|•|→|›)/.test(t);
    };

    // Take the eager pre-navigation snapshot once per user action.
    const stashSnapshotIfAny = () => {
      if (pendingCaptureSnapshot) return;
      const snap = captureSnapshotNow();
      if (snap) pendingCaptureSnapshot = snap;
    };

    const onSubmitCapture = () => {
      // Snapshot before the submit default action navigates.
      stashSnapshotIfAny();
      // small delay to let DOM settle (e.g., React controlled value flush)
      scheduleCapture('submit', 150);
    };
    document.addEventListener('submit', onSubmitCapture, true);

    const onClickCapture = (e: Event) => {
      const target = e.target as Element | null;
      if (!target) return;
      const submitEl = target.closest(BUTTON_SELECTOR);
      if (submitEl) {
        stashSnapshotIfAny();
        scheduleCapture('click-submit', 300);
        return;
      }
      // Broad matchers (a[role=button], generic submit/continue/next/review
      // class substrings) have no reliable intent on their own — require the
      // element's visible text to also look like a submission action.
      const broadEl = target.closest(BROAD_BUTTON_SELECTOR);
      if (broadEl && isSubmitText(broadEl.textContent ?? '')) {
        stashSnapshotIfAny();
        scheduleCapture('click-submit', 300);
        return;
      }
      // textContent fallback for ATS-specific labels (Update, Save, etc.)
      const btn = (e.target as Element | null)?.closest('button, input[type="submit"], a[role="button"]');
      if (btn && isSubmitText(btn.textContent ?? '')) {
        stashSnapshotIfAny();
        scheduleCapture('click-text-match', 300);
      }
    };
    document.addEventListener('click', onClickCapture, true);

    const onBeforeUnload = () => captureIfNotCoolingDown('beforeunload');
    window.addEventListener('beforeunload', onBeforeUnload);

    const onVisibilityHidden = () => {
      if (document.visibilityState === 'hidden') captureIfNotCoolingDown('visibility-hidden');
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
          const snapshotSuggestionMapping = (id: string) => {
            if (!lastResult) lastResult = extractJobStreetQuestions(document);
            const q = lastResult.questions.find((qq) => qq.id === id);
            if (q) suggestionMappingById.set(id, q);
          };
          if (payload?.drafts) {
            for (const [id, txt] of Object.entries(payload.drafts)) {
              if (txt) {
                pendingDraftMap.set(id, txt);
                snapshotSuggestionMapping(id);
              } else {
                pendingDraftMap.delete(id);
                suggestionMappingById.delete(id);
              }
            }
          } else if (payload?.id) {
            if (payload.draftText) {
              pendingDraftMap.set(payload.id, payload.draftText);
              snapshotSuggestionMapping(payload.id);
            } else {
              pendingDraftMap.delete(payload.id);
              suggestionMappingById.delete(payload.id);
            }
          }
          sendResponse({ ok: true });
          return true;
        }
        if (t === 'JOBIBI_INSERT_FIELD') {
          const payload = (message as { payload?: InsertFieldPayload }).payload;
          if (!payload) {
            sendResponse({ ok: false, error: 'Missing insert payload' });
            return true;
          }
          const snapshotSuggestionMapping = (id: string) => {
            if (!lastResult) lastResult = extractJobStreetQuestions(document);
            const q = lastResult.questions.find((qq) => qq.id === id);
            if (q) suggestionMappingById.set(id, q);
          };

          let el: Element | null = null;
          let conf: number | undefined = payload.confidence;
          if (payload.questionId) {
            if (!lastResult) lastResult = extractJobStreetQuestions(document);
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

          if (res.ok && payload.questionId) {
            pendingDraftMap.set(payload.questionId, payload.text);
            snapshotSuggestionMapping(payload.questionId);
          }
          sendResponse(res);
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
      if (captureTimer !== null) window.clearTimeout(captureTimer);
      observer.disconnect();
      browser.runtime.onMessage.removeListener(onMessage as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
      document.removeEventListener('submit', onSubmitCapture, true);
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityHidden);
    });
  },
});
