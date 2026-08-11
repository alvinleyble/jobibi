import { useState } from 'react';
import { supabase } from './supabase';
import type { ExtractedQuestion, ExtractionResult } from '@jobibi/shared';

interface SuggestState {
  outcome?: 'draft' | 'refuse';
  answer?: string;
  skeleton?: string[];
  sources?: { kind: string; label: string; ref: string }[];
  refuseMessage?: string;
  questionMatch?: number;
  roleMatch?: number;
  error?: string;
  loading?: boolean;
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'context' in err) {
    const ctx = (err as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      // Will be handled async where needed, fallback here
    }
  }
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

  const onSuggest = async () => {
    setState({ loading: true });
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
        questionMatch: data.questionMatch,
        roleMatch: data.roleMatch,
      });
    } catch (e) {
      setState({ error: getErrorMessage(e) });
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
        disabled={state.loading}
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
      {state.outcome === 'draft' ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
          <p className="text-xs font-medium text-emerald-800">Draft — grounded in your history</p>
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
