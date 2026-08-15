import { useState } from 'react';
import { describeIngestError, humanizeErrorMessage } from './ingestError';
import { supabase } from './supabase';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface UploadDocumentProps {
  userId: string;
  onIngested: () => void;
  title?: string;
}

export function UploadDocument({ userId, onIngested, title = 'Upload a document' }: UploadDocumentProps) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'ingesting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setLastResult(null);

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
        body: { storagePath, kind: 'resume', fileName: file.name, mimeType: file.type || 'application/octet-stream' },
      },
    );
    if (ingestError || !data) {
      setStatus('error');
      setError(ingestError ? await describeIngestError(ingestError) : 'We could not process your document. Please try uploading again.');
      return;
    }

    setStatus('idle');
    setLastResult(`Added ${data.chunkCount} chunk${data.chunkCount === 1 ? '' : 's'} from ${file.name}.`);
    onIngested();
  };

  const busy = status === 'uploading' || status === 'ingesting';

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-dash bg-dash-bg p-4 text-center">
      <span className="text-[13.5px] font-bold text-ink">{title}</span>
      <span className="text-[12px] text-ink-muted">Resume · PDF, DOCX or TXT, up to 20MB</span>
      <label className="mt-1 cursor-pointer">
        <input
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFile(file);
          }}
          className="text-[12px] text-ink-secondary file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-card-border file:bg-card file:px-2.5 file:py-1 file:text-[12px] file:font-semibold file:text-ink hover:file:bg-subtle disabled:opacity-50"
        />
      </label>
      {status === 'uploading' && <p className="text-xs text-ink-muted">Uploading…</p>}
      {status === 'ingesting' && <p className="text-xs text-ink-muted">Extracting and embedding…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {lastResult && <p className="text-xs text-success font-medium">{lastResult}</p>}
    </div>
  );
}

export default UploadDocument;
