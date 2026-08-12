/**
 * S5a two-axis gate (D15).
 *
 * Relative scoring: compare top hybrid score against that user's own distribution.
 * Absolute floor underneath for genuinely-nothing. Bias toward ask.
 *
 * Inputs are already computed hybrid scores for question-match and role-match.
 * For the golden set, those scores are mocked via simple keyword overlap against
 * memoryChunks — the gate logic itself is deterministic code, never the model.
 */

import type { GateOutcome } from './types.ts';

export interface GateInput {
  /** Sorted descending hybrid scores for question→memory. Empty = no memory. */
  questionScores: number[];
  /** Sorted descending hybrid scores for role→memory. */
  roleScores: number[];
}

export interface GateResult {
  outcome: GateOutcome;
  questionMatch: number; // top q score, 0 if none
  roleMatch: number; // top r score, 0 if none
  reason: string;
}

// Tuning constants — calibrated against 50-case golden set + live headed verification.
// Relative: top must stand X above mean; floor: genuinely-nothing.
// Live gte-small + keyword hybrid scores cluster tighter than synthetic
// (NTT page 7 chunks: q ~0.60, r ~0.72) and headed verification found
// live roleMatch never dropped below 0.51 across 72 question×role combos,
// so ROLE_THRESHOLD=0.35 never reached the ask branch. Recalibrated to
// 0.60 — sits above the observed live floor (0.51) and below matched-role
// hybrids (~0.65–0.80), restoring the ask rate while keeping the bias
// toward ask (D15). Revisit after JobStreet-only gate_decisions telemetry
// accumulates; hybridScore weights (0.7/0.3 in retrieve.ts) remain unchanged
// but are the next knob if cosine baseline shifts with corpus growth or
// embedding model upgrade (D5c).
const ABSOLUTE_FLOOR = 0.25; // below this → refuse regardless of relative gap
const RELATIVE_GAP = 0.04; // top - mean must exceed this for signal (was 0.12, too strict for 7-chunk tight hybrid)
export const ROLE_THRESHOLD = 0.60; // r-high boundary — live-recalibrated from 0.35 (see above)

function top(scores: number[]): number {
  return scores.length ? scores[0] : 0;
}

function mean(scores: number[]): number {
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function hasRelativeSignal(scores: number[]): boolean {
  if (scores.length === 0) return false;
  if (scores.length === 1) return top(scores) >= ABSOLUTE_FLOOR;
  return top(scores) - mean(scores) >= RELATIVE_GAP && top(scores) >= ABSOLUTE_FLOOR;
}

export function decideGate(input: GateInput): GateResult {
  const qTop = top(input.questionScores);
  const rTop = top(input.roleScores);
  const qSignal = hasRelativeSignal(input.questionScores);

  if (!qSignal || qTop < ABSOLUTE_FLOOR) {
    return {
      outcome: 'refuse',
      questionMatch: qTop,
      roleMatch: rTop,
      reason: `q-low (qTop ${qTop.toFixed(2)} < floor ${ABSOLUTE_FLOOR} or no relative gap) → refuse`,
    };
  }

  // q-high: we have material. Now role family's the decider.
  if (rTop >= ROLE_THRESHOLD) {
    return {
      outcome: 'draft',
      questionMatch: qTop,
      roleMatch: rTop,
      reason: `q-high (qTop ${qTop.toFixed(2)}) + r-high (rTop ${rTop.toFixed(2)} ≥ ${ROLE_THRESHOLD}) → draft`,
    };
  }

  return {
    outcome: 'ask',
    questionMatch: qTop,
    roleMatch: rTop,
    reason: `q-high (qTop ${qTop.toFixed(2)}) + r-low (rTop ${rTop.toFixed(2)} < ${ROLE_THRESHOLD}) → ask`,
  };
}

/** Helper for golden-set tests: compute mockScores via keyword overlap. */
export function mockScores(questionOrRole: string, memoryChunks: string[]): number[] {
  const q = questionOrRole.toLowerCase();
  const scores = memoryChunks.map((c) => {
    const overlap = keywordOverlapMock(q, c);
    // Simulate distribution: real embeddings would spread; keep monotonic
    return overlap;
  });
  return scores.sort((a, b) => b - a);
}

function keywordOverlapMock(a: string, b: string): number {
  const aTokens = new Set(a.split(/\W+/).filter(Boolean));
  if (!aTokens.size) return 0;
  const bTokens = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let hit = 0;
  for (const t of aTokens) if (bTokens.has(t)) hit++;
  return hit / aTokens.size;
}
