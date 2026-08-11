import { z } from 'zod';

/**
 * S4.5 golden set — types for the gate calibration fixture (D15).
 * Every case is a hand-written (question, memory, expected outcome)
 * triple. No pipeline code lives here; this is data + schema.
 */

export const GATE_OUTCOMES = ['draft', 'ask', 'refuse'] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

export const goldenCaseSchema = z.object({
  /** Stable id, e.g. G001. */
  id: z.string().min(1),
  /** Employer question as it appears on the form. */
  question: z.string().min(10),
  /** Job being applied for — input to role-match. */
  jobContext: z.object({
    role: z.string().min(2),
    company: z.string().min(1),
    description: z.string().optional(),
  }),
  /** Simulated memory_chunks[].text for this user. 0-N entries. */
  memoryChunks: z.array(z.string().min(10)),
  /** Expected gate outcome, justified below. */
  expectedOutcome: z.enum(GATE_OUTCOMES),
  /** One-line justification referencing the two axes (D15 + ARCHITECTURE gate table). */
  justification: z.string().min(20),
  /** Free-form tags for filtering/coverage checks. */
  tags: z.array(z.string()).optional(),
});

export type GoldenCase = z.infer<typeof goldenCaseSchema>;

export const goldenSetSchema = z.array(goldenCaseSchema).min(50).max(60);
