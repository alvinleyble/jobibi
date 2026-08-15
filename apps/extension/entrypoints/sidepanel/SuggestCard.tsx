import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { AUTOFILL_CONFIDENCE_THRESHOLD, isVideoQuestion } from '@jobibi/shared';
import type { ExtractedQuestion, ExtractionResult } from '@jobibi/shared';
import { humanizeErrorMessage } from './ingestError';

interface SuggestState {
  outcome?: 'draft' | 'ask' | 'refuse' | 'confirm';
  answer?: string;
  skeleton?: string[];
  sources?: { kind: string; label: string; ref: string }[];
  refuseMessage?: string;
  gapQuestion?: string;
  anchoredChunkId?: string | null;
  anchoredChunkText?: string;
  questionMatch?: number;
  roleMatch?: number;
  sensitiveKind?: string;
  sensitiveFact?: { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; provenanceLine: string } | null;
  sensitiveVia?: 'rule' | 'retrieval' | 'both' | null;
  seenBefore?: {
    answerText: string;
    questionLabel: string;
    origin: string;
    sourceLabel: string;
    similarity: number;
    defaultIsPrior: boolean;
    priorCompany?: string | null;
    priorRole?: string | null;
  } | null;
  isVideo?: boolean;
  videoTalkingPoints?: string[];
  videoScript?: string;
  error?: string;
  loading?: boolean;
}

function getErrorMessage(err: unknown): string {
  return humanizeErrorMessage(err instanceof Error ? err.message : String(err));
}

type SuggestErrorBody = {
  error?: unknown;
  code?: string;
  message?: string;
  sensitiveKind?: string;
  sensitiveVia?: string;
  sensitiveFact?: { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; provenanceLine: string } | null;
};

async function readSuggestErrorBody(err: unknown): Promise<SuggestErrorBody | null> {
  if (err && typeof err === 'object' && 'context' in err) {
    const ctx = (err as { context?: { json: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } } }).context;
    if (ctx?.json) {
      try {
        return (await ctx.json()) as SuggestErrorBody;
      } catch {
        try {
          return (await ctx.clone?.()?.json()) as SuggestErrorBody;
        } catch {}
      }
    }
  }
  return null;
}

function messageFromSuggestErrorBody(body: SuggestErrorBody | null, err: unknown): string {
  if (body?.message && typeof body.message === 'string') return humanizeErrorMessage(body.message);
  if (body?.error) {
    return typeof body.error === 'string'
      ? humanizeErrorMessage(body.error)
      : 'Something went wrong. Please try again.';
  }
  return getErrorMessage(err);
}

async function extractSuggestError(err: unknown): Promise<string> {
  return messageFromSuggestErrorBody(await readSuggestErrorBody(err), err);
}

export function SuggestCard({
  q,
  jobContext,
  onDraftAvailable,
  isBetaTester = false,
}: {
  q: ExtractedQuestion;
  jobContext: ExtractionResult['jobContext'];
  onDraftAvailable?: (questionId: string, draftText: string | null) => void;
  isBetaTester?: boolean;
}) {
  const [state, setState] = useState<SuggestState>({});
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [gapInput, setGapInput] = useState('');
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);

  // S7A manual input on refuse (cold raw-text, user-written)
  const [manualInput, setManualInput] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);

  // S11 beta auto-fill
  const [inserting, setInserting] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [lockedProNotice, setLockedProNotice] = useState<string | null>(null);

  // Sensitive confirm / update state
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmDone, setConfirmDone] = useState<string | null>(null);
  const [updateValue, setUpdateValue] = useState('');
  const [showUpdate, setShowUpdate] = useState(false);

  // Notify parent (JobStreetQuestions) when a draft is available for capture mapping (D13)
  useEffect(() => {
    if (state.outcome === 'draft' && state.answer && onDraftAvailable) {
      onDraftAvailable(q.id, state.answer);
    } else if ((state.outcome === 'refuse' || state.outcome === 'ask' || !state.outcome) && onDraftAvailable) {
      onDraftAvailable(q.id, null);
    }
  }, [state.outcome, state.answer, q.id, onDraftAvailable]);

  const onSuggest = async () => {
    setState({ loading: true });
    setGapError(null);
    setGapInput('');
    setManualInput('');
    setManualError(null);
    setManualSuccess(null);
    setConfirmError(null);
    setConfirmDone(null);
    setShowUpdate(false);
    setInsertError(null);
    setInserted(false);
    setLockedProNotice(null);
    try {
      const { data, error } = await supabase.functions.invoke('suggest', {
        body: {
          question: q.label,
          jobContext: {
            role: jobContext.roleTitle ?? 'Unknown role',
            company: jobContext.company ?? 'Unknown company',
          },
        },
      });
      if (error) {
        const msg = await extractSuggestError(error);
        setState({ error: msg });
        return;
      }
      setState({
        outcome: data.outcome,
        answer: data.answer,
        skeleton: data.skeleton,
        sources: data.sources,
        refuseMessage: data.refuseMessage,
        gapQuestion: data.gapQuestion,
        anchoredChunkId: data.anchoredChunkId ?? null,
        anchoredChunkText: data.anchoredChunkText,
        questionMatch: data.questionMatch,
        roleMatch: data.roleMatch,
        sensitiveKind: data.sensitiveKind,
        sensitiveFact: data.sensitiveFact ?? null,
        sensitiveVia: data.sensitiveVia ?? null,
        seenBefore: data.seenBefore ?? null,
        isVideo: data.isVideo,
        videoTalkingPoints: data.videoTalkingPoints,
        videoScript: data.videoScript,
      });
      if (data.outcome === 'draft' && data.answer && onDraftAvailable) {
        onDraftAvailable(q.id, data.answer as string);
      } else if (onDraftAvailable) {
        onDraftAvailable(q.id, null);
      }
    } catch (e) {
      setState({ error: getErrorMessage(e) });
    }
  };

  function tryHandleSensitiveRejection(body: SuggestErrorBody | null): boolean {
    if (body?.code === 'sensitive_rejected') {
      setState((prev) => ({
        ...prev,
        outcome: 'confirm',
        sensitiveKind: body.sensitiveKind ?? undefined,
        sensitiveFact: body.sensitiveFact ?? null,
        sensitiveVia: (body.sensitiveVia as 'rule' | 'retrieval' | 'both' | null) ?? null,
      }));
      return true;
    }
    return false;
  }

  const onSubmitGap = async () => {
    const trimmed = gapInput.trim();
    if (!trimmed) {
      setGapError('Please write a short answer to help Jobibi draft a response.');
      return;
    }
    if (trimmed.length < 3) {
      setGapError('Your answer is a bit too short. Please provide a little more detail.');
      return;
    }
    setGapLoading(true);
    setGapError(null);
    try {
      const { data, error } = await supabase.functions.invoke('gap-answer', {
        body: {
          originalQuestion: q.label,
          gapQuestion: state.gapQuestion,
          answer: trimmed,
          jobContext: {
            role: jobContext.roleTitle ?? 'Unknown role',
            company: jobContext.company ?? 'Unknown company',
          },
          anchoredChunkId: state.anchoredChunkId ?? null,
        },
      });
      if (error) {
        const body = await readSuggestErrorBody(error);
        if (tryHandleSensitiveRejection(body)) {
          setGapLoading(false);
          return;
        }
        const msg = messageFromSuggestErrorBody(body, error);
        setGapError(msg);
        setGapLoading(false);
        return;
      }
      setState((prev) => ({
        ...prev,
        outcome: 'draft',
        answer: data.answer,
        skeleton: data.skeleton,
        sources: data.sources,
        questionMatch: prev.questionMatch,
        roleMatch: prev.roleMatch,
        error: undefined,
      }));
      if (onDraftAvailable && data.answer) onDraftAvailable(q.id, data.answer as string);
      setGapInput('');
    } catch (e) {
      setGapError(getErrorMessage(e));
    } finally {
      setGapLoading(false);
    }
  };

  const onConfirm = async () => {
    if (!state.sensitiveKind) return;
    setConfirmLoading(true);
    setConfirmError(null);
    setConfirmDone(null);
    try {
      const { data, error } = await supabase.functions.invoke('sensitive-confirm', {
        body: { kind: state.sensitiveKind, action: 'confirm', factId: state.sensitiveFact?.id },
      });
      if (error) {
        const msg = await extractSuggestError(error);
        setConfirmError(msg);
        setConfirmLoading(false);
        return;
      }
      setConfirmDone('Confirmed — updated timestamp.');
      if (data?.value) {
        setState((prev) => ({
          ...prev,
          sensitiveFact: prev.sensitiveFact
            ? { ...prev.sensitiveFact, value: data.value as string, confirmed_at: (data.confirmed_at as string) ?? new Date().toISOString() }
            : prev.sensitiveFact,
        }));
      }
    } catch (e) {
      setConfirmError(getErrorMessage(e));
    } finally {
      setConfirmLoading(false);
    }
  };

  const onUpdate = async () => {
    const trimmed = updateValue.trim();
    if (!trimmed) {
      setConfirmError('Please enter a value before saving.');
      return;
    }
    if (!state.sensitiveKind) {
      setConfirmError("We couldn't verify this field right now. Please try clicking Suggest again.");
      return;
    }
    setConfirmLoading(true);
    setConfirmError(null);
    setConfirmDone(null);
    try {
      const { data, error } = await supabase.functions.invoke('sensitive-confirm', {
        body: { kind: state.sensitiveKind, action: 'update', value: trimmed },
      });
      if (error) {
        const msg = await extractSuggestError(error);
        setConfirmError(msg);
        setConfirmLoading(false);
        return;
      }
      setConfirmDone(`Updated to "${trimmed}".`);
      setState((prev) => ({
        ...prev,
        sensitiveFact: prev.sensitiveFact
          ? { ...prev.sensitiveFact, value: trimmed, stated_at: (data.stated_at as string) ?? new Date().toISOString(), confirmed_at: null }
          : { id: (data.id as string) ?? 'new', kind: state.sensitiveKind!, value: trimmed, stated_at: (data.stated_at as string) ?? new Date().toISOString(), confirmed_at: null, provenanceLine: `You said ${trimmed} — still true?` },
      }));
      setUpdateValue('');
      setShowUpdate(false);
    } catch (e) {
      setConfirmError(getErrorMessage(e));
    } finally {
      setConfirmLoading(false);
    }
  };

  const onManualSubmit = async () => {
    const trimmed = manualInput.trim();
    if (!trimmed) {
      setManualError('Please write an answer before saving to memory.');
      return;
    }
    if (trimmed.length < 3) {
      setManualError('Your answer is a bit too short. Please provide a little more detail.');
      return;
    }
    setManualLoading(true);
    setManualError(null);
    setManualSuccess(null);
    try {
      const { data, error } = await supabase.functions.invoke('manual-input', {
        body: {
          questionLabel: q.label,
          answerText: trimmed,
          jobContext: {
            role: jobContext.roleTitle ?? 'Unknown role',
            company: jobContext.company ?? 'Unknown company',
          },
        },
      });
      if (error) {
        const body = await readSuggestErrorBody(error);
        if (tryHandleSensitiveRejection(body)) {
          setManualLoading(false);
          return;
        }
        const msg = messageFromSuggestErrorBody(body, error);
        setManualError(msg);
        setManualLoading(false);
        return;
      }
      setManualSuccess('Saved to your memory bank.');
      setManualInput('');
      void data;
    } catch (e) {
      setManualError(getErrorMessage(e));
    } finally {
      setManualLoading(false);
    }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const handleLockedInsertClick = () => {
    setLockedProNotice('1-Click Auto-Fill is a Pro feature (Included in Beta). Upgrade to insert answers directly.');
    setTimeout(() => setLockedProNotice(null), 4000);
  };

  const onInsert = async (text: string) => {
    if (!text || inserting) return;
    setInserting(true);
    setInsertError(null);
    try {
      const currentTabs = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const validCurrent = currentTabs.find((t) => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('about:') && !t.url.startsWith('chrome://'));
      const allActiveTabs = await browser.tabs.query({ active: true }).catch(() => []);
      const validActive = allActiveTabs.find((t) => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('about:') && !t.url.startsWith('chrome://'));
      const allTabs = await browser.tabs.query({}).catch(() => []);
      const validTabs = allTabs.filter((t) => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('about:') && !t.url.startsWith('chrome://'));
      const targetTab = validCurrent || validActive || validTabs.find((t) => /jobstreet|seek|jobsdb|linkedin|indeed/i.test(t.url ?? '')) || validTabs[0] || currentTabs[0];
      const tabId = targetTab?.id;
      if (tabId == null) {
        setInsertError('Could not find an active job application tab. Please make sure the job application page is open and try again.');
        setInserting(false);
        return;
      }
      const response = (await browser.tabs
        .sendMessage(tabId, {
          type: 'JOBIBI_INSERT_FIELD',
          payload: {
            questionId: q.id,
            text,
            selector: q.field.selector,
            fieldId: q.field.id,
            confidence: q.confidence,
          },
        })
        .catch((e) => ({
          ok: false,
          error: e instanceof Error ? humanizeErrorMessage(e.message) : 'Could not communicate with the application page. Please refresh the page and try again.',
        }))) as { ok?: boolean; error?: string } | null;

      if (response?.ok) {
        setInserted(true);
        if (onDraftAvailable) {
          onDraftAvailable(q.id, text);
        }
        setTimeout(() => {
          setInserted(false);
        }, 2500);
      } else {
        setInsertError(response?.error ? humanizeErrorMessage(response.error) : 'Could not insert into the form field. You can copy and paste your answer manually.');
        setTimeout(() => {
          setInsertError(null);
        }, 4000);
      }
    } catch (e) {
      setInsertError(humanizeErrorMessage(e instanceof Error ? e.message : String(e)));
      setTimeout(() => {
        setInsertError(null);
      }, 4000);
    } finally {
      setInserting(false);
    }
  };

  const seen = state.seenBefore;

  return (
    <div className="mt-1 flex flex-col gap-2">
      {/* Primary Suggest / Regenerate Button */}
      {!state.outcome && !state.loading ? (
        <button
          type="button"
          onClick={onSuggest}
          disabled={state.loading || gapLoading}
          data-testid="suggest-btn"
          className="self-start rounded-lg bg-accent px-3.5 py-[9px] text-[13.5px] font-bold text-on-accent hover:opacity-90 transition-opacity"
        >
          Suggest an answer
        </button>
      ) : state.loading ? (
        <button
          type="button"
          disabled
          data-testid="suggest-btn"
          className="self-start rounded-lg bg-loading-bg px-3.5 py-[9px] text-[13.5px] font-bold text-loading-text cursor-not-allowed"
        >
          Thinking…
        </button>
      ) : (
        <button
          type="button"
          onClick={onSuggest}
          disabled={state.loading || gapLoading}
          data-testid="suggest-btn"
          className="self-start rounded-lg bg-accent px-3.5 py-[9px] text-[13.5px] font-bold text-on-accent hover:opacity-90 transition-opacity"
        >
          Regenerate
        </button>
      )}

      {state.error ? <p className="text-xs text-danger">{state.error}</p> : null}

      {/* S6 Seen-Before Card */}
      {seen ? (
        <div className="rounded-lg border border-accent-tint-border bg-accent-tint/60 p-3 text-left">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-accent">Seen before — {seen.sourceLabel}</p>
            <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink-muted border border-card-border">
              {seen.origin}
            </span>
          </div>
          <p className="mt-1 text-[11px] italic text-ink-muted">Prior: “{seen.questionLabel}”</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-ink">{seen.answerText}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => copy(seen.answerText)}
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-bold text-ink hover:bg-subtle"
            >
              Copy prior answer
            </button>
          </div>
        </div>
      ) : null}

      {/* Outcome: Refuse Card (Amber) */}
      {state.outcome === 'refuse' ? (
        <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-ink">
          <p className="font-bold text-warn">Not enough in your history to draft this.</p>
          <p className="mt-1 text-ink-secondary">{state.refuseMessage}</p>

          {/* S7A manual input on refuse */}
          <div className="mt-2.5 rounded-lg border border-card-border bg-card p-3">
            <p className="text-xs font-bold text-ink">Provide input</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              Your answer will be saved to your memory bank (user-written) and used for future drafts.
            </p>
            <textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Your answer…"
              rows={3}
              className="mt-2 w-full rounded-lg border border-card-border bg-card p-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              disabled={manualLoading}
            />
            {manualError ? <p className="mt-1 text-xs text-danger">{manualError}</p> : null}
            {manualSuccess ? <p className="mt-1 text-xs text-success font-medium">{manualSuccess}</p> : null}
            <button
              type="button"
              onClick={onManualSubmit}
              disabled={manualLoading || !manualInput.trim()}
              className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {manualLoading ? 'Saving…' : 'Save to memory'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Outcome: Ask Card (Follow-up gap question) */}
      {state.outcome === 'ask' ? (
        <div className="rounded-lg border border-accent-tint-border bg-accent-tint p-3 text-xs">
          <p className="font-bold text-accent">One quick follow-up — then I’ll draft</p>
          <p className="mt-1 text-ink">{state.gapQuestion}</p>
          {state.anchoredChunkText ? (
            <p className="mt-1 text-[11px] italic text-ink-muted" title={state.anchoredChunkText}>
              Anchored to: “{state.anchoredChunkText.slice(0, 100)}…”
            </p>
          ) : null}
          <textarea
            value={gapInput}
            onChange={(e) => setGapInput(e.target.value)}
            placeholder="Your short answer…"
            rows={3}
            className="mt-2 w-full rounded-lg border border-card-border bg-card p-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            disabled={gapLoading}
          />
          {gapError ? <p className="mt-1 text-xs text-danger">{gapError}</p> : null}
          <button
            type="button"
            onClick={onSubmitGap}
            disabled={gapLoading || !gapInput.trim()}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {gapLoading ? 'Saving…' : 'Submit & draft'}
          </button>
          <p className="mt-1.5 text-[10.5px] text-ink-muted">
            Your answer is saved to your memory bank and used immediately.
          </p>
        </div>
      ) : null}

      {/* Outcome: Confirm Card (Always-confirm sensitive field, Violet) */}
      {state.outcome === 'confirm' ? (
        <div className="rounded-lg border border-info-tint-border bg-info-tint p-3 text-left">
          <p className="text-[12px] font-bold text-info">Always-confirm — sensitive field</p>
          {state.sensitiveFact ? (
            <>
              <p className="mt-1.5 text-[15px] font-extrabold text-ink">{state.sensitiveFact.value}</p>
              <p className="mt-1 text-[12.5px] italic text-ink-secondary">{state.sensitiveFact.provenanceLine}</p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={confirmLoading}
                  className="rounded-lg bg-info px-3 py-2 text-[13px] font-bold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {confirmLoading ? 'Saving…' : 'Confirm still true'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpdate((v) => !v)}
                  disabled={confirmLoading}
                  className="rounded-lg border-[1.5px] border-info-tint-border bg-card px-3 py-2 text-[13px] font-bold text-ink hover:bg-subtle disabled:opacity-50 transition-colors"
                >
                  Update
                </button>
              </div>
              {showUpdate ? (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  <input
                    type="text"
                    value={updateValue}
                    onChange={(e) => setUpdateValue(e.target.value)}
                    placeholder={`New ${state.sensitiveKind} value`}
                    className="rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
                    disabled={confirmLoading}
                  />
                  <button
                    type="button"
                    onClick={onUpdate}
                    disabled={confirmLoading || !updateValue.trim()}
                    className="self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50"
                  >
                    Save update
                  </button>
                </div>
              ) : null}
              {confirmError ? <p className="mt-1 text-xs text-danger">{confirmError}</p> : null}
              {confirmDone ? <p className="mt-1 text-xs text-success font-medium">{confirmDone}</p> : null}
              <p className="mt-2 text-[10.5px] text-ink-muted">This field is never drafted or auto-filled.</p>
            </>
          ) : !state.sensitiveKind ? (
            <>
              <p className="mt-1 text-xs text-ink-secondary">
                This looks like a sensitive question, but we couldn&apos;t verify it just now.
              </p>
              <p className="mt-1 text-xs text-ink-muted">Please try clicking Suggest again.</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-secondary">
                This looks like a sensitive question ({state.sensitiveKind}), but you haven&apos;t set a value for it yet.
              </p>
              <p className="mt-1 text-xs text-ink-muted">Set it in your sensitive facts, then confirm here.</p>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={updateValue}
                  onChange={(e) => setUpdateValue(e.target.value)}
                  placeholder={`New ${state.sensitiveKind} value`}
                  className="rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-xs text-ink"
                  disabled={confirmLoading}
                />
                <button
                  type="button"
                  onClick={onUpdate}
                  disabled={confirmLoading || !updateValue.trim()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              {confirmError ? <p className="mt-1 text-xs text-danger">{confirmError}</p> : null}
              {confirmDone ? <p className="mt-1 text-xs text-success font-medium">{confirmDone}</p> : null}
            </>
          )}
        </div>
      ) : null}

      {/* S12 Dedicated Video Talking Points & Script Card */}
      {state.outcome === 'draft' && (state.isVideo || isVideoQuestion(q.label)) ? (
        <div
          data-testid="video-script-card"
          className="rounded-lg border border-accent-tint-border bg-accent-tint/60 p-3 text-left"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-accent">🎥 Video Talking Points &amp; Script</p>
            <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-bold text-accent border border-accent-tint-border">
              60s Speaking Script
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Structured talking points and speaking script grounded in your history.
          </p>

          {/* Talking points */}
          {((state.videoTalkingPoints?.length ?? 0) > 0 || (state.skeleton?.length ?? 0) > 0) ? (
            <div className="mt-2 rounded-lg border border-card-border bg-card p-2.5">
              <p className="text-xs font-bold text-ink">Key Talking Points</p>
              <ul className="mt-1 list-inside list-disc text-xs text-ink-secondary space-y-0.5">
                {(state.videoTalkingPoints || state.skeleton)!.map((point, idx) => (
                  <li key={idx}>{point}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  copy(
                    (state.videoTalkingPoints || state.skeleton)!
                      .map((p) => `• ${p}`)
                      .join('\n'),
                  )
                }
                data-testid="copy-talking-points-btn"
                className="mt-2 rounded-lg border border-card-border bg-card px-2.5 py-1 text-xs font-bold text-ink hover:bg-subtle"
              >
                Copy talking points
              </button>
            </div>
          ) : null}

          {/* Speaking Script */}
          <div className="mt-2 rounded-lg border border-card-border bg-card p-2.5">
            <p className="text-xs font-bold text-ink">60-Second Speaking Script</p>
            <p className="mt-1 text-xs text-ink whitespace-pre-wrap leading-relaxed">
              {state.videoScript || state.answer}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copy(state.videoScript || state.answer || '')}
                data-testid="copy-video-script-btn"
                className="rounded-lg border border-card-border bg-card px-2.5 py-1 text-xs font-bold text-ink hover:bg-subtle"
              >
                Copy script
              </button>
              {isBetaTester ? (
                <button
                  type="button"
                  onClick={() => onInsert(state.videoScript || state.answer || '')}
                  disabled={q.confidence < AUTOFILL_CONFIDENCE_THRESHOLD || inserting || inserted}
                  title={
                    q.confidence < AUTOFILL_CONFIDENCE_THRESHOLD
                      ? 'Auto-fill disabled: Low confidence mapping (< 0.75). Please copy and paste manually.'
                      : undefined
                  }
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                    inserted
                      ? 'border border-success-tint-border bg-success-tint text-success'
                      : q.confidence < AUTOFILL_CONFIDENCE_THRESHOLD
                        ? 'cursor-not-allowed border border-card-border bg-subtle text-ink-disabled opacity-60'
                        : 'border border-card-border bg-card text-ink hover:bg-subtle disabled:opacity-50'
                  }`}
                >
                  {inserting ? 'Inserting...' : inserted ? 'Inserted ✓' : 'Insert'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLockedInsertClick}
                  className="rounded-lg border border-card-border bg-card px-2.5 py-1 text-xs font-bold text-ink-muted hover:bg-subtle cursor-pointer flex items-center gap-1"
                >
                  <span>Insert</span>
                  <span className="text-[10px]">🔒 PRO</span>
                </button>
              )}
              {insertError ? <span className="text-[10px] text-danger">{insertError}</span> : null}
            </div>
            {lockedProNotice ? (
              <p className="mt-1.5 rounded bg-accent-tint p-1.5 text-[11px] font-medium text-accent">
                {lockedProNotice}
              </p>
            ) : null}
          </div>

          {state.sources?.length ? (
            <p className="mt-2 text-[10.5px] text-ink-muted">
              Sources: {state.sources.map((s) => s.label).join(', ')}
            </p>
          ) : null}
        </div>
      ) : state.outcome === 'draft' ? (
        /* Standard Draft Outcome Block (Emerald) */
        <div className="rounded-lg border border-success-tint-border bg-success-tint p-3 text-left">
          <p className="text-[12px] font-bold text-success">
            {seen?.defaultIsPrior ? 'Fresh draft — tailored for this role' : 'Draft — grounded in your history'}
          </p>
          {state.gapQuestion ? (
            <p className="mt-0.5 text-[11px] italic text-success">Used your follow-up answer to tailor this draft.</p>
          ) : null}
          <p className="mt-1.5 text-[13.5px] leading-[1.5] text-ink whitespace-pre-wrap">{state.answer}</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => state.answer && copy(state.answer)}
              className="rounded-lg bg-accent px-3 py-2 text-[13px] font-bold text-on-accent hover:opacity-90 transition-opacity"
            >
              Copy answer
            </button>
            {isBetaTester ? (
              <button
                type="button"
                onClick={() => state.answer && onInsert(state.answer)}
                disabled={q.confidence < AUTOFILL_CONFIDENCE_THRESHOLD || inserting || inserted}
                title={
                  q.confidence < AUTOFILL_CONFIDENCE_THRESHOLD
                    ? 'Auto-fill disabled: Low confidence mapping (< 0.75). Please copy and paste manually.'
                    : undefined
                }
                className={`rounded-lg px-3 py-2 text-[13px] font-bold transition-colors ${
                  inserted
                    ? 'border-[1.5px] border-success-tint-border bg-card text-success'
                    : q.confidence < AUTOFILL_CONFIDENCE_THRESHOLD
                      ? 'cursor-not-allowed border border-card-border bg-card text-ink-disabled opacity-60'
                      : 'border-[1.5px] border-success-tint-border bg-card text-ink hover:bg-subtle disabled:opacity-50'
                }`}
              >
                {inserting ? 'Inserting...' : inserted ? 'Inserted ✓' : 'Insert'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLockedInsertClick}
                className="rounded-lg border border-card-border bg-card px-3 py-2 text-[13px] font-bold text-ink-muted hover:bg-subtle cursor-pointer flex items-center gap-1"
              >
                <span>Insert</span>
                <span className="text-[10px]">🔒 PRO</span>
              </button>
            )}
            {insertError ? <span className="text-[10px] text-danger">{insertError}</span> : null}
          </div>

          {lockedProNotice ? (
            <p className="mt-2 rounded bg-card p-2 text-[11.5px] font-medium text-accent border border-accent-tint-border">
              {lockedProNotice}
            </p>
          ) : null}

          {/* Collapsible Reasoning Disclosure */}
          <button
            type="button"
            onClick={() => setReasoningOpen((prev) => !prev)}
            className="mt-2.5 border-none bg-transparent p-0 text-[12px] font-bold text-success underline cursor-pointer"
          >
            {reasoningOpen ? 'Hide reasoning' : 'Show reasoning'}
          </button>

          {reasoningOpen ? (
            <div className="mt-2 border-t border-dashed border-success-tint-border pt-2">
              <p className="mb-1 text-[11.5px] font-bold text-success">Built from</p>
              <ul className="m-0 list-inside list-disc pl-2 text-[12px] text-ink-secondary leading-[1.6]">
                {state.skeleton?.map((bullet, i) => (
                  <li key={`skel-${i}`}>{bullet}</li>
                ))}
                {state.sources?.map((s, i) => (
                  <li key={`src-${i}`}>{s.label}</li>
                ))}
                {!state.skeleton?.length && !state.sources?.length ? (
                  <li>Your verified history &amp; uploaded documents</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
