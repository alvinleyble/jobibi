import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { AUTOFILL_CONFIDENCE_THRESHOLD } from '@jobibi/shared';
import type { ExtractedQuestion, ExtractionResult } from '@jobibi/shared';

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
  error?: string;
  loading?: boolean;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type SuggestErrorBody = {
  error?: unknown;
  code?: string;
  sensitiveKind?: string;
  sensitiveVia?: string;
  sensitiveFact?: { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; provenanceLine: string } | null;
};

// Response bodies can only be read once — parse it a single time and derive
// both the sensitive-rejection check and the display message from the result.
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
  if (body?.error) return typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
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

  // Notify parent (JobStreetQuestions) when a draft is available for capture mapping (D13)
  useEffect(() => {
    if (state.outcome === 'draft' && state.answer && onDraftAvailable) {
      onDraftAvailable(q.id, state.answer);
    } else if ((state.outcome === 'refuse' || state.outcome === 'ask' || !state.outcome) && onDraftAvailable) {
      // clear draft when not in draft outcome
      // keep prior draft? For capture, only current draft matters
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
      });
      // propagate draft to content script for capture origin diff (D13)
      if (data.outcome === 'draft' && data.answer && onDraftAvailable) {
        onDraftAvailable(q.id, data.answer as string);
      } else if (onDraftAvailable) {
        onDraftAvailable(q.id, null);
      }
    } catch (e) {
      setState({ error: getErrorMessage(e) });
    }
  };

  // helper to detect sensitive rejection from an already-parsed error body and route to confirm card
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
      setGapError('Please write a short answer.');
      return;
    }
    if (trimmed.length < 3) {
      setGapError('Answer is too short.');
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

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmDone, setConfirmDone] = useState<string | null>(null);
  const [updateValue, setUpdateValue] = useState('');
  const [showUpdate, setShowUpdate] = useState(false);

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
      // Refresh local fact with returned data
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
      setConfirmError('Please enter a value.');
      return;
    }
    if (!state.sensitiveKind) {
      setConfirmError('Could not verify this field — please try Suggest again.');
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

  // S7A manual input on refuse — cold raw-text capture, user-written, guaranteed memory
  const onManualSubmit = async () => {
    const trimmed = manualInput.trim();
    if (!trimmed) {
      setManualError('Please write a short answer.');
      return;
    }
    if (trimmed.length < 3) {
      setManualError('Answer is too short.');
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
      // Optionally trigger seen-before refresh on next Suggest: keep question as dirty
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
        setInsertError('Active tab not found');
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
          error: e instanceof Error ? e.message : 'Could not reach page content script',
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
        setInsertError(response?.error || 'Failed to insert into form field');
        setTimeout(() => {
          setInsertError(null);
        }, 4000);
      }
    } catch (e) {
      setInsertError(e instanceof Error ? e.message : String(e));
      setTimeout(() => {
        setInsertError(null);
      }, 4000);
    } finally {
      setInserting(false);
    }
  };

  const seen = state.seenBefore;

  return (
    <div className="mt-1 flex flex-col gap-1">
      <button
        type="button"
        onClick={onSuggest}
        disabled={state.loading || gapLoading}
        className="self-start rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {state.loading ? 'Thinking…' : state.outcome ? 'Regenerate' : 'Suggest'}
      </button>
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}

      {/* Seen-before surfacing (S6 D12) — shown for any outcome, both options always offered */}
      {seen ? (
        <div className={`rounded border p-2 ${seen.defaultIsPrior ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-blue-800">Seen before — {seen.sourceLabel}</p>
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 border">origin: {seen.origin} · sim {seen.similarity.toFixed(2)}</span>
          </div>
          <p className="mt-1 text-[10px] italic text-slate-500">Prior: “{seen.questionLabel}”</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-800">{seen.answerText}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => copy(seen.answerText)} className="rounded border border-blue-300 bg-white px-2 py-1 text-xs">
              Copy prior answer
            </button>
            <span className="self-center text-[10px] text-slate-500">
              {seen.defaultIsPrior ? 'Prior is default (same role family)' : 'Fresh draft is default (different role) — prior offered as alternative'}
            </span>
          </div>
          {!seen.defaultIsPrior && state.outcome !== 'draft' ? (
            <p className="mt-1 text-[10px] text-slate-500">A fresh draft is also available below; both are offered.</p>
          ) : null}
          {seen.defaultIsPrior && state.outcome === 'draft' ? (
            <p className="mt-1 text-[10px] text-slate-500">Fresh draft also below — choose either.</p>
          ) : null}
        </div>
      ) : null}

      {state.outcome === 'refuse' ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <p className="font-medium">Not enough in your history to draft this.</p>
          <p>{state.refuseMessage}</p>
          <p className="mt-1 text-[10px] text-amber-700">
            q:{state.questionMatch?.toFixed(2)} r:{state.roleMatch?.toFixed(2)}
          </p>
          {/* S7A manual input on refuse — cold raw-text, guarantees memory when capture is least trustworthy */}
          <div className="mt-2 rounded border border-amber-200 bg-white p-2">
            <p className="text-xs font-medium text-slate-800">Provide input</p>
            <p className="mt-1 text-[10px] text-slate-500">Your answer will be saved to your memory bank (user-written) and used for future drafts.</p>
            <textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Your answer…"
              rows={3}
              className="mt-2 w-full rounded border border-slate-300 bg-white p-1.5 text-xs text-slate-800 placeholder:text-slate-400"
              disabled={manualLoading}
            />
            {manualError ? <p className="mt-1 text-xs text-red-600">{manualError}</p> : null}
            {manualSuccess ? <p className="mt-1 text-xs text-emerald-600">{manualSuccess}</p> : null}
            <button
              type="button"
              onClick={onManualSubmit}
              disabled={manualLoading || !manualInput.trim()}
              className="mt-2 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {manualLoading ? 'Saving…' : 'Save to memory'}
            </button>
          </div>
        </div>
      ) : null}
      {state.outcome === 'ask' ? (
        <div className="rounded border border-sky-200 bg-sky-50 p-2">
          <p className="text-xs font-medium text-sky-800">One quick follow-up — then I’ll draft</p>
          <p className="mt-1 text-xs text-slate-800">{state.gapQuestion}</p>
          {state.anchoredChunkText ? (
            <p className="mt-1 text-[10px] italic text-slate-500" title={state.anchoredChunkText}>
              Anchored to: “{state.anchoredChunkText.slice(0, 100)}…”
            </p>
          ) : null}
          <textarea
            value={gapInput}
            onChange={(e) => setGapInput(e.target.value)}
            placeholder="Your short answer…"
            rows={3}
            className="mt-2 w-full rounded border border-slate-300 bg-white p-1.5 text-xs text-slate-800 placeholder:text-slate-400"
            disabled={gapLoading}
          />
          {gapError ? <p className="mt-1 text-xs text-red-600">{gapError}</p> : null}
          <button
            type="button"
            onClick={onSubmitGap}
            disabled={gapLoading || !gapInput.trim()}
            className="mt-2 rounded bg-sky-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {gapLoading ? 'Saving…' : 'Submit & draft'}
          </button>
          <p className="mt-1 text-[10px] text-slate-400">
            Your answer is saved to your memory bank and used immediately.
          </p>
          <p className="mt-1 text-[10px] text-slate-400">
            q:{state.questionMatch?.toFixed(2)} r:{state.roleMatch?.toFixed(2)}
          </p>
        </div>
      ) : null}
      {state.outcome === 'confirm' ? (
        <div className="rounded border border-violet-200 bg-violet-50 p-2">
          <p className="text-xs font-medium text-violet-800">Always-confirm — sensitive field</p>
          {state.sensitiveFact ? (
            <>
              <p className="mt-1 text-xs text-slate-800">
                <span className="font-semibold">{state.sensitiveFact.value}</span>
              </p>
              <p className="mt-1 text-xs italic text-slate-600">{state.sensitiveFact.provenanceLine}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={confirmLoading}
                  className="rounded bg-violet-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {confirmLoading ? 'Saving…' : 'Confirm still true'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpdate((v) => !v)}
                  disabled={confirmLoading}
                  className="rounded border border-violet-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                >
                  Update
                </button>
              </div>
              {showUpdate ? (
                <div className="mt-2 flex flex-col gap-1">
                  <input
                    type="text"
                    value={updateValue}
                    onChange={(e) => setUpdateValue(e.target.value)}
                    placeholder={`New ${state.sensitiveKind} value`}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    disabled={confirmLoading}
                  />
                  <button
                    type="button"
                    onClick={onUpdate}
                    disabled={confirmLoading || !updateValue.trim()}
                    className="self-start rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Save update
                  </button>
                </div>
              ) : null}
              {confirmError ? <p className="mt-1 text-xs text-red-600">{confirmError}</p> : null}
              {confirmDone ? <p className="mt-1 text-xs text-emerald-600">{confirmDone}</p> : null}
              <p className="mt-2 text-[10px] text-slate-400">This field is never drafted or auto-filled.</p>
            </>
          ) : !state.sensitiveKind ? (
            <>
              <p className="mt-1 text-xs text-slate-700">
                This looks like a sensitive question, but we couldn&apos;t verify it just now.
              </p>
              <p className="mt-1 text-xs text-slate-500">Please try Suggest again.</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-700">
                This looks like a sensitive question ({state.sensitiveKind}), but you haven&apos;t set a value for it yet.
              </p>
              <p className="mt-1 text-xs text-slate-500">Set it in the Sixty-second intake, then confirm here.</p>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={updateValue}
                  onChange={(e) => setUpdateValue(e.target.value)}
                  placeholder={`New ${state.sensitiveKind} value`}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                  disabled={confirmLoading}
                />
                <button
                  type="button"
                  onClick={onUpdate}
                  disabled={confirmLoading || !updateValue.trim()}
                  className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              {confirmError ? <p className="mt-1 text-xs text-red-600">{confirmError}</p> : null}
              {confirmDone ? <p className="mt-1 text-xs text-emerald-600">{confirmDone}</p> : null}
            </>
          )}
        </div>
      ) : null}
      {state.outcome === 'draft' ? (
        <div className={`rounded border p-2 ${seen?.defaultIsPrior ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <p className={`text-xs font-medium ${seen?.defaultIsPrior ? 'text-slate-700' : 'text-emerald-800'}`}>
            {seen?.defaultIsPrior ? 'Fresh draft — tailored for this role (prior was alternative above)' : 'Draft — grounded in your history'}
            {seen?.defaultIsPrior ? '' : seen ? ' (default — different role from prior)' : ''}
          </p>
          {state.gapQuestion ? (
            <p className="mt-1 text-[10px] italic text-emerald-700">Used your follow-up answer to tailor this draft.</p>
          ) : null}
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-800">{state.answer}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => state.answer && copy(state.answer)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
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
                className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                  inserted
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : q.confidence < AUTOFILL_CONFIDENCE_THRESHOLD
                      ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-60'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50'
                }`}
              >
                {inserting ? 'Inserting...' : inserted ? 'Inserted ✓' : 'Insert'}
              </button>
            ) : null}
            {insertError ? <span className="text-[10px] text-red-600">{insertError}</span> : null}
          </div>
          {state.skeleton?.length ? (
            <div className="mt-2">
              <p className="text-xs font-medium text-slate-700">Skeleton</p>
              <ul className="list-inside list-disc text-xs text-slate-600">
                {state.skeleton.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => copy(state.skeleton!.join('\n- '))}
                className="mt-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                Copy skeleton
              </button>
            </div>
          ) : null}
          {state.sources?.length ? (
            <p className="mt-2 text-[10px] text-slate-500">
              Sources: {state.sources.map((s) => s.label).join(', ')}
            </p>
          ) : null}
          <p className="mt-1 text-[10px] text-slate-400">
            q:{state.questionMatch?.toFixed(2)} r:{state.roleMatch?.toFixed(2)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
