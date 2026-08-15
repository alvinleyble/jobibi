/**
 * S14A — the seam between Jobibi's two postures.
 *
 * Everything that persists user memory goes through `StorageAdapter`. Cloud
 * SaaS binds it to remote Supabase Postgres under RLS; Local BYO-Key binds it
 * to an in-process Postgres (PGlite + pgvector) that never leaves the browser.
 * Callers must not be able to tell which one they hold — that is the whole
 * point of the interface, and it is what the parity tests in `storage.test.ts`
 * enforce.
 *
 * `userId` is optional on every read/delete: under RLS the caller's JWT already
 * scopes the rows, so Cloud SaaS treats it as a redundant belt-and-braces
 * filter, while the local posture (no RLS, single-user database) uses it when
 * given. Insert inputs always carry `user_id` explicitly — nothing infers it.
 */

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

/** Which posture an adapter implements — surfaced so UI can label where memory lives. */
export type StoragePosture = 'cloud' | 'local';

export interface StorageAdapter {
  /** `'cloud'` for Supabase, `'local'` for PGlite. */
  readonly posture: StoragePosture;

  // documents ---------------------------------------------------------------
  getDocuments(userId?: string): Promise<DocumentRecord[]>;
  getDocumentById(id: string): Promise<DocumentRecord | null>;
  insertDocument(doc: InsertDocumentInput): Promise<DocumentRecord>;
  deleteDocument(id: string, userId?: string): Promise<void>;

  // memory chunks -----------------------------------------------------------
  getMemoryChunks(documentId: string): Promise<MemoryChunkRecord[]>;
  insertMemoryChunks(chunks: InsertMemoryChunkInput[]): Promise<MemoryChunkRecord[]>;
  deleteMemoryChunksByDocumentId(documentId: string, userId?: string): Promise<void>;

  /**
   * Hybrid retrieval: cosine vector similarity blended with keyword overlap at
   * the 0.7/0.3 weighting defined in `gate/retrieve.ts`. Returned highest score
   * first. This feeds the gate, so both postures must rank identically.
   */
  searchHybrid(params: SearchHybridParams): Promise<ScoredChunk[]>;

  // q&a pairs ---------------------------------------------------------------
  getQAPairs(userId?: string): Promise<QAPairRecord[]>;
  insertQAPair(qa: InsertQAPairInput): Promise<QAPairRecord>;
  deleteQAPair(id: string, userId?: string): Promise<void>;
  getQAPairsCount(userId?: string): Promise<number>;

  // style profile -----------------------------------------------------------
  getStyleProfile(userId?: string): Promise<StyleProfileRecord | null>;
  upsertStyleProfile(profile: UpsertStyleProfileInput): Promise<StyleProfileRecord>;

  // telemetry & audit -------------------------------------------------------
  /** D15: both scores, the outcome, and what the user did next. Never silently skipped. */
  logGateDecision(decision: InsertGateDecisionInput): Promise<void>;
  logExtractionFailure(failure: InsertExtractionFailureInput): Promise<void>;
  /** D16: a capture write dropped because the re-derived mapping disagreed. */
  logCaptureMismatch(mismatch: InsertCaptureMismatchInput): Promise<void>;
}
