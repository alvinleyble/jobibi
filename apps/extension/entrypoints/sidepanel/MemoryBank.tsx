import { useCallback, useEffect, useState } from 'react';
import { SENSITIVE_FACT_KINDS, type DocumentKind, type SensitiveFactKind } from '@jobibi/shared';
import { supabase } from './supabase';
import UploadDocument from './UploadDocument';
import DraftCoverLetter from './DraftCoverLetter';

interface DocumentRow {
  id: string;
  kind: DocumentKind;
  file_name: string;
  created_at: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
}

interface FactRow {
  kind: SensitiveFactKind;
  value: string;
  stated_at: string;
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

const FACT_LABELS: Record<SensitiveFactKind, string> = {
  salary: 'Salary expectation',
  notice_period: 'Notice period',
  work_authorization: 'Work authorization',
  location: 'Location',
};

interface MemoryBankProps {
  userId: string;
}

export function MemoryBank({ userId }: MemoryBankProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [qaPairs, setQaPairs] = useState<QaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingQaId, setDeletingQaId] = useState<string | null>(null);

  // Accordion open/close state (collapsed by default)
  const [docsOpen, setDocsOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [documentsRes, chunksRes, factsRes, qaRes] = await Promise.all([
      supabase.from('documents').select('id, kind, file_name, created_at').order('created_at', { ascending: false }),
      supabase.from('memory_chunks').select('id, document_id'),
      supabase.from('sensitive_facts').select('kind, value, stated_at').order('stated_at', { ascending: false }),
      supabase.from('qa_pairs').select('id, question_label, answer_text, origin, created_at').order('created_at', { ascending: false }),
    ]);

    if (!documentsRes.error) setDocuments(documentsRes.data ?? []);
    if (!chunksRes.error) setChunks(chunksRes.data ?? []);
    if (!factsRes.error) setFacts(factsRes.data ?? []);
    if (!qaRes.error) setQaPairs(qaRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const latestFactByKind = SENSITIVE_FACT_KINDS.reduce<Partial<Record<SensitiveFactKind, FactRow>>>((acc, kind) => {
    acc[kind] = facts.find((fact) => fact.kind === kind);
    return acc;
  }, {});

  return (
    <div data-screen-label="Memory" className="flex flex-col gap-3">
      {/* 1. Upload Dropzone */}
      <UploadDocument userId={userId} onIngested={refresh} />

      {/* 2. Draft Cover Letter Card */}
      <DraftCoverLetter onStored={refresh} />

      {/* 3. Stored Answers Card */}
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

      {/* 4. Collapsible Accordion: Uploaded Documents */}
      <div className="rounded-[10px] border border-card-border bg-card px-3.5 py-1">
        <button
          type="button"
          onClick={() => setDocsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between border-none bg-transparent py-2.5 text-left cursor-pointer"
        >
          <span className="text-[13.5px] font-bold text-ink">
            Documents · {documents.length}
          </span>
          <span className="text-[12px] text-ink-muted">{docsOpen ? '▾' : '▸'}</span>
        </button>
        {docsOpen ? (
          <div className="flex flex-col gap-1 pb-2.5 text-[12.5px] text-ink-secondary">
            {documents.length === 0 ? (
              <p className="italic text-ink-muted">No documents uploaded yet.</p>
            ) : (
              documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between">
                  <span>
                    {KIND_LABELS[doc.kind]} — {doc.file_name}
                  </span>
                  <span className="text-[11px] text-ink-muted">
                    {chunkCountByDocument[doc.id] ?? 0} chunk{(chunkCountByDocument[doc.id] ?? 0) === 1 ? '' : 's'}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* 5. Collapsible Accordion: Sensitive Facts */}
      <div className="rounded-[10px] border border-card-border bg-card px-3.5 py-1">
        <button
          type="button"
          onClick={() => setFactsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between border-none bg-transparent py-2.5 text-left cursor-pointer"
        >
          <span className="text-[13.5px] font-bold text-ink">Sensitive facts</span>
          <span className="text-[12px] text-ink-muted">{factsOpen ? '▾' : '▸'}</span>
        </button>
        {factsOpen ? (
          <div className="flex flex-col gap-1.5 pb-2.5 text-[12.5px] text-ink-secondary">
            {SENSITIVE_FACT_KINDS.map((kind) => {
              const fact = latestFactByKind[kind];
              return (
                <div key={kind} className="flex items-center justify-between">
                  <span className="font-semibold text-ink">{FACT_LABELS[kind]}</span>
                  {fact ? (
                    <span className="text-ink-secondary">{fact.value}</span>
                  ) : (
                    <span className="italic text-ink-disabled">not set</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MemoryBank;
