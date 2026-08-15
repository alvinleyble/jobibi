/**
 * Vector (de)serialization shared by both storage postures.
 *
 * pgvector columns come back as a string (`"[0.1,0.2,...]"`) over PostgREST and
 * over PGlite's wire protocol alike, but the extension already has code paths
 * that hand back a real `number[]`. Both adapters funnel through `parseEmbedding`
 * so a chunk read from Supabase and the same chunk read from PGlite are
 * indistinguishable to the gate.
 */

/** Normalize a pgvector value (string, array, or null) into `number[] | null`. */
export function parseEmbedding(value: unknown): number[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const nums = value.map(Number).filter((n) => Number.isFinite(n));
    return nums.length ? nums : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const nums = (parsed as unknown[]).map(Number).filter((n) => Number.isFinite(n));
        if (nums.length) return nums;
      }
    } catch {
      // fall through to the manual comma-split parse below
    }
    const nums = trimmed
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    return nums.length ? nums : null;
  }
  return null;
}

/** Render an embedding as the `[1,2,3]` literal pgvector's input parser expects. */
export function toVectorLiteral(embedding: number[] | null | undefined): string | null {
  if (!embedding || embedding.length === 0) return null;
  return `[${embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}
