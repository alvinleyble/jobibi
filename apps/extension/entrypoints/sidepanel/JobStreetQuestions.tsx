import { useEffect, useState, useRef, useCallback } from 'react';
import type { ExtractionResult, ExtractedQuestion } from '@jobibi/shared';
import { SuggestCard } from './SuggestCard';
import { supabase } from './supabase';

function confidenceLabel(c: number): string {
  if (c >= 0.95) return 'high';
  if (c >= 0.75) return 'medium';
  if (c >= 0.5) return 'low';
  return 'unknown';
}

function confidenceClass(c: number): string {
  if (c >= 0.95) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (c >= 0.75) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function QuestionRow({
  q,
  jobContext,
  onDraftAvailable,
  isBetaTester,
}: {
  q: ExtractedQuestion;
  jobContext: ExtractionResult['jobContext'];
  onDraftAvailable: (id: string, draft: string | null) => void;
  isBetaTester?: boolean;
}) {
  return (
    <li className="flex flex-col gap-1 rounded border border-slate-200 p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-800">{q.label}</span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${confidenceClass(q.confidence)}`}
          title={`Mapping via ${q.labelSource} — selector ${q.field.selector}`}
        >
          {confidenceLabel(q.confidence)} · {q.confidence.toFixed(2)}
        </span>
      </div>

      {q.context && q.context !== q.label ? (
        <span className="text-[10px] italic text-slate-400">Context: {q.context}</span>
      ) : null}
      <SuggestCard q={q} jobContext={jobContext} onDraftAvailable={onDraftAvailable} isBetaTester={isBetaTester} />
    </li>
  );
}

function isValidWebTab(t: { url?: string }): boolean {
  if (!t.url) return false;
  return (
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('about:') &&
    !t.url.startsWith('edge://') &&
    !t.url.startsWith('devtools://')
  );
}

async function getTargetTab() {
  try {
    const currentTabs = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const validCurrent = currentTabs.find(isValidWebTab);
    if (validCurrent) return validCurrent;

    const allActiveTabs = await browser.tabs.query({ active: true }).catch(() => []);
    const validActive = allActiveTabs.find(isValidWebTab);
    if (validActive) return validActive;

    const allTabs = await browser.tabs.query({}).catch(() => []);
    const validTabs = allTabs.filter(isValidWebTab);
    const supportedTab = validTabs.find((t) => /jobstreet|seek|jobsdb|linkedin|indeed/i.test(t.url ?? ''));
    if (supportedTab) return supportedTab;

    return validTabs[0] || currentTabs[0];
  } catch {
    return undefined;
  }
}

export default function JobStreetQuestions({ isBetaTester = false }: { isBetaTester?: boolean }) {
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const resultRef = useRef<ExtractionResult | null>(null);
  const [noListenerYet, setNoListenerYet] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const draftMapRef = useRef<Map<string, string>>(new Map());

  const updateResult = (res: ExtractionResult | null) => {
    resultRef.current = res;
    setResult(res);
  };

  const handleDraftAvailable = useCallback((id: string, draft: string | null) => {
    if (draft) {
      draftMapRef.current.set(id, draft);
    } else {
      draftMapRef.current.delete(id);
    }
    // propagate to content script for capture origin diff (D13/D16)
    // find active tab and send
    (async () => {
      try {
        const tab = await getTargetTab();
        const tabId = tab?.id;
        if (tabId != null) {
          await browser.tabs
            .sendMessage(tabId, {
              type: 'JOBIBI_DRAFT_UPDATE',
              payload: { id, draftText: draft },
            })
            .catch(() => {});
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (typeof message === 'object' && message !== null) {
        const t = (message as { type?: string }).type;
        if (t === 'JOBIBI_QUESTIONS') {
          const payload = (message as { payload: ExtractionResult }).payload;
          updateResult(payload);
          setNoListenerYet(false);
        } else if (t === 'JOBIBI_EXTRACTION_FAILURE') {
          const payload = (message as { payload: { adapter: string; host: string; url: string; detected_fields: number; extracted_questions: number; failure_reason: string } }).payload;
          // S7 extraction-failure telemetry: write under caller's JWT (mirrors gate_decisions pattern)
          void (async () => {
            try {
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (!user) return;
              const urlHash = payload.url ? btoa(payload.url).slice(0, 32) : null;
              await supabase.from('extraction_failures').insert({
                user_id: user.id,
                adapter: payload.adapter,
                host: payload.host,
                url: payload.url,
                url_hash: urlHash,
                detected_fields: payload.detected_fields,
                extracted_questions: payload.extracted_questions,
                failure_reason: payload.failure_reason,
              });
            } catch {
              // telemetry best-effort; ignore
            }
          })();
        } else if (t === 'JOBIBI_CAPTURE') {
          const payload = (message as { payload: {
            answers: Array<{ questionLabel: string; answerText: string; draftText: string | null; fieldSelector: string; fieldId: string; mappingVerified: boolean; mismatchReason?: string }>;
            mismatches: Array<{ questionLabel: string; reason: string }>;
            jobContext: ExtractionResult['jobContext'];
            url?: string;
            host?: string;
          }}).payload;
          // enrich draftText from our map if content script didn't have it (race)
          const enrichedAnswers = payload.answers.map((a) => {
            // try to find id by label lookup in current result
            const qMatch = resultRef.current?.questions.find((q) => q.label === a.questionLabel);
            if (qMatch && !a.draftText) {
              const fromMap = draftMapRef.current.get(qMatch.id);
              if (fromMap) return { ...a, draftText: fromMap };
            }
            return a;
          });
          void (async () => {
            try {
              const { data, error } = await supabase.functions.invoke('capture', {
                body: {
                  application: {
                    company: payload.jobContext?.company,
                    roleTitle: payload.jobContext?.roleTitle,
                    site: payload.host,
                    url: payload.url,
                    urlHash: payload.url ? btoa(payload.url).slice(0, 32) : undefined,
                  },
                  jobContext: {
                    role: payload.jobContext?.roleTitle,
                    company: payload.jobContext?.company,
                    url: payload.url,
                  },
                  answers: enrichedAnswers.map((a) => ({
                    questionLabel: a.questionLabel,
                    answerText: a.answerText,
                    draftText: a.draftText ?? null,
                    fieldSelector: a.fieldSelector,
                    fieldId: a.fieldId,
                    mappingVerified: a.mappingVerified,
                    mismatchReason: a.mismatchReason,
                  })),
                  mismatches: payload.mismatches,
                },
              });
              if (error) {
                type CaptureErrorBody = { message?: string; error?: unknown; droppedSensitive?: number };
                let body: CaptureErrorBody | null = null;
                try {
                  const ctx = (error as unknown as { context?: { json: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } } }).context;
                  if (ctx?.json) {
                    try {
                      body = (await ctx.json()) as CaptureErrorBody | null;
                    } catch {
                      try {
                        body = (await ctx.clone?.()?.json()) as CaptureErrorBody | null;
                      } catch {}
                    }
                  }
                } catch {}
                const bodyError = body?.error;
                const raw = body?.message ?? (typeof bodyError === 'string' ? bodyError : null);
                const msg = raw ?? (error as unknown as { message?: string }).message ?? String(error);
                if (body?.droppedSensitive) {
                  setCaptureMsg(`Capture failed: ${msg} · ${body.droppedSensitive} not saved — please retry.`);
                } else {
                  setCaptureMsg(`Capture failed: ${msg}`);
                }
                setTimeout(() => setCaptureMsg(null), 4000);
              } else if (data) {
                const inserted = (data as { inserted?: number }).inserted ?? 0;
                const dropped = (data as { droppedMismatched?: number }).droppedMismatched ?? 0;
                const droppedSensitive = (data as { droppedSensitive?: number }).droppedSensitive ?? 0;
                const sensitiveRejections = (data as { sensitiveRejections?: Array<{ questionLabel: string; sensitiveKind: string | null }> }).sensitiveRejections ?? [];
                if (inserted || dropped || droppedSensitive) {
                  const parts = [`Capture: ${inserted} saved`];
                  if (dropped) parts.push(`${dropped} mismatched dropped`);
                  if (droppedSensitive) {
                    const kinds = sensitiveRejections.map((r) => r.sensitiveKind).filter(Boolean).join(', ') || 'sensitive';
                    parts.push(`${droppedSensitive} sensitive not saved — confirm via intake/sensitive card (${kinds})`);
                  }
                  setCaptureMsg(parts.join(' · '));
                  setTimeout(() => setCaptureMsg(null), 4000);
                }
              }
            } catch (e) {
              setCaptureMsg(`Capture error: ${String(e)}`);
              setTimeout(() => setCaptureMsg(null), 4000);
            }
          })();
        }
      }
    };
    browser.runtime.onMessage.addListener(onMessage as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

    const requestFromActiveTab = async () => {
      try {
        const tab = await getTargetTab();
        const tabId = tab?.id;
        const url = tab?.url ?? '';
        const isSupportedHost = /jobstreet|seek|jobsdb|linkedin|indeed/i.test(url);
        const isApplyPage = /jobstreet|seek|jobsdb/i.test(url) && /apply/i.test(url);
        const isLinkedIn = /linkedin/i.test(url);
        const isIndeed = /indeed/i.test(url);
        // Dedicated apply pages have strict scoping; LinkedIn/Indeed/generic are broader.
        // For JobStreet we keep the previous apply-only gate; others try immediately.
        if (!isSupportedHost) {
          // Unknown host — try generic fallback
          if (tabId != null) {
            const resp = (await browser.tabs
              .sendMessage(tabId, { type: 'JOBIBI_REQUEST_QUESTIONS' })
              .catch(() => null)) as { payload?: ExtractionResult } | null;
            if (resp?.payload && resp.payload.questions.length > 0) {
              updateResult(resp.payload);
              setNoListenerYet(false);
              return;
            }
          }
          updateResult(null);
          setNoListenerYet(true);
          return;
        }
        if (!isApplyPage && !isLinkedIn && !isIndeed) {
          if (tabId != null) {
            const resp = (await browser.tabs
              .sendMessage(tabId, { type: 'JOBIBI_REQUEST_QUESTIONS' })
              .catch(() => null)) as { payload?: ExtractionResult } | null;
            if (resp?.payload) {
              updateResult(resp.payload);
              setNoListenerYet(false);
              return;
            }
          }
          updateResult(null);
          setNoListenerYet(true);
          return;
        }
        if (tabId == null) {
          updateResult(null);
          setNoListenerYet(true);
          return;
        }
        const resp = (await browser.tabs
          .sendMessage(tabId, { type: 'JOBIBI_REQUEST_QUESTIONS' })
          .catch(() => null)) as { payload?: ExtractionResult } | null;
        if (resp?.payload) {
          updateResult(resp.payload);
          setNoListenerYet(false);
        } else {
          updateResult(null);
          setNoListenerYet(false);
        }
      } catch {
        setNoListenerYet(true);
      }
    };

    // Prime from whatever tab is active now.
    void requestFromActiveTab();

    // Re-query when the user switches tabs or navigates.
    const onActivated = () => {
      void requestFromActiveTab();
    };
    const onUpdated = () => {
      void requestFromActiveTab();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated as Parameters<typeof browser.tabs.onUpdated.addListener>[0]);

    return () => {
      browser.runtime.onMessage.removeListener(onMessage as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated as Parameters<typeof browser.tabs.onUpdated.removeListener>[0]);
    };
  }, []);

  const questions = result?.questions ?? [];
  const isJobStreet = result
    ? /jobstreet|seek|jobsdb/i.test(result.host)
    : noListenerYet === false
      ? false
      : false;

  return (
    <div className="flex w-full max-w-md flex-col gap-2 rounded border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Application questions</h2>
        {result?.jobContext?.roleTitle ? (
          <span className="text-[10px] text-slate-500">
            {result.jobContext.roleTitle}
            {result.jobContext.company ? ` · ${result.jobContext.company}` : ''}
          </span>
        ) : null}
      </div>

      {captureMsg ? <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{captureMsg}</p> : null}

      {questions.length === 0 ? (
        <p className="text-xs text-slate-500">
          {result
            ? `No questions detected on this page${result.host ? ` · ${result.host}` : ''}${result.adapter ? ` (${result.adapter})` : ''}.`
            : noListenerYet
              ? 'Open a supported application (JobStreet, LinkedIn Easy Apply, Indeed) to see its questions here.'
              : 'Waiting for application…'}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            {questions.length} question{questions.length === 1 ? '' : 's'} detected
            {result?.host ? ` · ${result.host}` : ''}
            {result?.adapter ? ` · ${result.adapter}` : ''}
            {result?.jobContext?.jobDescription ? ' · JD captured' : ''}
          </p>
          <ul className="flex flex-col gap-1.5">
            {questions.map((q) => (
              <QuestionRow key={q.id} q={q} jobContext={result?.jobContext ?? {}} onDraftAvailable={handleDraftAvailable} isBetaTester={isBetaTester} />
            ))}
          </ul>
        </>
      )}

      {/* Always show host for debugging, even when not JobStreet */}
      {result?.host && !isJobStreet ? (
        <p className="text-[10px] text-slate-400">Host: {result.host}</p>
      ) : null}
    </div>
  );
}
