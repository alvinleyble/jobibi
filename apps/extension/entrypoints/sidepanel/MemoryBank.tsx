import { useCallback, useEffect, useState } from 'react';
import { SENSITIVE_FACT_KINDS, type DocumentKind, type SensitiveFactKind } from '@jobibi/shared';
import { supabase } from './supabase';
import UploadDocument from './UploadDocument';
import DraftCoverLetter from './DraftCoverLetter';
import Intake from './Intake';

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

function MemoryBank({ userId }: MemoryBankProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [qaPairs, setQaPairs] = useState<QaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingQaId, setDeletingQaId] = useState<string | null>(null);

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
    <div className="flex w-full max-w-md flex-col gap-3 p-4">
      <UploadDocument userId={userId} onIngested={refresh} />
      {/* S8: Draft Cover Letter — separate section, not folded into Upload.
          Upload is one-shot ingestion; this is a compose-review-decide
          workflow (paste JD → generate → edit → accept/discard) and does
          not fit the same card. Adapter-independent: works the same on every
          job site. Paste-always (no LinkedIn auto-fill) keeps S8 independent
          of S7; LinkedIn auto-fill is a separable future follow-up. */}
      <DraftCoverLetter onStored={refresh} />
      <Intake userId={userId} onSaved={refresh} />

      {/* Stored Q&A Answers with Per-Answer Deletion (D12) */}
      <div className="flex flex-col gap-2 rounded border border-slate-200 p-3 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Stored Answers (Q&amp;A) ({qaPairs.length})
          </h2>
        </div>
        <p className="text-[10px] text-slate-500">
          Answers captured from your applications or manually entered. Deleting purges them permanently from memory and vector retrieval.
        </p>

        {loading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : qaPairs.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No stored Q&amp;A answers yet.</p>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            {qaPairs.map((qa) => (
              <div
                key={qa.id}
                data-testid={`qa-item-${qa.id}`}
                className="flex items-start justify-between gap-2 rounded border border-slate-200 bg-slate-50 p-2.5 text-xs text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 break-words">Q: {qa.question_label}</p>
                  <p className="mt-1 text-slate-700 whitespace-pre-wrap break-words">A: {qa.answer_text}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                    <span className="rounded bg-white px-1.5 py-0.5 border text-slate-600 font-mono">
                      {qa.origin}
                    </span>
                    <span>{new Date(qa.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteQaPair(qa)}
                  disabled={deletingQaId === qa.id}
                  aria-label={`Delete answer for ${qa.question_label}`}
                  title="Delete answer (purges from vector memory)"
                  data-testid={`delete-qa-btn-${qa.id}`}
                  className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                >
                  {deletingQaId === qa.id ? '…' : '🗑️'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded border border-slate-200 p-3">
        <h2 className="text-sm font-semibold text-slate-900">Memory bank (debug)</h2>
        {loading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (
          <>
            <div>
              <h3 className="text-xs font-medium text-slate-700">
                Documents ({documents.length}), chunks ({chunks.length})
              </h3>
              {documents.length === 0 ? (
                <p className="text-xs text-slate-500">No documents uploaded yet.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {documents.map((doc) => (
                    <li key={doc.id} className="text-xs text-slate-600">
                      <span className="font-medium">{KIND_LABELS[doc.kind]}</span> — {doc.file_name} —{' '}
                      {chunkCountByDocument[doc.id] ?? 0} chunk{(chunkCountByDocument[doc.id] ?? 0) === 1 ? '' : 's'}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-xs font-medium text-slate-700">Sensitive facts</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {SENSITIVE_FACT_KINDS.map((kind) => {
                  const fact = latestFactByKind[kind];
                  return (
                    <li key={kind} className="text-xs text-slate-600">
                      <span className="font-medium">{FACT_LABELS[kind]}:</span>{' '}
                      {fact ? fact.value : <span className="italic text-slate-400">not set</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MemoryBank;
