import { useState } from 'react';
import { type DocumentKind, validatePaste, PASTE_ALLOWED_KINDS } from '@jobibi/shared';
import { describeIngestError, humanizeErrorMessage } from './ingestError';
import { supabase } from './supabase';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface AddDocumentProps {
  userId: string;
  onSuccess: (message?: string) => void;
  onCancel: () => void;
}

type AddMode = 'upload' | 'paste';

const KIND_DISPLAY_NAMES: Record<DocumentKind, string> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  transcript: 'Transcript',
};

export function AddDocument({ userId, onSuccess, onCancel }: AddDocumentProps) {
  const [mode, setMode] = useState<AddMode>('upload');
  const [uploadKind, setUploadKind] = useState<DocumentKind>('resume');
  const [pasteKind, setPasteKind] = useState<DocumentKind>('resume');
  const [pasteText, setPasteText] = useState('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'ingesting' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (file: File) => {
    setError(null);

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const allowedExtensions = ['pdf', 'docx', 'txt'];
    if (!allowedExtensions.includes(ext)) {
      setStatus('error');
      setError('Unsupported file format. Please upload a text-based PDF, DOCX, or TXT file.');
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setStatus('error');
      setError('That file is larger than 20 MB. Please upload a file under 20 MB.');
      return;
    }

    const storagePath = `${userId}/${crypto.randomUUID()}-${file.name}`;

    setStatus('uploading');
    const { error: uploadError } = await supabase.storage.from('documents').upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (uploadError) {
      setStatus('error');
      setError(humanizeErrorMessage(uploadError.message));
      return;
    }

    setStatus('ingesting');
    const { data, error: ingestError } = await supabase.functions.invoke<{ documentId: string; chunkCount: number }>(
      'ingest',
      {
        body: {
          storagePath,
          kind: uploadKind,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        },
      },
    );
    if (ingestError || !data) {
      setStatus('error');
      setError(ingestError ? await describeIngestError(ingestError) : 'We could not process your document. Please try uploading again.');
      return;
    }

    setStatus('idle');
    onSuccess(`Added ${data.chunkCount} chunk${data.chunkCount === 1 ? '' : 's'} from ${file.name}.`);
  };

  const handlePasteSubmit = async () => {
    setError(null);
    const validation = validatePaste(pasteText, pasteKind);
    if (!validation.ok) {
      setError(validation.error ?? 'Please check your pasted text.');
      return;
    }

    setStatus('saving');
    const { data, error: ingestError } = await supabase.functions.invoke<{ documentId: string; chunkCount: number }>(
      'ingest',
      {
        body: {
          text: validation.text,
          kind: pasteKind,
          origin: 'user_written',
        },
      },
    );

    if (ingestError || !data) {
      setStatus('error');
      setError(ingestError ? await describeIngestError(ingestError) : 'We could not save your text to memory. Please try again.');
      return;
    }

    setStatus('idle');
    onSuccess(`Added ${data.chunkCount} chunk${data.chunkCount === 1 ? '' : 's'} from pasted ${KIND_DISPLAY_NAMES[pasteKind].toLowerCase()}.`);
  };

  const busy = status === 'uploading' || status === 'ingesting' || status === 'saving';

  return (
    <div
      data-testid="add-document-panel"
      className="flex flex-col gap-3 rounded-lg border border-card-border bg-subtle p-3 text-xs text-left"
    >
      {/* Mode Selector */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-md border border-card-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => {
              setMode('upload');
              setError(null);
            }}
            disabled={busy}
            data-testid="tab-upload-file-btn"
            className={`rounded px-2.5 py-1 text-[11.5px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
              mode === 'upload' ? 'bg-accent text-on-accent' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            Upload file
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('paste');
              setError(null);
            }}
            disabled={busy}
            data-testid="tab-paste-text-btn"
            className={`rounded px-2.5 py-1 text-[11.5px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
              mode === 'paste' ? 'bg-accent text-on-accent' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            Paste text
          </button>
        </div>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          data-testid="cancel-add-doc-btn"
          className="border-none bg-transparent text-[11.5px] font-semibold text-ink-muted hover:text-ink cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {mode === 'upload' ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="upload-doc-kind" className="font-semibold text-ink whitespace-nowrap">
              Document type:
            </label>
            <select
              id="upload-doc-kind"
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value as DocumentKind)}
              disabled={busy}
              className="rounded-md border border-card-border bg-card px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
            >
              <option value="resume">Resume</option>
              <option value="cover_letter">Cover letter</option>
              <option value="transcript">Transcript</option>
            </select>
          </div>

          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-dash bg-card p-3 text-center">
            <span className="text-[11.5px] text-ink-muted">PDF, DOCX, or TXT (up to 20MB)</span>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                disabled={busy}
                data-testid="file-upload-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleFileUpload(file);
                }}
                className="text-[11.5px] text-ink-secondary file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-card-border file:bg-subtle file:px-2.5 file:py-1 file:text-[11.5px] file:font-semibold file:text-ink hover:file:bg-card disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="paste-doc-kind" className="font-semibold text-ink whitespace-nowrap">
              Document type:
            </label>
            <select
              id="paste-doc-kind"
              value={pasteKind}
              onChange={(e) => setPasteKind(e.target.value as DocumentKind)}
              disabled={busy}
              className="rounded-md border border-card-border bg-card px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
            >
              {PASTE_ALLOWED_KINDS.map((kind: DocumentKind) => (
                <option key={kind} value={kind}>
                  {KIND_DISPLAY_NAMES[kind]}
                </option>
              ))}
            </select>
          </div>

          <textarea
            data-testid="paste-text-input"
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={busy}
            placeholder={`Paste your ${KIND_DISPLAY_NAMES[pasteKind].toLowerCase()} text here…`}
            className="w-full rounded-lg border border-card-border bg-card p-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none leading-relaxed"
          />

          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-ink-muted">
              {pasteText.length} character{pasteText.length === 1 ? '' : 's'} (min 20)
            </span>
            <button
              type="button"
              onClick={() => void handlePasteSubmit()}
              disabled={busy || pasteText.trim().length < 20}
              data-testid="submit-paste-btn"
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save to Memory'}
            </button>
          </div>
        </div>
      )}

      {status === 'uploading' && <p className="text-xs text-ink-muted">Uploading…</p>}
      {status === 'ingesting' && <p className="text-xs text-ink-muted">Extracting and embedding…</p>}
      {error && <p className="text-xs text-danger" data-testid="add-doc-error">{error}</p>}
    </div>
  );
}

export default AddDocument;
