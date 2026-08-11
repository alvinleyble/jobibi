import { describe, it, expect } from 'vitest';
import { GOLDEN_SET } from './goldenSet.ts';
import { goldenSetSchema } from './types.ts';

describe('goldenSet', () => {
  it('passes zod schema (50–60 cases, every field valid)', () => {
    const result = goldenSetSchema.safeParse(GOLDEN_SET);
    if (!result.success) {
      // Print first few issues for debugging
      console.error(result.error.issues.slice(0, 5));
    }
    expect(result.success).toBe(true);
  });

  it('has 50 cases', () => {
    expect(GOLDEN_SET.length).toBe(50);
  });

  it('ids are unique and sorted G001..G050', () => {
    const ids = GOLDEN_SET.map((c) => c.id);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toEqual([...ids].sort());
    expect(ids[0]).toBe('G001');
    expect(ids[49]).toBe('G050');
  });

  it('covers all three outcomes', () => {
    const counts = {
      draft: GOLDEN_SET.filter((c) => c.expectedOutcome === 'draft').length,
      ask: GOLDEN_SET.filter((c) => c.expectedOutcome === 'ask').length,
      refuse: GOLDEN_SET.filter((c) => c.expectedOutcome === 'refuse').length,
    };
    expect(counts.draft).toBeGreaterThanOrEqual(15);
    expect(counts.ask).toBeGreaterThanOrEqual(12);
    expect(counts.refuse).toBeGreaterThanOrEqual(12);
    // Exact distribution is 18/16/16 — assert to catch accidental edits
    expect(counts).toEqual({ draft: 18, ask: 16, refuse: 16 });
  });

  it('every justification names the axes (q-high/r-high or q-low etc.)', () => {
    for (const c of GOLDEN_SET) {
      expect(c.justification.toLowerCase()).toMatch(/q-(high|low)/);
    }
  });

  it('has the hard case: q-high + r-low → ask (strong story, wrong family)', () => {
    const hardAsk = GOLDEN_SET.filter((c) => c.tags?.includes('q-high-r-low'));
    expect(hardAsk.length).toBeGreaterThanOrEqual(5);
    for (const c of hardAsk) expect(c.expectedOutcome).toBe('ask');
  });

  it('has an absolute-floor case (empty memory → refuse)', () => {
    const empty = GOLDEN_SET.find((c) => c.tags?.includes('absolute-floor'));
    expect(empty).toBeDefined();
    expect(empty!.memoryChunks.length).toBe(0);
    expect(empty!.expectedOutcome).toBe('refuse');
  });

  it('no case is both empty memory and draft', () => {
    for (const c of GOLDEN_SET) {
      if (c.memoryChunks.length === 0) expect(c.expectedOutcome).toBe('refuse');
    }
  });

  it('questions look like real employer questions (>=10 chars)', () => {
    for (const c of GOLDEN_SET) {
      expect(c.question.length).toBeGreaterThanOrEqual(10);
    }
  });
});
