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
}: {
  q: ExtractedQuestion;
  jobContext: ExtractionResult['jobContext'];
  onDraftAvailable: (id: string, draft: string | null) => void;
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
      <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
        <span className="rounded bg-slate-100 px-1 py-0.5">{q.fieldType}</span>
        <span className="rounded bg-slate-100 px-1 py-0.5">{q.field.selector}</span>
        <span className="rounded bg-slate-100 px-1 py-0.5">{q.labelSource}</span>
      </div>
      {q.context && q.context !== q.label ? (
        <span className="text-[10px] italic text-slate-400">Context: {q.context}</span>
      ) : null}
      <SuggestCard q={q} jobContext={jobContext} onDraftAvailable={onDraftAvailable} />
    </li>
  );
}

export default function JobStreetQuestions() {
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [noListenerYet, setNoListenerYet] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const draftMapRef = useRef<Map<string, string>>(new Map());

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
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
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
          setResult(payload);
          setNoListenerYet(false);
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
            const qMatch = result?.questions.find((q) => q.label === a.questionLabel);
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
                const msg = (error as unknown as { message?: string }).message ?? String(error);
                setCaptureMsg(`Capture failed: ${msg}`);
                setTimeout(() => setCaptureMsg(null), 4000);
              } else if (data) {
                const inserted = (data as { inserted?: number }).inserted ?? 0;
                const dropped = (data as { droppedMismatched?: number }).droppedMismatched ?? 0;
                if (inserted || dropped) {
                  setCaptureMsg(`Capture: ${inserted} saved${dropped ? `, ${dropped} mismatched dropped` : ''}`);
                  setTimeout(() => setCaptureMsg(null), 3000);
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
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        const tabId = tab?.id;
        const url = tab?.url ?? '';
        const isApplyPage = /jobstreet|seek|jobsdb/i.test(url) && /apply/i.test(url);
        // Non-apply pages (e.g. homepage) have no content script — clear immediately
        // instead of showing stale questions from the previous tab.
        if (!isApplyPage) {
          // Still try to ask — if a generic S7 adapter is present it may answer —
          // but clear on no response.
          if (tabId != null) {
            const resp = (await browser.tabs
              .sendMessage(tabId, { type: 'JOBIBI_REQUEST_QUESTIONS' })
              .catch(() => null)) as { payload?: ExtractionResult } | null;
            if (resp?.payload) {
              setResult(resp.payload);
              setNoListenerYet(false);
              return;
            }
          }
          setResult(null);
          setNoListenerYet(true);
          return;
        }
        if (tabId == null) {
          setResult(null);
          setNoListenerYet(true);
          return;
        }
        const resp = (await browser.tabs
          .sendMessage(tabId, { type: 'JOBIBI_REQUEST_QUESTIONS' })
          .catch(() => null)) as { payload?: ExtractionResult } | null;
        if (resp?.payload) {
          setResult(resp.payload);
          setNoListenerYet(false);
        } else {
          setResult(null);
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
    const onUpdated = (
      _tabId: number,
      changeInfo: { status?: string },
      tab: { active?: boolean },
    ) => {
      if (tab.active && changeInfo.status === 'complete') {
        void requestFromActiveTab();
      }
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated as Parameters<typeof browser.tabs.onUpdated.addListener>[0]);

    return () => {
      browser.runtime.onMessage.removeListener(onMessage as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated as Parameters<typeof browser.tabs.onUpdated.addListener>[0]);
    };
  }, [result]);

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
            ? 'No questions detected on this page.'
            : noListenerYet
              ? 'Open a JobStreet application to see its questions here.'
              : 'Waiting for JobStreet…'}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            {questions.length} question{questions.length === 1 ? '' : 's'} detected
            {result?.host ? ` · ${result.host}` : ''}
          </p>
          <ul className="flex flex-col gap-1.5">
            {questions.map((q) => (
              <QuestionRow key={q.id} q={q} jobContext={result?.jobContext ?? {}} onDraftAvailable={handleDraftAvailable} />
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
