/**
 * S5a retrieve helpers: embedding in Edge Function is done via Supabase.ai.Session('gte-small'),
 * so scoring here is just cosine helpers the gate can use. Hybrid search in SQL does
 * vector + keyword; these helpers are the testable, offline part.
 */

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Token overlap (keyword) score 0–1 for small corpora fallback. */
export function keywordOverlap(question: string, chunkText: string): number {
  const qTokens = new Set(question.toLowerCase().split(/\W+/).filter(Boolean));
  if (qTokens.size === 0) return 0;
  const cTokens = new Set(chunkText.toLowerCase().split(/\W+/).filter(Boolean));
  let hit = 0;
  for (const t of qTokens) if (cTokens.has(t)) hit++;
  return hit / qTokens.size;
}

/** Hybrid score: weighted cosine + keyword (weights match SQL hybrid). */
export function hybridScore(cosineScore: number, keywordScore: number): number {
  return 0.7 * cosineScore + 0.3 * keywordScore;
}
