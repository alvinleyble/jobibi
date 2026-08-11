import { useEffect, useState } from 'react';
import type { ExtractionResult, ExtractedQuestion } from '@jobibi/shared';

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

function QuestionRow({ q }: { q: ExtractedQuestion }) {
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
    </li>
  );
}

export default function JobStreetQuestions() {
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [noListenerYet, setNoListenerYet] = useState(false);

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'JOBIBI_QUESTIONS'
      ) {
        const payload = (message as { payload: ExtractionResult }).payload;
        setResult(payload);
        setNoListenerYet(false);
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
              <QuestionRow key={q.id} q={q} />
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
