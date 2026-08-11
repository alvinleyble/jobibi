import { describe, it, expect } from 'vitest';
import { detectSensitiveUnion, isSensitiveByRules, isSensitiveByRetrieval, buildProvenanceLine } from './sensitive.ts';
import { SENSITIVE_GOLDEN_SET } from './sensitiveGoldenSet.ts';

describe('sensitive union detector (D17)', () => {
  it('all golden cases match expected union result', () => {
    const failures: string[] = [];
    for (const c of SENSITIVE_GOLDEN_SET) {
      const r = detectSensitiveUnion(c.question, c.facts);
      if (r.isSensitive !== c.expectSensitive) {
        failures.push(`${c.id}: "${c.question}" got isSensitive=${r.isSensitive} expected ${c.expectSensitive} (via=${r.via}, rule=${r.ruleHit?.keyword ?? 'none'}, retrieval=${r.retrievalHit?.score?.toFixed(2) ?? 'none'}) justification: ${c.justification}`);
      } else if (c.expectSensitive && c.expectKind && r.kind !== c.expectKind) {
        failures.push(`${c.id}: kind mismatch got ${r.kind} expected ${c.expectKind}`);
      }
    }
    if (failures.length) console.error(failures.join('\n'));
    expect(failures.length).toBe(0);
  });

  it('oblique (no rule keyword) cases are caught by retrieval alone', () => {
    const oblique = SENSITIVE_GOLDEN_SET.filter((c) => c.tags.includes('oblique') && c.expectSensitive);
    expect(oblique.length).toBeGreaterThanOrEqual(5);
    for (const c of oblique) {
      expect(c.hasRuleKeyword).toBe(false);
      const rule = isSensitiveByRules(c.question);
      expect(rule, `${c.id} should NOT fire rule: ${c.question}`).toBeNull();
      const retr = isSensitiveByRetrieval(c.question, c.facts);
      expect(retr, `${c.id} should fire retrieval: ${c.question}`).not.toBeNull();
      const union = detectSensitiveUnion(c.question, c.facts);
      expect(union.isSensitive).toBe(true);
      expect(union.via).toMatch(/retrieval|both/);
    }
  });

  it('direct keyword cases fire rule', () => {
    const direct = SENSITIVE_GOLDEN_SET.filter((c) => c.tags.includes('direct'));
    for (const c of direct) {
      const rule = isSensitiveByRules(c.question);
      expect(rule, `${c.id} rule should fire`).not.toBeNull();
      expect(detectSensitiveUnion(c.question, c.facts).isSensitive).toBe(true);
    }
  });

  it('non-sensitive questions do not fire either signal', () => {
    const non = SENSITIVE_GOLDEN_SET.filter((c) => c.tags.includes('non-sensitive'));
    for (const c of non) {
      const r = detectSensitiveUnion(c.question, c.facts);
      expect(r.isSensitive, `${c.id} should not be sensitive`).toBe(false);
    }
  });

  it('union is over-inclusive: either signal suffices', () => {
    // rule fires, retrieval does not -> still sensitive
    const q = 'What is your salary?';
    const facts = [{ id: 'f1', kind: 'salary' as const, value: '₱10', stated_at: '2026-01-01T00:00:00Z' }];
    // Give facts of different kind so retrieval for salary won't fire? Actually retrieval would still fire for salary
    // Use location facts only, so salary retrieval cannot fire (no salary fact)
    const locOnly = [{ id: 'f2', kind: 'location' as const, value: 'Manila', stated_at: '2026-01-01T00:00:00Z' }];
    const rule = isSensitiveByRules(q);
    const retr = isSensitiveByRetrieval(q, locOnly);
    expect(rule).not.toBeNull();
    expect(retr).toBeNull(); // no salary fact, so retrieval null
    expect(detectSensitiveUnion(q, locOnly).isSensitive).toBe(true);
    expect(detectSensitiveUnion(q, locOnly).via).toBe('rule');
  });

  it('provenance line formats correctly', () => {
    const line = buildProvenanceLine({ id: 'x', kind: 'salary', value: '₱45,000/month', stated_at: '2026-04-15T00:00:00Z', confirmed_at: null });
    expect(line).toContain('₱45,000/month');
    expect(line).toContain('Apr 2026');
    expect(line).toContain('still true?');
  });

  it('does not mutate gate routing for non-sensitive (regression guard)', () => {
    // Non-sensitive should be detectable as not sensitive, leaving gate to decide draft/ask/refuse.
    // This test is the regression bar: sensitive detector must not mark normal questions sensitive.
    const normal = 'Tell us about a time you led a team under pressure.';
    const facts = [{ id: 'f', kind: 'salary' as const, value: '₱10', stated_at: '2026-01-01T00:00:00Z' }];
    expect(detectSensitiveUnion(normal, facts).isSensitive).toBe(false);
  });
});
