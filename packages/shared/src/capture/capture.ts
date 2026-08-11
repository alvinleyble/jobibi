/**
 * S6 capture helpers (D12/D13/D16).
 * - origin + edit_distance derived by diffing draft_text vs submitted
 * - mapping verification re-derives and compares
 * - seen-before near-duplicate detection
 */

import type { ExtractedQuestion } from '../adapters/types.ts';
import { normalizeQuestion } from '../gate/normalize.ts';
import { keywordOverlap, cosine, hybridScore } from '../gate/retrieve.ts';

// ---------------------------------------------------------------------------
// Levenshtein distance (used for edit_distance + origin)
// ---------------------------------------------------------------------------
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        dp[j] = prev;
      } else {
        dp[j] = Math.min(prev, dp[j]!, dp[j - 1]!) + 1;
      }
      prev = tmp!;
    }
  }
  return dp[n]!;
}

// ---------------------------------------------------------------------------
// Origin derivation (D13)
// ---------------------------------------------------------------------------
export type QaOrigin = 'user_written' | 'user_edited' | 'accepted_verbatim';

export interface OriginResult {
  origin: QaOrigin;
  editDistance: number;
}

/**
 * Derive origin by diffing offered draft against what was submitted.
 * - no draft / empty draft => user_written
 * - trimmed equality => accepted_verbatim (edit 0)
 * - otherwise => user_edited
 * edit_distance is levenshtein over trimmed strings.
 */
export function deriveOrigin(
  draftText: string | null | undefined,
  submitted: string,
): OriginResult {
  const draftTrimmed = (draftText ?? '').trim();
  const subTrimmed = (submitted ?? '').trim();

  if (!draftTrimmed) {
    // user wrote without any offer; distance is length of submitted vs empty
    return { origin: 'user_written', editDistance: levenshtein('', subTrimmed) };
  }

  const dist = levenshtein(draftTrimmed, subTrimmed);
  if (dist === 0) {
    return { origin: 'accepted_verbatim', editDistance: 0 };
  }
  return { origin: 'user_edited', editDistance: dist };
}

// ---------------------------------------------------------------------------
// Mapping verification (D16)
// ---------------------------------------------------------------------------
export interface MappingVerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify that a single original mapping agrees with a re-derived mapping entry.
 * `fresh` is the re-derived question found by id (or undefined if missing).
 * Agreement requires: same id present, same normalized label, same selector.
 * On mismatch, caller must drop the write and log it.
 */
export function verifySingleMapping(
  original: ExtractedQuestion,
  fresh: ExtractedQuestion | undefined,
): MappingVerifyResult {
  if (!fresh) {
    return { ok: false, reason: `missing in re-derived mapping (id ${original.id})` };
  }
  const normOrig = normalizeQuestion(original.label);
  const normFresh = normalizeQuestion(fresh.label);
  if (normOrig !== normFresh) {
    return {
      ok: false,
      reason: `label mismatch: "${original.label}" vs "${fresh.label}"`,
    };
  }
  if (original.field.selector !== fresh.field.selector) {
    return {
      ok: false,
      reason: `selector mismatch: "${original.field.selector}" vs "${fresh.field.selector}" for "${original.label}"`,
    };
  }
  // Also check field id/name consistency when present
  if ((original.field.id || fresh.field.id) && original.field.id !== fresh.field.id) {
    return { ok: false, reason: `field id mismatch for "${original.label}"` };
  }
  return { ok: true };
}

/**
 * Verify full capture set: original mapping (used at suggestion) vs fresh mapping (re-derived at capture).
 * Returns per-question results.
 */
export function verifyCaptureMappings(
  original: ExtractedQuestion[],
  fresh: ExtractedQuestion[],
): Map<string, MappingVerifyResult> {
  const freshById = new Map<string, ExtractedQuestion>(fresh.map((q) => [q.id, q]));
  const out = new Map<string, MappingVerifyResult>();
  for (const oq of original) {
    out.set(oq.id, verifySingleMapping(oq, freshById.get(oq.id)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seen-before helpers (D12)
// ---------------------------------------------------------------------------
export const NEAR_DUPLICATE_KEYWORD_THRESHOLD = 0.8;
export const NEAR_DUPLICATE_HYBRID_THRESHOLD = 0.85;

export interface QaPairRow {
  id: string;
  question_label: string;
  question_norm: string;
  answer_text: string;
  draft_text?: string | null;
  origin?: QaOrigin;
  application_id?: string | null;
  embedding?: number[] | string | null;
}

/**
 * Score how similar a new question is to a stored qaPair.
 * Uses hybrid of cosine (if embeddings available) and keyword overlap.
 * Returns hybrid score 0-1.
 */
export function scoreNearDuplicate(
  question: string,
  qaPair: QaPairRow,
  opts?: { questionEmbedding?: number[] | null; roleEmbedding?: never },
): number {
  const kw = keywordOverlap(question, qaPair.question_label);
  let cos = kw;
  if (opts?.questionEmbedding) {
    const emb = parseEmbedding(qaPair.embedding);
    if (emb) {
      try {
        cos = cosine(opts.questionEmbedding, emb);
        if (!Number.isFinite(cos)) cos = kw;
      } catch {
        cos = kw;
      }
    }
  }
  // If embedding available for qa pair as string, also try parsed
  // hybrid weights match retrieve.ts (0.7 cosine, 0.3 keyword)
  return hybridScore(cos, kw);
}

function parseEmbedding(e: unknown): number[] | null {
  if (!e) return null;
  if (Array.isArray(e)) return e as number[];
  if (typeof e === 'string') {
    try {
      const p = JSON.parse(e);
      if (Array.isArray(p)) return p as number[];
    } catch {
      // try comma split
    }
    const nums = (e as string).replace(/^\[|\]$/g, '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
    if (nums.length) return nums;
  }
  return null;
}

/**
 * Pick the best prior answer for a question, if any passes threshold.
 */
export function findSeenBefore(
  question: string,
  candidates: QaPairRow[],
  opts?: { questionEmbedding?: number[] | null; threshold?: number },
): { best: QaPairRow; score: number } | null {
  const threshold = opts?.threshold ?? NEAR_DUPLICATE_HYBRID_THRESHOLD;
  let best: QaPairRow | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const s = scoreNearDuplicate(question, c, { questionEmbedding: opts?.questionEmbedding ?? null });
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (best && bestScore >= threshold) return { best, score: bestScore };
  // fallback: very high keyword overlap alone also qualifies (no embedding)
  if (best && keywordOverlap(question, best.question_label) >= NEAR_DUPLICATE_KEYWORD_THRESHOLD) {
    return { best, score: bestScore };
  }
  return null;
}
