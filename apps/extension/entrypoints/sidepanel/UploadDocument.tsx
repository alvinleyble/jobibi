import { useState } from 'react';
import { DOCUMENT_KINDS, type DocumentKind } from '@jobibi/shared';
import { describeIngestError } from './ingestError';
import { supabase } from './supabase';

const KIND_LABELS: Record<DocumentKind, string> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  transcript: 'Transcript',
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;

// S3b: paste is only offered for cover letters — resumes and transcripts
// stay upload-only (transcripts especially lose fidelity when pasted).
const PASTE_ENABLED_KINDS: readonly DocumentKind[] = ['cover_letter'];

type Status = 'idle' | 'uploading' | 'ingesting' | 'error';
type InputMode = 'file' | 'paste';

interface UploadDocumentProps {
  userId: string;
  onIngested: () => void;
}

function UploadDocument({ userId, onIngested }: UploadDocumentProps) {
  const [kind, setKind] = useState<DocumentKind>('resume');
  const [mode, setMode] = useState<InputMode>('file');
  const [pasteText, setPasteText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setLastResult(null);

    if (file.size > MAX_FILE_BYTES) {
      setStatus('error');
      setError('That file is larger than 20 MB.');
      return;
    }

    const storagePath = `${userId}/${crypto.randomUUID()}-${file.name}`;

    setStatus('uploading');
    const { error: uploadError } = await supabase.storage.from('documents').upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (uploadError) {
      setStatus('error');
      setError(uploadError.message);
      return;
    }

    setStatus('ingesting');
    const { data, error: ingestError } = await supabase.functions.invoke<{ documentId: string; chunkCount: number }>(
      'ingest',
      {
        body: { storagePath, kind, fileName: file.name, mimeType: file.type || 'application/octet-stream' },
      },
    );
    if (ingestError || !data) {
      setStatus('error');
      setError(ingestError ? await describeIngestError(ingestError) : 'Ingestion failed.');
      return;
    }

    setStatus('idle');
    setLastResult(`Added ${data.chunkCount} chunk${data.chunkCount === 1 ? '' : 's'} from ${file.name}.`);
    onIngested();
  };

  const handlePaste = async () => {
    setError(null);
    setLastResult(null);

    setStatus('ingesting');
    const { data, error: ingestError } = await supabase.functions.invoke<{ documentId: string; chunkCount: number }>(
      'ingest',
      {
        body: { text: pasteText, kind },
      },
    );
    if (ingestError || !data) {
      setStatus('error');
      setError(ingestError ? await describeIngestError(ingestError) : 'Ingestion failed.');
      return;
    }

    setStatus('idle');
    setPasteText('');
    setLastResult(`Added ${data.chunkCount} chunk${data.chunkCount === 1 ? '' : 's'} from pasted text.`);
    onIngested();
  };

  const busy = status === 'uploading' || status === 'ingesting';
  const pasteAllowed = PASTE_ENABLED_KINDS.includes(kind);

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <h2 className="text-sm font-semibold text-slate-900">Upload a document</h2>
      <div className="flex gap-2">
        {DOCUMENT_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="radio"
              name="kind"
              checked={kind === k}
              onChange={() => {
                setKind(k);
                if (!PASTE_ENABLED_KINDS.includes(k)) setMode('file');
              }}
              disabled={busy}
            />
            {KIND_LABELS[k]}
          </label>
        ))}
      </div>

      {pasteAllowed && (
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className={mode === 'file' ? 'font-semibold text-slate-900 underline' : 'text-slate-500'}
            onClick={() => setMode('file')}
            disabled={busy}
          >
            Upload file
          </button>
          <button
            type="button"
            className={mode === 'paste' ? 'font-semibold text-slate-900 underline' : 'text-slate-500'}
            onClick={() => setMode('paste')}
            disabled={busy}
          >
            Paste text
          </button>
        </div>
      )}

      {pasteAllowed && mode === 'paste' ? (
        <div className="flex flex-col gap-1">
          <textarea
            className="min-h-24 rounded border border-slate-200 p-2 text-xs text-slate-600"
            placeholder="Paste your cover letter text here…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="self-start rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
            disabled={busy || pasteText.trim().length === 0}
            onClick={() => void handlePaste()}
          >
            Add pasted text
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFile(file);
          }}
          className="text-xs text-slate-600"
        />
      )}
      {status === 'uploading' && <p className="text-xs text-slate-500">Uploading…</p>}
      {status === 'ingesting' && <p className="text-xs text-slate-500">Extracting and embedding…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {lastResult && <p className="text-xs text-emerald-600">{lastResult}</p>}
    </div>
  );
}

export default UploadDocument;
