/**
 * The one definition of hybrid ranking, shared by both storage postures.
 *
 * `gate/retrieve.ts` owns the 0.7 vector / 0.3 keyword weighting; nothing here
 * re-derives it. The Supabase adapter scores in TypeScript over the candidate
 * rows (matching what `supabase/functions/suggest` already does), and the
 * PGlite adapter scores in SQL — so `queryTokens` exists to hand Postgres the
 * *same* token set `keywordOverlap` builds in JS, keeping the two exact rather
 * than approximately equal.
 */

import { cosine, hybridScore, keywordOverlap } from '../gate/retrieve.ts';
import type { MemoryChunkRecord, ScoredChunk } from './types.ts';

/** Rows returned by `searchHybrid` when the caller passes no explicit limit. */
export const DEFAULT_SEARCH_LIMIT = 8;

/**
 * The 0.7/0.3 split, read back out of `hybridScore` rather than restated.
 * The PGlite adapter interpolates these into SQL, so deriving them here is what
 * stops the local posture from drifting if the weighting is ever retuned.
 */
export const HYBRID_VECTOR_WEIGHT = hybridScore(1, 0);
export const HYBRID_KEYWORD_WEIGHT = hybridScore(0, 1);

/**
 * Distinct query tokens, exactly as `keywordOverlap` derives them
 * (lowercase, split on `\W+`, empties dropped).
 */
export function queryTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\W+/).filter(Boolean))];
}

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/**
 * Score one chunk against a query.
 *
 * When either side lacks an embedding the vector axis falls back to the keyword
 * score rather than to 0 — the same degradation `suggest` performs, so a user
 * whose embeddings failed to write still ranks by something meaningful.
 */
export function scoreChunk(
  chunk: MemoryChunkRecord,
  query: string,
  queryEmbedding: number[] | null,
): ScoredChunk {
  const keywordScore = finite(keywordOverlap(query, chunk.text));
  const hasVectors = !!queryEmbedding && queryEmbedding.length > 0 && !!chunk.embedding && chunk.embedding.length > 0;
  const vectorScore = hasVectors ? finite(cosine(queryEmbedding, chunk.embedding!)) : keywordScore;
  return {
    chunk,
    vectorScore,
    keywordScore,
    score: finite(hybridScore(vectorScore, keywordScore)),
  };
}

/**
 * Rank chunks by hybrid score, drop anything under `threshold`, take `limit`.
 * Ties break on chunk id so both adapters agree on ordering for equal scores.
 */
export function rankChunks(
  chunks: MemoryChunkRecord[],
  query: string,
  queryEmbedding: number[] | null,
  limit: number = DEFAULT_SEARCH_LIMIT,
  threshold = 0,
): ScoredChunk[] {
  return chunks
    .map((chunk) => scoreChunk(chunk, query, queryEmbedding))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, limit);
}
