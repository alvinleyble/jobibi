/**
 * S14A storage layer — the two-posture seam (Cloud SaaS / Local BYO-Key).
 *
 * This is the complete surface, PGlite adapter included. The package barrel
 * (`../index.ts`) re-exports everything here *except* `PGliteStorageAdapter`:
 * naming it from the barrel makes Vite emit ~16 MB of PGlite WASM into the
 * extension output whether or not anything opens a local database. Import this
 * module by path when you need the local posture.
 */

export type { StorageAdapter, StoragePosture } from './storageAdapter.ts';

export {
  MEMORY_CHUNK_TYPES,
  EXTRACTION_FAILURE_ADAPTERS,
} from './types.ts';
export type {
  DocumentRecord,
  ExtractionFailureAdapter,
  InsertCaptureMismatchInput,
  InsertDocumentInput,
  InsertExtractionFailureInput,
  InsertGateDecisionInput,
  InsertMemoryChunkInput,
  InsertQAPairInput,
  MemoryChunkRecord,
  MemoryChunkType,
  QAPairRecord,
  ScoredChunk,
  SearchHybridParams,
  StyleProfileRecord,
  UpsertStyleProfileInput,
} from './types.ts';

export { parseEmbedding, toVectorLiteral } from './embedding.ts';
export {
  DEFAULT_SEARCH_LIMIT,
  HYBRID_KEYWORD_WEIGHT,
  HYBRID_VECTOR_WEIGHT,
  queryTokens,
  rankChunks,
  scoreChunk,
} from './hybrid.ts';
export { LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION } from './localSchema.ts';

export { SupabaseStorageAdapter, SUPABASE_CANDIDATE_POOL } from './supabaseStorageAdapter.ts';
export {
  PGliteStorageAdapter,
  IN_MEMORY_DATA_DIR,
  LOCAL_MEMORY_DATA_DIR,
} from './pgliteStorageAdapter.ts';
export type { PGliteStorageAdapterOptions } from './pgliteStorageAdapter.ts';
