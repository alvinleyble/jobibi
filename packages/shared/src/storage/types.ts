/**
 * S14A storage records — the row shapes every StorageAdapter reads and writes.
 *
 * Field names are snake_case on purpose: they mirror the Postgres columns in
 * `supabase/migrations/` exactly, so the Cloud SaaS adapter can hand
 * PostgREST rows straight back and the Local BYO-Key adapter (PGlite) returns
 * the same shape from the same DDL. A camelCase mapping layer here would be a
 * second place for the two postures to drift.
 *
 * Timestamps are ISO-8601 strings, matching what PostgREST already returns.
 */

import type { DocumentKind } from '../index.ts';
import type { QaOrigin } from '../capture/capture.ts';
import type { GateOutcome } from '../gate/types.ts';

/** memory_chunks.type CHECK values (20260813000001_memory_chunks_qa_pair_type.sql). */
export const MEMORY_CHUNK_TYPES = [
  'experience',
  'skill',
  'story',
  'preference',
  'gap_answer',
  'qa_pair',
] as const;
export type MemoryChunkType = (typeof MEMORY_CHUNK_TYPES)[number];

/** extraction_failures.adapter CHECK values (20260813000000_extraction_failures.sql). */
export const EXTRACTION_FAILURE_ADAPTERS = ['jobstreet', 'linkedin', 'indeed', 'generic'] as const;
export type ExtractionFailureAdapter = (typeof EXTRACTION_FAILURE_ADAPTERS)[number];

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

export interface DocumentRecord {
  id: string;
  user_id: string;
  kind: DocumentKind;
  file_name: string;
  mime_type: string;
  /** Nullable since 20260810001300_documents_storage_path_nullable.sql (pasted text has no file). */
  storage_path: string | null;
  extracted_text: string | null;
  parsed_at: string | null;
  /** D13: `accepted_verbatim` must never feed the voice profile. NULL for pre-S8 rows. */
  origin: QaOrigin | null;
  created_at: string;
}

export interface InsertDocumentInput {
  id?: string;
  user_id: string;
  kind: DocumentKind;
  file_name: string;
  mime_type: string;
  storage_path?: string | null;
  extracted_text?: string | null;
  parsed_at?: string | null;
  origin?: QaOrigin | null;
}

// ---------------------------------------------------------------------------
// memory_chunks
// ---------------------------------------------------------------------------

export interface MemoryChunkRecord {
  id: string;
  user_id: string;
  document_id: string | null;
  chunk_index: number;
  type: MemoryChunkType;
  text: string;
  /** 384-dim gte-small vector (D5c), or null when embedding failed at write time. */
  embedding: number[] | null;
  freshness_at: string | null;
  created_at: string;
}

export interface InsertMemoryChunkInput {
  id?: string;
  user_id: string;
  document_id?: string | null;
  chunk_index: number;
  type?: MemoryChunkType;
  text: string;
  embedding?: number[] | null;
  freshness_at?: string | null;
}

// ---------------------------------------------------------------------------
// qa_pairs
// ---------------------------------------------------------------------------

export interface QAPairRecord {
  id: string;
  user_id: string;
  application_id: string | null;
  question_label: string;
  question_norm: string;
  answer_text: string;
  draft_text: string | null;
  origin: QaOrigin;
  edit_distance: number;
  embedding: number[] | null;
  created_at: string;
}

export interface InsertQAPairInput {
  id?: string;
  user_id: string;
  application_id?: string | null;
  question_label: string;
  question_norm: string;
  answer_text: string;
  draft_text?: string | null;
  origin: QaOrigin;
  edit_distance?: number;
  embedding?: number[] | null;
}

// ---------------------------------------------------------------------------
// style_profile
// ---------------------------------------------------------------------------

export interface StyleProfileRecord {
  user_id: string;
  profile_md: string | null;
  generated_at: string | null;
  corpus_size: number;
  rebuilding: boolean;
  rebuilding_started_at: string | null;
  batch_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertStyleProfileInput {
  user_id: string;
  profile_md?: string | null;
  generated_at?: string | null;
  corpus_size?: number;
  rebuilding?: boolean;
  rebuilding_started_at?: string | null;
  batch_job_id?: string | null;
}

// ---------------------------------------------------------------------------
// Telemetry / audit (write-only from the adapter's point of view)
// ---------------------------------------------------------------------------

/** D15: every gate decision is logged with both axes and what the user did next. */
export interface InsertGateDecisionInput {
  user_id: string;
  application_id?: string | null;
  question_norm: string;
  question_match: number;
  role_match: number;
  outcome: GateOutcome;
  user_action?: string | null;
}

export interface InsertExtractionFailureInput {
  user_id: string;
  adapter: ExtractionFailureAdapter;
  host: string;
  url?: string | null;
  url_hash?: string | null;
  detected_fields?: number;
  extracted_questions?: number;
  failure_reason?: string | null;
}

/** D16: a dropped write because the re-derived mapping disagreed with the original. */
export interface InsertCaptureMismatchInput {
  user_id: string;
  application_id?: string | null;
  question_label: string;
  original_mapping?: unknown;
  rederived_mapping?: unknown;
  reason: string;
}

// ---------------------------------------------------------------------------
// Hybrid retrieval
// ---------------------------------------------------------------------------

/** A memory chunk with the three scores that produced its rank. */
export interface ScoredChunk {
  chunk: MemoryChunkRecord;
  /** Cosine similarity against the query embedding, 0–1. Falls back to `keywordScore` when either side has no embedding. */
  vectorScore: number;
  /** Query-token overlap against the chunk text, 0–1. */
  keywordScore: number;
  /** `0.7 * vectorScore + 0.3 * keywordScore` — the weighting in `gate/retrieve.ts`. */
  score: number;
}

export interface SearchHybridParams {
  /** Cloud SaaS leaves this unset and lets RLS scope the read; Local BYO-Key has no RLS, so it filters explicitly. */
  userId?: string;
  /** Raw question text — tokenized for the keyword half. */
  query: string;
  /** 384-dim gte-small embedding of `query`. Pass `[]` when embedding was unavailable; scoring degrades to keyword-only. */
  queryEmbedding: number[];
  /** Rows returned after ranking. Default 8, matching the retrieval window `suggest` uses. */
  limit?: number;
  /** Floor on the hybrid score: chunks below it are dropped. Default 0 (keep everything). */
  roleMatchThreshold?: number;
}
