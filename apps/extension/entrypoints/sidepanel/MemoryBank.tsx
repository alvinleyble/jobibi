import { useCallback, useEffect, useState } from 'react';
import { SENSITIVE_FACT_KINDS, type DocumentKind, type SensitiveFactKind } from '@jobibi/shared';
import { supabase } from './supabase';
import UploadDocument from './UploadDocument';
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
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [documentsRes, chunksRes, factsRes] = await Promise.all([
      supabase.from('documents').select('id, kind, file_name, created_at').order('created_at', { ascending: false }),
      supabase.from('memory_chunks').select('id, document_id'),
      supabase.from('sensitive_facts').select('kind, value, stated_at').order('stated_at', { ascending: false }),
    ]);

    if (!documentsRes.error) setDocuments(documentsRes.data ?? []);
    if (!chunksRes.error) setChunks(chunksRes.data ?? []);
    if (!factsRes.error) setFacts(factsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      <Intake userId={userId} onSaved={refresh} />

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
