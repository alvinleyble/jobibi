import { useState } from 'react';
import { supabase } from './supabase';
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
  error?: string;
  loading?: boolean;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function extractSuggestError(err: unknown): Promise<string> {
  try {
    if (err && typeof err === 'object' && 'context' in err) {
      const ctx = (err as { context?: { json: () => Promise<unknown> } }).context;
      if (ctx?.json) {
        const body = (await ctx.json()) as { error?: unknown };
        if (body?.error) return typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      }
    }
  } catch {}
  return getErrorMessage(err);
}

export function SuggestCard({ q, jobContext }: { q: ExtractedQuestion; jobContext: ExtractionResult['jobContext'] }) {
  const [state, setState] = useState<SuggestState>({});
  const [gapInput, setGapInput] = useState('');
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);

  const onSuggest = async () => {
    setState({ loading: true });
    setGapError(null);
    setGapInput('');
    setConfirmError(null);
    setConfirmDone(null);
    setShowUpdate(false);
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
      });
    } catch (e) {
      setState({ error: getErrorMessage(e) });
    }
  };

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
        const msg = await extractSuggestError(error);
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
    if (!state.sensitiveKind) return;
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

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

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
      {state.outcome === 'refuse' ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <p className="font-medium">Not enough in your history to draft this.</p>
          <p>{state.refuseMessage}</p>
          <p className="mt-1 text-[10px] text-amber-700">
            q:{state.questionMatch?.toFixed(2)} r:{state.roleMatch?.toFixed(2)}
          </p>
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
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
          <p className="text-xs font-medium text-emerald-800">Draft — grounded in your history</p>
          {state.gapQuestion ? (
            <p className="mt-1 text-[10px] italic text-emerald-700">Used your follow-up answer to tailor this draft.</p>
          ) : null}
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-800">{state.answer}</p>
          <button
            type="button"
            onClick={() => state.answer && copy(state.answer)}
            className="mt-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          >
            Copy answer
          </button>
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
