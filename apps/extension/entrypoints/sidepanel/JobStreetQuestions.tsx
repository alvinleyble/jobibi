import { useEffect, useState, useRef, useCallback } from 'react';
import type { ExtractionResult } from '@jobibi/shared';
import { SuggestCard } from './SuggestCard';
import { supabase } from './supabase';
import { humanizeErrorMessage } from './ingestError';

function getMatchDotClass(confidence: number): string {
  if (confidence >= 0.95) return 'bg-success';
  if (confidence >= 0.75) return 'bg-warn';
  return 'bg-danger';
}

function getMatchDotTitle(confidence: number): string {
  if (confidence >= 0.95) return 'High match quality';
  if (confidence >= 0.75) return 'Medium match quality';
  return 'Low match quality';
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
          const enrichedAnswers = payload.answers.map((a) => {
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
                const rawMsg = raw ?? (error as unknown as { message?: string }).message ?? String(error);
                const friendlyMsg = humanizeErrorMessage(rawMsg);
                if (body?.droppedSensitive) {
                  setCaptureMsg(`Some answers were not saved because they contain sensitive details (${body.droppedSensitive} item${body.droppedSensitive === 1 ? '' : 's'}). Please confirm them in your sensitive fields.`);
                } else {
                  setCaptureMsg(`Could not save application answers: ${friendlyMsg}`);
                }
                setTimeout(() => setCaptureMsg(null), 4000);
              } else if (data) {
                const inserted = (data as { inserted?: number }).inserted ?? 0;
                const dropped = (data as { droppedMismatched?: number }).droppedMismatched ?? 0;
                const droppedSensitive = (data as { droppedSensitive?: number }).droppedSensitive ?? 0;
                const sensitiveRejections = (data as { sensitiveRejections?: Array<{ questionLabel: string; sensitiveKind: string | null }> }).sensitiveRejections ?? [];
                if (inserted || dropped || droppedSensitive) {
                  const parts = [`Saved ${inserted} answer${inserted === 1 ? '' : 's'} to memory`];
                  if (dropped) parts.push(`${dropped} mismatched skipped`);
                  if (droppedSensitive) {
                    const kinds = sensitiveRejections.map((r) => r.sensitiveKind).filter(Boolean).join(', ') || 'sensitive';
                    parts.push(`${droppedSensitive} sensitive not saved — confirm via intake/sensitive card (${kinds})`);
                  }
                  setCaptureMsg(parts.join(' · '));
                  setTimeout(() => setCaptureMsg(null), 4000);
                }
              }
            } catch (e) {
              setCaptureMsg('We could not save your application answers. Please check your connection.');
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
        if (!isSupportedHost) {
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

    void requestFromActiveTab();

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

  return (
    <div data-screen-label="Suggest" className="flex flex-col gap-3">
      {/* Pinned Job-Context Banner */}
      {result?.jobContext?.roleTitle || result?.jobContext?.company ? (
        <div className="flex items-center gap-1.5 rounded-[10px] border border-accent-tint-border bg-accent-tint px-3.5 py-2.5 text-[12.5px]">
          <span className="font-bold text-accent">
            {result.jobContext.roleTitle || 'Job Application'}
          </span>
          {result.jobContext.company ? (
            <span className="text-ink-secondary">· {result.jobContext.company}</span>
          ) : null}
        </div>
      ) : null}

      {/* Capture Toast Banner */}
      {captureMsg ? (
        <div className="rounded-lg border border-success-tint-border bg-success-tint px-3 py-2 text-xs font-medium text-success">
          {captureMsg}
        </div>
      ) : null}

      {/* Questions list or empty state */}
      {questions.length === 0 ? (
        <div className="rounded-[10px] border border-card-border bg-card p-4 text-center">
          <p className="text-xs text-ink-muted leading-relaxed">
            {result
              ? `No questions detected on this page${result.host ? ` · ${result.host}` : ''}.`
              : noListenerYet
                ? 'Open a supported application (JobStreet, LinkedIn Easy Apply, Indeed) to see its questions here.'
                : 'Waiting for application…'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {questions.map((q) => (
            <div
              key={q.id}
              data-testid="question-card"
              data-question-label={q.label}
              className="flex flex-col gap-2 rounded-[10px] border border-card-border bg-card p-3.5 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[14.5px] font-bold text-ink leading-[1.35]">{q.label}</span>
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${getMatchDotClass(q.confidence)}`}
                  title={getMatchDotTitle(q.confidence)}
                  data-testid={`match-dot-${q.id}`}
                />
              </div>
              {q.context && q.context !== q.label ? (
                <span className="text-[11px] italic text-ink-muted">Context: {q.context}</span>
              ) : null}
              <SuggestCard
                q={q}
                jobContext={result?.jobContext ?? {}}
                onDraftAvailable={handleDraftAvailable}
                isBetaTester={isBetaTester}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
