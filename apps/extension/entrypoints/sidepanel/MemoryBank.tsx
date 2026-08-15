import { useCallback, useEffect, useState } from 'react';
import { type DocumentKind } from '@jobibi/shared';
import { supabase } from './supabase';
import { humanizeErrorMessage } from './ingestError';
import DraftCoverLetter from './DraftCoverLetter';
import AddDocument from './AddDocument';

interface DocumentRow {
  id: string;
  kind: DocumentKind;
  file_name: string;
  created_at: string;
  storage_path?: string | null;
}

interface ChunkRow {
  id: string;
  document_id: string;
}

interface QaRow {
  id: string;
  question_label: string;
  answer_text: string;
  origin: string;
  created_at: string;
}

const KIND_LABELS: Record<DocumentKind, string> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  transcript: 'Transcript',
};

interface MemoryBankProps {
  userId: string;
}

export function MemoryBank({ userId }: MemoryBankProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [qaPairs, setQaPairs] = useState<QaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingQaId, setDeletingQaId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [docActionStatus, setDocActionStatus] = useState<string | null>(null);

  // Accordion open/close state (collapsed by default)
  const [docsOpen, setDocsOpen] = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);

  const refresh = useCallback(async () => {
    const [documentsRes, chunksRes, qaRes] = await Promise.all([
      supabase.from('documents').select('id, kind, file_name, created_at, storage_path').order('created_at', { ascending: false }),
      supabase.from('memory_chunks').select('id, document_id'),
      supabase.from('qa_pairs').select('id, question_label, answer_text, origin, created_at').order('created_at', { ascending: false }),
    ]);

    if (!documentsRes.error) setDocuments(documentsRes.data ?? []);
    if (!chunksRes.error) setChunks(chunksRes.data ?? []);
    if (!qaRes.error) setQaPairs(qaRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteDocument = async (doc: DocumentRow) => {
    setDeletingDocId(doc.id);
    try {
      if (doc.storage_path) {
        const { error: storageError } = await supabase.storage.from('documents').remove([doc.storage_path]);
        if (storageError) {
          console.warn('Failed to remove document file from storage:', storageError);
        }
      }

      await supabase.from('memory_chunks').delete().eq('document_id', doc.id).eq('user_id', userId);
      const { error: docError } = await supabase.from('documents').delete().eq('id', doc.id).eq('user_id', userId);
      if (docError) {
        throw docError;
      }

      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setDocActionStatus(`Deleted "${doc.file_name}".`);
      setTimeout(() => setDocActionStatus(null), 3000);
      await refresh();
    } catch (e) {
      console.error('Failed to delete document:', e);
      setDocActionStatus(`Failed to delete document: ${humanizeErrorMessage(e instanceof Error ? e.message : String(e))}`);
    } finally {
      setDeletingDocId(null);
    }
  };

  const deleteQaPair = async (qa: QaRow) => {
    setDeletingQaId(qa.id);
    try {
      // 1. Delete matching memory_chunks embedding (D12: purged permanently from vector retrieval)
      await supabase
        .from('memory_chunks')
        .delete()
        .eq('user_id', userId)
        .eq('type', 'qa_pair')
        .eq('text', `Q: ${qa.question_label}\nA: ${qa.answer_text}`);

      // 2. Delete qa_pairs row
      await supabase.from('qa_pairs').delete().eq('id', qa.id).eq('user_id', userId);

      await refresh();
    } catch (e) {
      console.error('Failed to delete QA pair:', e);
    } finally {
      setDeletingQaId(null);
    }
  };

  const chunkCountByDocument = chunks.reduce<Record<string, number>>((acc, chunk) => {
    acc[chunk.document_id] = (acc[chunk.document_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div data-screen-label="Memory" className="flex flex-col gap-3">
      {/* 1. Draft Cover Letter Card */}
      <DraftCoverLetter onStored={refresh} />

      {/* 2. Stored Answers Card */}
      <div className="flex flex-col gap-2.5 rounded-[10px] border border-card-border bg-card p-3.5">
        <h3 className="text-[13.5px] font-bold text-ink">
          Stored answers · {qaPairs.length}
        </h3>

        {loading ? (
          <p className="text-xs text-ink-muted">Loading…</p>
        ) : qaPairs.length === 0 ? (
          <p className="text-xs italic text-ink-muted">No stored Q&amp;A answers yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {qaPairs.map((qa) => (
              <div
                key={qa.id}
                data-testid={`qa-item-${qa.id}`}
                className="flex flex-col rounded-lg border border-card-border bg-subtle p-2.5 text-xs text-left"
              >
                <p className="font-bold text-ink break-words text-[12.5px]">Q: {qa.question_label}</p>
                <p className="mt-1 text-ink-secondary whitespace-pre-wrap break-words leading-[1.45] text-[12.5px]">
                  A: {qa.answer_text}
                </p>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-ink-muted">
                    Captured · {new Date(qa.created_at).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteQaPair(qa)}
                    disabled={deletingQaId === qa.id}
                    aria-label={`Delete answer for ${qa.question_label}`}
                    title="Delete answer"
                    data-testid={`delete-qa-btn-${qa.id}`}
                    className="border-none bg-transparent text-[12px] font-bold text-delete-text hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {deletingQaId === qa.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Collapsible Accordion: Uploaded Documents with Inline Add & Delete */}
      <div className="rounded-[10px] border border-card-border bg-card px-3.5 py-1">
        <div className="flex items-center justify-between py-2">
          <button
            type="button"
            onClick={() => setDocsOpen((prev) => !prev)}
            data-testid="toggle-documents-btn"
            className="flex items-center gap-1.5 border-none bg-transparent text-left cursor-pointer p-0"
          >
            <span className="text-[13.5px] font-bold text-ink">
              Documents · {documents.length}
            </span>
            <span className="text-[12px] text-ink-muted">{docsOpen ? '▾' : '▸'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDocsOpen(true);
              setShowAddDoc((prev) => !prev);
            }}
            data-testid="add-document-btn"
            className="rounded-md border border-card-border bg-subtle px-2.5 py-1 text-[11.5px] font-bold text-ink hover:bg-card hover:border-accent transition-colors cursor-pointer"
          >
            {showAddDoc ? 'Close' : '+ Add document'}
          </button>
        </div>

        {docsOpen ? (
          <div className="flex flex-col gap-2 pb-3 text-[12.5px] text-ink-secondary">
            {docActionStatus ? (
              <div
                data-testid="doc-action-status"
                className="rounded-md bg-success-tint border border-success-tint-border px-2.5 py-1 text-[11.5px] font-medium text-success"
              >
                {docActionStatus}
              </div>
            ) : null}

            {showAddDoc ? (
              <AddDocument
                userId={userId}
                onSuccess={(msg) => {
                  setShowAddDoc(false);
                  if (msg) {
                    setDocActionStatus(msg);
                    setTimeout(() => setDocActionStatus(null), 3500);
                  }
                  void refresh();
                }}
                onCancel={() => setShowAddDoc(false)}
              />
            ) : null}

            {loading ? (
              <p className="text-xs text-ink-muted">Loading…</p>
            ) : documents.length === 0 ? (
              <p className="italic text-ink-muted">No documents uploaded yet.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    data-testid={`doc-item-${doc.id}`}
                    className="flex items-center justify-between gap-2 py-1.5 min-w-0"
                  >
                    <div
                      className="min-w-0 flex-1 truncate text-[13px] text-ink"
                      title={`${KIND_LABELS[doc.kind] ?? doc.kind} — ${doc.file_name}`}
                    >
                      <span className="font-semibold capitalize">{KIND_LABELS[doc.kind] ?? doc.kind}</span>
                      {' — '}
                      <span className="text-ink-muted">{doc.file_name}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] text-ink-muted whitespace-nowrap">
                        {chunkCountByDocument[doc.id] ?? 0} chunk{(chunkCountByDocument[doc.id] ?? 0) === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteDocument(doc)}
                        disabled={deletingDocId === doc.id}
                        aria-label={`Delete ${doc.file_name}`}
                        title={`Delete ${doc.file_name}`}
                        data-testid={`delete-doc-btn-${doc.id}`}
                        className="border-none bg-transparent text-[12px] font-bold text-delete-text hover:underline cursor-pointer disabled:opacity-50"
                      >
                        {deletingDocId === doc.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

    </div>
  );
}

export default MemoryBank;
