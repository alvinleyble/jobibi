import { extractLinkedInQuestions, verifySingleMapping, executeAutofill, readHumanValue, readHumanCheckboxGroupValue, resolveCapturePayload, linkedInJobKeyFromUrl } from '@jobibi/shared';
import type { ExtractionResult, ExtractedQuestion, InsertFieldPayload, CaptureSnapshot, CaptureAnswerEntry } from '@jobibi/shared';


export default defineContentScript({
  matches: ['*://*.linkedin.com/*', '<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,

  main(ctx) {
    if (!/linkedin/i.test(location.host)) {
      return;
    }
    let lastResult: ExtractionResult | null = null;
    let debounceTimer: number | null = null;
    const pendingDraftMap = new Map<string, string>();
    const suggestionMappingById = new Map<string, ExtractedQuestion>();
    // Eager pre-navigation capture snapshot (Q3 snapshot-at-click). Taken at
    // step-transition click time, merged back in performCapture after the SPA
    // has navigated away from the answered step.
    let pendingCaptureSnapshot: CaptureSnapshot | null = null;

    // Shadow-DOM piercing for content-script DOM queries (S7B fix — mirrors
    // the adapter's getSearchRoots; shallow one-level check for
    // #interop-outlet / #shadow-host-companion plus any open shadowRoot).
    function getShadowRoots(): ParentNode[] {
      const roots: ParentNode[] = [document];
      for (const id of ['interop-outlet', 'shadow-host-companion']) {
        try {
          const host = document.getElementById(id) as unknown as { shadowRoot?: ParentNode } | null;
          const sr = host?.shadowRoot;
          if (sr && !roots.includes(sr)) roots.push(sr);
        } catch {}
      }
      try {
        const all = document.querySelectorAll('*');
        for (const el of Array.from(all)) {
          const sr = (el as unknown as { shadowRoot?: ParentNode }).shadowRoot;
          if (sr && !roots.includes(sr)) roots.push(sr);
        }
      } catch {}
      return roots;
    }
    function queryAcross(selector: string): Element | null {
      for (const r of getShadowRoots()) {
        try {
          const el = (r as unknown as Document).querySelector?.(selector);
          if (el) return el;
        } catch {}
      }
      return null;
    }

    function scanAndBroadcast() {
      try {
        ensureShadowObservers();
      } catch {}
      const result = extractLinkedInQuestions(document);
      const key = JSON.stringify(result.questions.map((q) => [q.id, q.label, q.confidence]));
      const lastKey = lastResult ? JSON.stringify(lastResult.questions.map((q) => [q.id, q.label, q.confidence])) : null;
      if (key !== lastKey || !lastResult) {
        lastResult = result;
        browser.runtime.sendMessage({ type: 'JOBIBI_QUESTIONS', payload: result }).catch(() => {});
      } else {
        lastResult = result;
      }
      maybeLogExtractionFailure(result);
    }

    function maybeLogExtractionFailure(result: ExtractionResult) {
      // Telemetry: log when adapter expected questions but found none.
      // Heuristic: Easy Apply modal/dialog present but no questions extracted.
      const modalPresent = !!queryAcross(
        '.jobs-easy-apply-modal, .jobs-easy-apply-content, [data-test-modal="easy-apply-modal"], .artdeco-modal--is-open, [role="dialog"]',
      );
      const hasFormFields = !!queryAcross('form input, form textarea, form select');
      if (modalPresent && hasFormFields && result.questions.length === 0) {
        // Count raw fields for telemetry (across shadow roots too)
        let rawCount = 0;
        for (const r of getShadowRoots()) {
          try {
            rawCount += (r as unknown as Document).querySelectorAll?.(
              'textarea, input[type="text"], input[type="email"], input[type="tel"], input[type="number"], select, input[type="radio"], input[type="checkbox"]',
            )?.length ?? 0;
          } catch {}
        }
        browser.runtime
          .sendMessage({
            type: 'JOBIBI_EXTRACTION_FAILURE',
            payload: {
              adapter: 'linkedin',
              host: location.host,
              url: location.href,
              detected_fields: rawCount,
              extracted_questions: 0,
              failure_reason: 'Easy Apply modal open with form fields but no questions extracted',
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
    const observer = new MutationObserver(() => {
      debouncedScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: false });
    // Also observe any existing shadow roots (and future ones discovered on each scan)
    const observedShadowRoots = new Set<ParentNode>();
    function ensureShadowObservers() {
      for (const sr of getShadowRoots()) {
        if (sr !== (document as unknown as ParentNode) && !observedShadowRoots.has(sr)) {
          try {
            observer.observe(sr as unknown as Node, { childList: true, subtree: true, attributes: false });
            observedShadowRoots.add(sr);
          } catch {}
        }
      }
    }
    ensureShadowObservers();
    // Poll once more shortly after init in case shadow host is injected late
    window.setTimeout(ensureShadowObservers, 1500);

    // Human-readable value resolution (Findings A & B) — shadow-aware.
    // Label queries are tried across the shadow root as well as document so
    // that <label for> inside #interop-outlet shadow is still found.
    function readFieldValue(el: Element): string {
      const tryRoots: ParentNode[] = [document, ...getShadowRoots().filter((r) => r !== (document as unknown as ParentNode))];

      const isCheckboxGroup = el instanceof HTMLInputElement && el.type.toLowerCase() === 'checkbox' && !!el.getAttribute('name');
      if (isCheckboxGroup) {
        let tokenFallback = '';
        for (const r of tryRoots) {
          const gv = readHumanCheckboxGroupValue(el, r);
          if (!gv) continue;
          if (!tokenFallback) tokenFallback = gv;
        }
        return tokenFallback;
      }

      // Single select / radio / checkbox / text: try each root, preferring a label-derived value over raw token.
      let tokenFallback = '';
      for (const r of tryRoots) {
        const v = readHumanValue(el, r);
        if (!v) continue;
        // For radio/checkbox/select, a fallback equals the raw value; a label differs.
        const raw = (el as HTMLInputElement).value ?? (el as HTMLSelectElement).value ?? '';
        if (v !== raw) return v;
        if (!tokenFallback) tokenFallback = v;
      }
      if (tokenFallback) return tokenFallback;
      // No root yielded a value (e.g. unchecked) — let the primary root decide '' vs value for text inputs.
      return readHumanValue(el, document);
    }

    function getFieldElement(q: ExtractedQuestion): Element | null {
      try {
        const byAcross = queryAcross(q.field.selector);
        if (byAcross) return byAcross;
      } catch {}
      if (q.field.id) {
        for (const r of getShadowRoots()) {
          try {
            const byId = (r as unknown as Document).getElementById?.(q.field.id);
            if (byId) return byId as unknown as Element;
            // ShadowRoots may not have getElementById — fallback to query
            const byIdQ = (r as unknown as Document).querySelector?.(`#${q.field.id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)}`);
            if (byIdQ) return byIdQ;
          } catch {}
        }
      }
      if (q.field.name) {
        try {
          const esc = (globalThis as unknown as { CSS?: { escape: (v: string) => string } }).CSS?.escape
            ? (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS.escape(q.field.name)
            : q.field.name.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
          const byName = queryAcross(`${q.field.tagName}[name="${esc}"]`);
          if (byName) return byName;
        } catch {}
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

    // Q3 snapshot-at-click: snapshot field values + mapping synchronously
    // BEFORE the SPA navigation that a Next/Review click triggers. Re-deriving
    // here (at click time) is the D16 "capture time" — the deferred
    // performCapture may run after the DOM has already swapped to the next step.
    function captureSnapshotNow(): CaptureSnapshot | null {
      const result = extractLinkedInQuestions(document);
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

    function performCapture(trigger: string) {
      const freshResult = extractLinkedInQuestions(document);
      const fresh = readAnswersFrom(freshResult);

      // Q3: when the deferred capture re-derives an empty step (the SPA already
      // navigated to the next step), merge the snapshot stashed at click time —
      // guarded by the same-application check (jobContext + URL job key) so a
      // snapshot from a different job is discarded (D16 cross-job guard).
      const snap = pendingCaptureSnapshot;
      pendingCaptureSnapshot = null;
      const { answers, mismatches, jobContext } = resolveCapturePayload(
        fresh.answers,
        fresh.mismatches,
        freshResult.jobContext,
        location.href,
        snap,
        linkedInJobKeyFromUrl,
      );

      if (answers.length === 0 && mismatches.length === 0) return;

      try {
        (window as unknown as { __JOBIBI_LAST_CAPTURE__?: unknown }).__JOBIBI_LAST_CAPTURE__ = {
          answers,
          mismatches,
          trigger,
          jobContext,
          url: location.href,
          host: location.host,
        };
      } catch {}

      browser.runtime
        .sendMessage({
          type: 'JOBIBI_CAPTURE',
          payload: { answers, mismatches, jobContext, trigger, url: location.href, host: location.host },
        })
        .catch(() => {});

      if (mismatches.length) {
        // eslint-disable-next-line no-console
        console.warn(`[Jobibi] capture dropped ${mismatches.length} mismatched write(s)`);
      }
    }

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

    const onSubmitCapture = () => {
      // Snapshot before the submit default action navigates (light-DOM forms).
      stashSnapshotIfAny();
      scheduleCapture('submit', 150);
    };
    document.addEventListener('submit', onSubmitCapture, true);

    // Expanded submit-like button selector. LinkedIn's Easy Apply buttons are
    // often <button aria-label="Continue to next step"> / "Review your
    // application" / "Submit application", tagged with data-control-name.
    const BUTTON_SELECTOR = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[aria-label*="Submit" i]',
      'button[aria-label*="Continue" i]',
      'button[aria-label*="Next" i]',
      'button[aria-label*="Review" i]',
      'button[aria-label*="Save" i]',
      'button[aria-label*="Update" i]',
      'button[data-control-name*="submit" i]',
      'button[data-control-name*="continue" i]',
      'button[data-control-name*="next" i]',
      'button[data-control-name*="review" i]',
      '[data-testid*="submit" i]',
      '[data-testid*="continue" i]',
      '[data-testid*="next" i]',
      '[data-testid*="review" i]',
    ].join(', ');

    // Broader matchers with no reliable intent signal on their own — only fire
    // capture when the element's own label text also passes isSubmitText().
    // Every entry is scoped to an interactive control: a bare class-substring
    // match walks up the composed path into layout ancestors (e.g. a review
    // panel whose textContent contains "Review your application"), which would
    // stash a snapshot and run a full extraction on any stray click inside it.
    const INTERACTIVE_TAGS = ['button', 'input', 'a[role="button"]', '[role="button"]'];
    const BROAD_BUTTON_SELECTOR = [
      'a[role="button"]',
      ...['submit', 'continue', 'next', 'review'].flatMap((word) =>
        INTERACTIVE_TAGS.map((tag) => `${tag}[class*="${word}" i]`),
      ),
    ].join(', ');

    const isSubmitText = (raw: string): boolean => {
      const t = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      if (/^(submit|continue|next|update|save|save and continue|review|done|next step|submit application|review application)$/.test(t)) return true;
      // Contains-match with a step indicator ("Continue to next step", "Review →").
      return /(^|\s)(continue|review|next|submit|save|update)(\s|$|\(|•|→|›|:)/.test(t);
    };

    // The control's own label: aria-label, then its value (inputs have no
    // textContent), then its text. Never an ancestor's subtree text.
    const controlLabelText = (el: Element): string => {
      const aria = el.getAttribute?.('aria-label');
      if (aria) return aria;
      const value = (el as HTMLInputElement).value;
      if (el.tagName === 'INPUT' && value) return value;
      return el.textContent ?? '';
    };

    // Take the eager pre-navigation snapshot once per user action.
    const stashSnapshotIfAny = () => {
      if (pendingCaptureSnapshot) return;
      const snap = captureSnapshotNow();
      if (snap) pendingCaptureSnapshot = snap;
    };

    // LinkedIn renders the Easy Apply form behind #interop-outlet's open shadow
    // root; at a document-level listener e.target is retargeted to the shadow
    // host, so closest() never sees the real button. Walk composedPath() instead
    // to reach across the shadow boundary.
    const findInComposedPath = (e: Event, selector: string): Element | null => {
      const path = e.composedPath?.() ?? [];
      for (const node of path) {
        const el = node as Element;
        if (el && typeof el.matches === 'function') {
          try {
            if (el.matches(selector)) return el;
          } catch {
            // invalid selector — skip
          }
        }
      }
      return null;
    };

    const onClickCapture = (e: Event) => {
      const submitEl = findInComposedPath(e, BUTTON_SELECTOR);
      if (submitEl) {
        stashSnapshotIfAny();
        scheduleCapture('click-submit', 300);
        return;
      }
      // Broad matchers (a[role=button], generic submit/continue/next/review
      // class substrings) have no reliable intent on their own — require the
      // element's visible text to also look like a submission action.
      const broadEl = findInComposedPath(e, BROAD_BUTTON_SELECTOR);
      if (broadEl && isSubmitText(controlLabelText(broadEl))) {
        stashSnapshotIfAny();
        scheduleCapture('click-submit', 300);
        return;
      }
      // textContent fallback for ATS-specific labels (Update, Save, Review, etc.)
      const btn = findInComposedPath(e, 'button, input[type="submit"], a[role="button"]');
      if (btn && isSubmitText(controlLabelText(btn))) {
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

    try {
      (window as unknown as { __JOBIBI_CAPTURE_NOW__?: () => void }).__JOBIBI_CAPTURE_NOW__ = () => performCapture('manual');
    } catch {}

    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (typeof message === 'object' && message !== null) {
        const t = (message as { type?: string }).type;
        if (t === 'JOBIBI_REQUEST_QUESTIONS') {
          if (!lastResult || lastResult.questions.length === 0) lastResult = extractLinkedInQuestions(document);
          sendResponse({ type: 'JOBIBI_QUESTIONS', payload: lastResult });
          return true;
        }
        if (t === 'JOBIBI_DRAFT_UPDATE') {
          const payload = (message as { payload?: { id?: string; draftText?: string | null; drafts?: Record<string, string | null> } }).payload;
          const snapshotSuggestionMapping = (id: string) => {
            if (!lastResult) lastResult = extractLinkedInQuestions(document);
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
            if (!lastResult) lastResult = extractLinkedInQuestions(document);
            const q = lastResult.questions.find((qq) => qq.id === id);
            if (q) suggestionMappingById.set(id, q);
          };

          let el: Element | null = null;
          let conf: number | undefined = payload.confidence;
          if (payload.questionId) {
            if (!lastResult) lastResult = extractLinkedInQuestions(document);
            const q = lastResult.questions.find((qq) => qq.id === payload.questionId);
            if (q) {
              if (conf === undefined) conf = q.confidence;
              el = getFieldElement(q);
            }
          }
          if (!el && payload.selector) {
            el = queryAcross(payload.selector);
          }
          if (!el && payload.fieldId) {
            for (const r of getShadowRoots()) {
              try {
                const byId = (r as unknown as Document).getElementById?.(payload.fieldId);
                if (byId) {
                  el = byId as unknown as Element;
                  break;
                }
                const byIdQ = (r as unknown as Document).querySelector?.(`#${payload.fieldId.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)}`);
                if (byIdQ) {
                  el = byIdQ;
                  break;
                }
              } catch {}
            }
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
