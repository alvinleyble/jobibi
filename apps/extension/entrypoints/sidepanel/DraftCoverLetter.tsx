import { useState } from 'react';
import { deriveOrigin } from '@jobibi/shared';
import { supabase } from './supabase';
import { describeIngestError, humanizeErrorMessage } from './ingestError';

const MIN_JD_CHARS = 30;

interface DraftCoverLetterProps {
  onStored: () => void;
}

interface AcceptedDraft {
  text: string;
  origin: string;
  chunkCount: number;
}

function DraftCoverLetter({ onStored }: DraftCoverLetterProps) {
  const [jobDescription, setJobDescription] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [originalDraft, setOriginalDraft] = useState<string | null>(null);
  const [editedDraft, setEditedDraft] = useState('');
  const [acceptedDraft, setAcceptedDraft] = useState<AcceptedDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setSuccess(null);
    setAcceptedDraft(null);
    const trimmed = jobDescription.trim();
    if (trimmed.length < MIN_JD_CHARS) {
      setError(`Please paste a longer job description (at least ${MIN_JD_CHARS} characters) so Jobibi has enough context to draft your cover letter.`);
      return;
    }
    setGenerating(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke<{ draft: string; sources: unknown[] }>(
        'draft-cover-letter',
        { body: { jobDescription: trimmed } },
      );
      if (fnError || !data) {
        setError(fnError ? await describeIngestError(fnError) : 'We could not generate your cover letter. Please try again.');
        return;
      }
      const text = data.draft ?? '';
      setDraft(text);
      setOriginalDraft(text);
      setEditedDraft(text);
      // S8 item 6: job description is ephemeral — discard it once a draft is
      // generated, whether later accepted or not. Keep the textarea cleared.
      setJobDescription('');
    } catch (e) {
      setError(humanizeErrorMessage(e instanceof Error ? e.message : String(e)));
    } finally {
      setGenerating(false);
    }
  };

  const handleDiscard = () => {
    // S8 item 3: discard = nothing stored (mirrors refuse outcome)
    setDraft(null);
    setOriginalDraft(null);
    setEditedDraft('');
    setAcceptedDraft(null);
    setError(null);
    setSuccess(null);
  };

  const handleAccept = async () => {
    setError(null);
    setSuccess(null);
    const textToStore = editedDraft.trim();
    if (!textToStore) {
      setError('Cover letter cannot be empty. Please write or edit your cover letter before accepting.');
      return;
    }
    // D13 origin: any edit → user_edited (feeds voice profile);
    // zero changes → accepted_verbatim (must NEVER feed voice profile).
    const { origin } = deriveOrigin(originalDraft ?? '', textToStore);

    setSaving(true);
    try {
      // S8 item 3: store through the existing paste-ingestion path as an
      // ordinary documents row of kind cover_letter (identical to a manually
      // pasted cover letter). The ingest function validates via
      // PASTE_ALLOWED_KINDS and chunks/embeds into memory_chunks.
      // D13: origin distinguishes user_edited (feeds voice profile) vs
      // accepted_verbatim (must NEVER feed voice profile) — persisted on the
      // documents row via the ingest origin param.
      const { data, error: ingestError } = await supabase.functions.invoke<{ documentId: string; chunkCount: number }>(
        'ingest',
        { body: { text: textToStore, kind: 'cover_letter', origin } },
      );
      if (ingestError || !data) {
        setError(ingestError ? await describeIngestError(ingestError) : 'We could not save your cover letter to memory. Please try again.');
        return;
      }

      setAcceptedDraft({
        text: textToStore,
        origin,
        chunkCount: data.chunkCount,
      });
      setDraft(null);
      setOriginalDraft(null);
      setEditedDraft('');
      onStored();
    } catch (e) {
      setError(humanizeErrorMessage(e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!acceptedDraft) return;
    try {
      await navigator.clipboard.writeText(acceptedDraft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDraftAgain = () => {
    setAcceptedDraft(null);
    setDraft(null);
    setOriginalDraft(null);
    setEditedDraft('');
    setJobDescription('');
    setCopied(false);
    setError(null);
    setSuccess(null);
  };

  const hasDraft = draft !== null;
  const isAccepted = acceptedDraft !== null;

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <h2 className="text-sm font-semibold text-slate-900">Draft Cover Letter</h2>
      <p className="text-xs text-slate-500">
        Paste a job description — Jobibi drafts a cover letter from your own history. You can edit before accepting.
      </p>

      {isAccepted ? (
        <div
          data-testid="accepted-cover-letter-card"
          className="flex flex-col gap-2 rounded border border-emerald-300 bg-emerald-50/60 p-3 text-xs text-slate-800"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
              <span className="text-emerald-600">✓</span>
              <span>Saved to Memory Bank</span>
            </div>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-mono text-emerald-800">
              {acceptedDraft.origin} · {acceptedDraft.chunkCount} chunk{acceptedDraft.chunkCount === 1 ? '' : 's'}
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded border border-emerald-200/80 bg-white/80 p-2.5 text-xs text-slate-700 leading-relaxed">
            {acceptedDraft.text}
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              data-testid="copy-cover-letter-btn"
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 transition-colors"
            >
              {copied ? 'Copied ✓' : 'Copy cover letter'}
            </button>
            <button
              type="button"
              onClick={handleDraftAgain}
              data-testid="draft-again-btn"
              className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-emerald-50 transition-colors"
            >
              Draft Again
            </button>
          </div>
        </div>
      ) : !hasDraft ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-24 rounded border border-slate-200 p-2 text-xs text-slate-600"
            placeholder="Paste the job description here…"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={generating || saving}
          />
          <button
            type="button"
            className="self-start rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            disabled={generating || saving || jobDescription.trim().length < MIN_JD_CHARS}
            onClick={() => void handleGenerate()}
          >
            {generating ? 'Generating…' : 'Generate draft'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-40 rounded border border-slate-200 p-2 text-xs text-slate-700"
            value={editedDraft}
            onChange={(e) => setEditedDraft(e.target.value)}
            disabled={saving || generating}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              disabled={saving || generating || editedDraft.trim().length === 0}
              onClick={() => void handleAccept()}
            >
              {saving ? 'Saving…' : 'Accept'}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
              disabled={saving || generating}
              onClick={handleDiscard}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-emerald-600">{success}</p>}
    </div>
  );
}

export default DraftCoverLetter;
