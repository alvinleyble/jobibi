import { useCallback, useEffect, useMemo, useState } from 'react';
import { type DocumentKind, groupQaPairs, normalizeQuestion } from '@jobibi/shared';
import type { QaPairRow } from '@jobibi/shared';
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
      await supabase
        .from('memory_chunks')
        .delete()
        .eq('user_id', userId)
        .eq('type', 'qa_pair')
        .eq('text', `Q: ${qa.question_label}\nA: ${qa.answer_text}`);
      await supabase.from('qa_pairs').delete().eq('id', qa.id).eq('user_id', userId);
      await refresh();
    } catch (e) {
      console.error('Failed to delete QA pair:', e);
    } finally {
      setDeletingQaId(null);
    }
  };

  const deleteQaGroup = async (group: { questionLabel: string; items: QaRow[]; normalizedQuestion: string }) => {
    const groupId = group.items[0]?.id ?? group.normalizedQuestion;
    setDeletingQaId(groupId);
    try {
      // Delete all qa_pairs rows in the group
      const ids = group.items.map((i) => i.id);
      if (ids.length) {
        await supabase.from('qa_pairs').delete().in('id', ids).eq('user_id', userId);
      }
      // Purge associated memory_chunks entries (D12)
      // Fetch candidate chunks and match against every item in the group,
      // not just the group's representative normalized question — near-duplicate
      // grouping can fold items whose own normalized questions differ.
      const { data: chunkRows } = await supabase
        .from('memory_chunks')
        .select('id, text')
        .eq('user_id', userId)
        .eq('type', 'qa_pair');
      const itemNorms = new Set(group.items.map((qa) => normalizeQuestion(qa.question_label)));
      const itemTexts = new Set(group.items.map((qa) => `Q: ${qa.question_label}\nA: ${qa.answer_text}`));
      const toDelete: string[] = [];
      if (chunkRows) {
        for (const ch of chunkRows as Array<{ id: string; text: string }>) {
          const qPart = ch.text.startsWith('Q: ') ? (ch.text.split('\nA:')[0]?.slice(2).trim() ?? ch.text) : ch.text;
          if (itemNorms.has(normalizeQuestion(qPart)) || itemTexts.has(ch.text)) toDelete.push(ch.id);
        }
      }
      if (toDelete.length) {
        await supabase.from('memory_chunks').delete().in('id', toDelete);
      }
      // Fallback direct text-equality deletes per item, covering the case where the fetch above failed or missed rows.
      for (const qa of group.items) {
        await supabase
          .from('memory_chunks')
          .delete()
          .eq('user_id', userId)
          .eq('type', 'qa_pair')
          .eq('text', `Q: ${qa.question_label}\nA: ${qa.answer_text}`);
      }
      await refresh();
    } catch (e) {
      console.error('Failed to delete QA group:', e);
    } finally {
      setDeletingQaId(null);
    }
  };

  const chunkCountByDocument = chunks.reduce<Record<string, number>>((acc, chunk) => {
    acc[chunk.document_id] = (acc[chunk.document_id] ?? 0) + 1;
    return acc;
  }, {});

  // Group QA pairs for deduped UI (identical or near-identical questions)
  const groupedQa = useMemo(() => {
    if (!qaPairs.length) return [];
    // Adapt QaRow to QaPairRow shape expected by groupQaPairs
    const adapted: Array<QaPairRow & { created_at: string; origin: string; answer_text: string; question_label: string }> = qaPairs.map((qa) => ({
      id: qa.id,
      question_label: qa.question_label,
      question_norm: normalizeQuestion(qa.question_label),
      answer_text: qa.answer_text,
      origin: qa.origin as never,
      created_at: qa.created_at,
      embedding: null,
    }));
    return groupQaPairs(adapted);
  }, [qaPairs]);

  return (
    <div data-screen-label="Memory" className="flex flex-col gap-3">
      {/* 1. Draft Cover Letter Card */}
      <DraftCoverLetter onStored={refresh} />

      {/* 2. Stored Answers Card — grouped by normalized question */}
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
            {groupedQa.map((group) => {
              const qa = group.latest as unknown as QaRow;
              const isDeleting = group.items.some((it) => deletingQaId === it.id) || deletingQaId === group.items[0]?.id;
              return (
              <div
                key={group.normalizedQuestion}
                data-testid={`qa-group-${group.normalizedQuestion}`}
                data-group-count={group.count}
                className="flex flex-col rounded-lg border border-card-border bg-subtle p-2.5 text-xs text-left"
              >
                <p className="font-bold text-ink break-words text-[12.5px]">Q: {group.questionLabel}</p>
                <p className="mt-1 text-ink-secondary whitespace-pre-wrap break-words leading-[1.45] text-[12.5px]">
                  A: {qa.answer_text}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-ink-muted">
                    Captured · {new Date(qa.created_at).toLocaleDateString()}
                  </span>
                  <span className="rounded-full bg-card border border-card-border px-2 py-0.5 text-[10.5px] font-semibold text-ink-muted">
                    {qa.origin}
                  </span>
                  {group.count > 1 ? (
                    <span data-testid={`qa-group-badge-${group.normalizedQuestion}`} className="rounded-full bg-accent/10 border border-accent/20 px-2 py-0.5 text-[10.5px] font-semibold text-accent">
                      Used in {group.count} applications
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center justify-end">
                  {/* Preserve per-item test id for backwards compatibility: expose on grouped card */}
                  <span data-testid={`qa-item-${qa.id}`} className="hidden" />
                  <button
                    type="button"
                    onClick={() => {
                      if (group.count > 1) void deleteQaGroup(group as unknown as { questionLabel: string; items: QaRow[]; normalizedQuestion: string });
                      else void deleteQaPair(qa);
                    }}
                    disabled={isDeleting}
                    aria-label={`Delete answer for ${group.questionLabel}`}
                    title="Delete answer"
                    data-testid={`delete-qa-btn-${qa.id}`}
                    className="border-none bg-transparent text-[12px] font-bold text-delete-text hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
              );
            })}
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
