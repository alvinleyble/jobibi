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

export function DraftCoverLetter({ onStored }: DraftCoverLetterProps) {
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
      setJobDescription('');
    } catch (e) {
      setError(humanizeErrorMessage(e instanceof Error ? e.message : String(e)));
    } finally {
      setGenerating(false);
    }
  };

  const handleDiscard = () => {
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
    const { origin } = deriveOrigin(originalDraft ?? '', textToStore);

    setSaving(true);
    try {
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
    <div className="flex flex-col gap-2 rounded-[10px] border border-card-border bg-card p-3.5">
      <h3 className="text-[13.5px] font-bold text-ink">Draft a cover letter</h3>
      <p className="text-[12px] text-ink-muted">
        Paste a job description — Jobibi drafts one from your history.
      </p>

      {isAccepted ? (
        <div
          data-testid="accepted-cover-letter-card"
          className="flex flex-col gap-2 rounded-lg border border-success-tint-border bg-success-tint p-3 text-xs text-ink"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-success">
              <span>✓</span>
              <span>Saved to Memory</span>
            </div>
            <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-bold text-success border border-success-tint-border">
              {acceptedDraft.origin} · {acceptedDraft.chunkCount} chunk{acceptedDraft.chunkCount === 1 ? '' : 's'}
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-card-border bg-card p-2.5 text-[12.5px] text-ink leading-relaxed">
            {acceptedDraft.text}
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              data-testid="copy-cover-letter-btn"
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 transition-opacity"
            >
              {copied ? 'Copied ✓' : 'Copy cover letter'}
            </button>
            <button
              type="button"
              onClick={handleDraftAgain}
              data-testid="draft-again-btn"
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-bold text-ink hover:bg-subtle transition-colors"
            >
              Draft Again
            </button>
          </div>
        </div>
      ) : !hasDraft ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-24 w-full rounded-lg border border-card-border bg-card p-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            placeholder="Paste the job description here…"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={generating || saving}
          />
          <button
            type="button"
            className="self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
            disabled={generating || saving || jobDescription.trim().length < MIN_JD_CHARS}
            onClick={() => void handleGenerate()}
          >
            {generating ? 'Generating…' : 'Generate draft'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-40 w-full rounded-lg border border-card-border bg-card p-2 text-xs text-ink leading-relaxed focus:border-accent focus:outline-none"
            value={editedDraft}
            onChange={(e) => setEditedDraft(e.target.value)}
            disabled={saving || generating}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
              disabled={saving || generating || editedDraft.trim().length === 0}
              onClick={() => void handleAccept()}
            >
              {saving ? 'Saving…' : 'Accept'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-bold text-ink hover:bg-subtle disabled:opacity-50 transition-colors"
              disabled={saving || generating}
              onClick={handleDiscard}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
      {success && <p className="text-xs text-success">{success}</p>}
    </div>
  );
}

export default DraftCoverLetter;
