/**
 * Cloud SaaS posture: `StorageAdapter` over remote Supabase Postgres.
 *
 * This adapter deliberately adds nothing on top of the queries the extension
 * and Edge Functions already run — same tables, same columns, same reliance on
 * RLS to scope every read to the caller's own rows. The client is injected so
 * the extension keeps owning session/auth and the adapter stays testable
 * against a stub.
 *
 * `searchHybrid` scores in TypeScript over a candidate pool rather than in SQL,
 * because that is what actually runs today: `suggest` and `draft-cover-letter`
 * attempt a `match_memory_chunks` RPC that has no migration behind it and fall
 * through to exactly this path. Moving the weighting into SQL here would change
 * live ranking behaviour, which is not what S14A is for.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseEmbedding } from './embedding.ts';
import { DEFAULT_SEARCH_LIMIT, rankChunks } from './hybrid.ts';
import type { StorageAdapter, StoragePosture } from './storageAdapter.ts';
import type {
  DocumentRecord,
  InsertCaptureMismatchInput,
  InsertDocumentInput,
  InsertExtractionFailureInput,
  InsertGateDecisionInput,
  InsertMemoryChunkInput,
  InsertQAPairInput,
  MemoryChunkRecord,
  QAPairRecord,
  ScoredChunk,
  SearchHybridParams,
  StyleProfileRecord,
  UpsertStyleProfileInput,
} from './types.ts';

/**
 * How many chunks are pulled before ranking. Matches the `.limit(100)` the
 * Edge Functions use, so cloud retrieval sees the same candidate window.
 */
export const SUPABASE_CANDIDATE_POOL = 100;

/** Minimal shape of a PostgREST error — enough to report without importing the class. */
interface PostgrestErrorLike {
  message: string;
}

function fail(operation: string, error: PostgrestErrorLike | null): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

function toDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    kind: row.kind as DocumentRecord['kind'],
    file_name: row.file_name as string,
    mime_type: row.mime_type as string,
    storage_path: (row.storage_path as string | null) ?? null,
    extracted_text: (row.extracted_text as string | null) ?? null,
    parsed_at: (row.parsed_at as string | null) ?? null,
    origin: (row.origin as DocumentRecord['origin']) ?? null,
    created_at: row.created_at as string,
  };
}

function toMemoryChunk(row: Record<string, unknown>): MemoryChunkRecord {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    document_id: (row.document_id as string | null) ?? null,
    chunk_index: Number(row.chunk_index ?? 0),
    type: (row.type as MemoryChunkRecord['type']) ?? 'experience',
    text: row.text as string,
    embedding: parseEmbedding(row.embedding),
    freshness_at: (row.freshness_at as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

function toQAPair(row: Record<string, unknown>): QAPairRecord {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    application_id: (row.application_id as string | null) ?? null,
    question_label: row.question_label as string,
    question_norm: row.question_norm as string,
    answer_text: row.answer_text as string,
    draft_text: (row.draft_text as string | null) ?? null,
    origin: row.origin as QAPairRecord['origin'],
    edit_distance: Number(row.edit_distance ?? 0),
    embedding: parseEmbedding(row.embedding),
    created_at: row.created_at as string,
  };
}

function toStyleProfile(row: Record<string, unknown>): StyleProfileRecord {
  return {
    user_id: row.user_id as string,
    profile_md: (row.profile_md as string | null) ?? null,
    generated_at: (row.generated_at as string | null) ?? null,
    corpus_size: Number(row.corpus_size ?? 0),
    rebuilding: Boolean(row.rebuilding),
    rebuilding_started_at: (row.rebuilding_started_at as string | null) ?? null,
    batch_job_id: (row.batch_job_id as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Drop keys the caller left undefined so Postgres column defaults apply. */
function defined<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class SupabaseStorageAdapter implements StorageAdapter {
  readonly posture: StoragePosture = 'cloud';

  // Untyped client: this repo has no generated Database types, and the tables
  // here are addressed by name exactly as the existing call sites do.
  private readonly db: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.db = client;
  }

  // documents ---------------------------------------------------------------

  async getDocuments(userId?: string): Promise<DocumentRecord[]> {
    let query = this.db.from('documents').select('*').order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    fail('getDocuments', error);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toDocument);
  }

  async getDocumentById(id: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.db.from('documents').select('*').eq('id', id).maybeSingle();
    fail('getDocumentById', error);
    return data ? toDocument(data as Record<string, unknown>) : null;
  }

  async insertDocument(doc: InsertDocumentInput): Promise<DocumentRecord> {
    const { data, error } = await this.db
      .from('documents')
      .insert(defined({ ...doc }))
      .select('*')
      .single();
    fail('insertDocument', error);
    return toDocument(data as Record<string, unknown>);
  }

  async deleteDocument(id: string, userId?: string): Promise<void> {
    let query = this.db.from('documents').delete().eq('id', id);
    if (userId) query = query.eq('user_id', userId);
    const { error } = await query;
    fail('deleteDocument', error);
  }

  // memory chunks -----------------------------------------------------------

  async getMemoryChunks(documentId: string): Promise<MemoryChunkRecord[]> {
    const { data, error } = await this.db
      .from('memory_chunks')
      .select('*')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true });
    fail('getMemoryChunks', error);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toMemoryChunk);
  }

  async insertMemoryChunks(chunks: InsertMemoryChunkInput[]): Promise<MemoryChunkRecord[]> {
    if (chunks.length === 0) return [];
    const { data, error } = await this.db
      .from('memory_chunks')
      .insert(chunks.map((c) => defined({ ...c })))
      .select('*');
    fail('insertMemoryChunks', error);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toMemoryChunk);
  }

  async deleteMemoryChunksByDocumentId(documentId: string, userId?: string): Promise<void> {
    let query = this.db.from('memory_chunks').delete().eq('document_id', documentId);
    if (userId) query = query.eq('user_id', userId);
    const { error } = await query;
    fail('deleteMemoryChunksByDocumentId', error);
  }

  async searchHybrid(params: SearchHybridParams): Promise<ScoredChunk[]> {
    const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
    let query = this.db
      .from('memory_chunks')
      .select('*')
      .limit(Math.max(SUPABASE_CANDIDATE_POOL, limit));
    if (params.userId) query = query.eq('user_id', params.userId);
    const { data, error } = await query;
    fail('searchHybrid', error);
    const chunks = ((data as Record<string, unknown>[] | null) ?? []).map(toMemoryChunk);
    const embedding = params.queryEmbedding.length ? params.queryEmbedding : null;
    return rankChunks(chunks, params.query, embedding, limit, params.roleMatchThreshold ?? 0);
  }

  // q&a pairs ---------------------------------------------------------------

  async getQAPairs(userId?: string): Promise<QAPairRecord[]> {
    let query = this.db.from('qa_pairs').select('*').order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    fail('getQAPairs', error);
    return ((data as Record<string, unknown>[] | null) ?? []).map(toQAPair);
  }

  async insertQAPair(qa: InsertQAPairInput): Promise<QAPairRecord> {
    const { data, error } = await this.db
      .from('qa_pairs')
      .insert(defined({ ...qa }))
      .select('*')
      .single();
    fail('insertQAPair', error);
    return toQAPair(data as Record<string, unknown>);
  }

  async deleteQAPair(id: string, userId?: string): Promise<void> {
    let query = this.db.from('qa_pairs').delete().eq('id', id);
    if (userId) query = query.eq('user_id', userId);
    const { error } = await query;
    fail('deleteQAPair', error);
  }

  async getQAPairsCount(userId?: string): Promise<number> {
    let query = this.db.from('qa_pairs').select('id', { count: 'exact', head: true });
    if (userId) query = query.eq('user_id', userId);
    const { count, error } = await query;
    fail('getQAPairsCount', error);
    return count ?? 0;
  }

  // style profile -----------------------------------------------------------

  async getStyleProfile(userId?: string): Promise<StyleProfileRecord | null> {
    let query = this.db.from('style_profile').select('*');
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.maybeSingle();
    fail('getStyleProfile', error);
    return data ? toStyleProfile(data as Record<string, unknown>) : null;
  }

  async upsertStyleProfile(profile: UpsertStyleProfileInput): Promise<StyleProfileRecord> {
    const { data, error } = await this.db
      .from('style_profile')
      .upsert(defined({ ...profile }), { onConflict: 'user_id' })
      .select('*')
      .single();
    fail('upsertStyleProfile', error);
    return toStyleProfile(data as Record<string, unknown>);
  }

  // telemetry & audit -------------------------------------------------------

  async logGateDecision(decision: InsertGateDecisionInput): Promise<void> {
    const { error } = await this.db.from('gate_decisions').insert(defined({ ...decision }));
    fail('logGateDecision', error);
  }

  async logExtractionFailure(failure: InsertExtractionFailureInput): Promise<void> {
    const { error } = await this.db.from('extraction_failures').insert(defined({ ...failure }));
    fail('logExtractionFailure', error);
  }

  async logCaptureMismatch(mismatch: InsertCaptureMismatchInput): Promise<void> {
    const { error } = await this.db.from('capture_mismatches').insert(defined({ ...mismatch }));
    fail('logCaptureMismatch', error);
  }
}
