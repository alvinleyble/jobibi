/**
 * S5c sensitive detection — union semantics (D17).
 *
 * Two independent signals, either one routes to always-confirm instead of drafting:
 *  - Rule-based: keyword/field-type match on the question.
 *  - Retrieval-based: match the question against the user's typed sensitive_facts rows.
 *
 * Union, deliberately over-inclusive. Never narrow to intersection.
 * Excluded from drafting and Auto-Fill at the pipeline level.
 */

import type { SensitiveFactKind } from '../index.ts';

export interface SensitiveFact {
  id: string;
  kind: SensitiveFactKind;
  value: string;
  stated_at: string; // ISO
  confirmed_at?: string | null;
  source_application_id?: string | null;
}

// Canonical rule keywords — deliberately narrow (D17).
// Retrieval covers the long tail (e.g. compensation vs salary).
export const RULE_KEYWORDS: Record<SensitiveFactKind, string[]> = {
  salary: ['salary'],
  notice_period: ['notice period', 'notice'],
  work_authorization: ['work authorization', 'work authorisation', 'visa'],
  location: ['location', 'relocation', 'relocate'],
};

// Broader descriptors for retrieval fallback (when embeddings unavailable).
// In production, gte-small cosine replaces this; keywordOverlap here is the
// deterministic stand-in for tests and offline fallback.
export const RETRIEVAL_DESCRIPTORS: Record<SensitiveFactKind, string> = {
  salary:
    'salary compensation pay remuneration wage ctc package expected desired desired package compensation range targeting amount gross net monthly yearly expectations',
  notice_period:
    'notice period availability available start date soon immediately',
  work_authorization:
    'visa authorization sponsorship authorized permit citizenship nationality eligible legally sponsorship status right work eligibility',
  location:
    'location relocation relocate city address based remote hybrid onsite willing moving move',
};

const STOPWORDS = new Set([
  'what', 'when', 'where', 'why', 'how', 'who', 'which', 'whom', 'whose',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'you', 'your', 'yours', 'we', 'us', 'our', 'i', 'me', 'my',
  'a', 'an', 'the', 'to', 'for', 'of', 'on', 'in', 'at', 'with', 'about', 'as', 'by', 'from', 'up', 'out', 'into',
  'and', 'or', 'but', 'if', 'then', 'so', 'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'am', 'are', 'is', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'open', // 'open' is generic but keep for location? Actually remove: open is too generic, but keep willing
]);

const RETRIEVAL_THRESHOLD = 0.25;

function normalize(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface RuleHit {
  kind: SensitiveFactKind;
  keyword: string;
}

/** Rule-based check: does question contain any canonical keyword? */
export function isSensitiveByRules(question: string): RuleHit | null {
  const n = normalize(question);
  for (const kind of Object.keys(RULE_KEYWORDS) as SensitiveFactKind[]) {
    for (const kw of RULE_KEYWORDS[kind]) {
      if (n.includes(kw.toLowerCase())) {
        return { kind, keyword: kw };
      }
    }
  }
  return null;
}

function keywordOverlapScore(question: string, descriptor: string): number {
  const rawTokens = normalize(question).split(/\W+/).filter(Boolean);
  const filtered = rawTokens.filter((t) => !STOPWORDS.has(t));
  const qTokens = new Set(filtered.length ? filtered : rawTokens);
  if (!qTokens.size) return 0;
  const dTokens = new Set(descriptor.toLowerCase().split(/\W+/).filter(Boolean));
  let hit = 0;
  for (const t of qTokens) {
    if (dTokens.has(t)) {
      hit++;
      continue;
    }
    // Substring / stemming fallback: moving vs move, compensations etc.
    for (const d of dTokens) {
      if (d.length >= 4 && t.length >= 4 && (d.includes(t) || t.includes(d) || (d.endsWith('e') && t === d.slice(0, -1)) || (t.endsWith('ing') && d === t.slice(0, -3)))) {
        hit++;
        break;
      }
    }
  }
  return hit / qTokens.size;
}

export interface RetrievalHit {
  kind: SensitiveFactKind;
  score: number;
  fact: SensitiveFact;
}

/**
 * Retrieval-based check: match question against user's typed facts.
 * Requires at least one fact of a kind to fire for that kind.
 * In production, caller may pass precomputed cosine scores; here we use
 * keyword overlap against descriptor (+ fact value for extra signal).
 */
export function isSensitiveByRetrieval(
  question: string,
  facts: SensitiveFact[],
  opts?: { cosineScores?: Record<string, number>; threshold?: number },
): RetrievalHit | null {
  if (!facts.length) return null;
  const threshold = opts?.threshold ?? RETRIEVAL_THRESHOLD;
  // If caller supplied cosine scores per kind, use those (production path)
  if (opts?.cosineScores) {
    let best: RetrievalHit | null = null;
    for (const f of facts) {
      const s = opts.cosineScores[f.kind];
      if (s != null && s >= threshold) {
        if (!best || s > best.score) best = { kind: f.kind, score: s, fact: f };
      }
    }
    if (best) return best;
  }

  // Fallback: keyword overlap against descriptor (+ value tokens as bonus)
  let best: RetrievalHit | null = null;
  for (const f of facts) {
    const descriptor = RETRIEVAL_DESCRIPTORS[f.kind] + ' ' + f.value.toLowerCase();
    const score = keywordOverlapScore(question, descriptor);
    if (score >= threshold) {
      if (!best || score > best.score) best = { kind: f.kind, score, fact: f };
    }
  }
  return best;
}

export type SensitiveVia = 'rule' | 'retrieval' | 'both';

export interface SensitiveUnionResult {
  isSensitive: boolean;
  kind: SensitiveFactKind | null;
  via: SensitiveVia | null;
  ruleHit: RuleHit | null;
  retrievalHit: RetrievalHit | null;
  // The fact to show in the always-confirm card (latest per matched kind)
  fact: SensitiveFact | null;
}

/** Union detection: either signal routes to always-confirm (D17). */
export function detectSensitiveUnion(
  question: string,
  facts: SensitiveFact[],
): SensitiveUnionResult {
  const ruleHit = isSensitiveByRules(question);
  const retrievalHit = isSensitiveByRetrieval(question, facts);

  if (!ruleHit && !retrievalHit) {
    return { isSensitive: false, kind: null, via: null, ruleHit: null, retrievalHit: null, fact: null };
  }

  // Prefer fact from retrieval hit if present, else latest fact of rule kind
  let fact: SensitiveFact | null = null;
  let kind: SensitiveFactKind | null = null;
  let via: SensitiveVia | null = null;

  if (ruleHit && retrievalHit) {
    via = 'both';
    // If both fire, prefer retrieval's kind if they agree, otherwise rule's kind if kinds differ pick higher score? Use retrieval
    // For determinism, if kinds differ, pick retrieval (more semantic)
    kind = retrievalHit.kind;
    fact = retrievalHit.fact;
  } else if (ruleHit) {
    via = 'rule';
    kind = ruleHit.kind;
    // pick latest fact of that kind, or null if user has no fact of that kind (still sensitive, but no card data)
    const candidates = facts.filter((f) => f.kind === kind);
    candidates.sort((a, b) => new Date(b.stated_at).getTime() - new Date(a.stated_at).getTime());
    fact = candidates[0] ?? null;
    // If user has no fact of that kind, still route to confirm but fact is null (will show intake prompt)
  } else {
    via = 'retrieval';
    kind = retrievalHit!.kind;
    fact = retrievalHit!.fact;
  }

  return { isSensitive: true, kind, via, ruleHit, retrievalHit, fact };
}

/** Build provenance line for always-confirm card, e.g. "You said ₱45,000 on Apr 2026 — still true?" */
export function buildProvenanceLine(fact: SensitiveFact): string {
  const d = new Date(fact.stated_at);
  const monthYear = isNaN(d.getTime())
    ? fact.stated_at.slice(0, 10)
    : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  // Confirmed line not needed per spec example, but include if confirmed_at exists
  const base = `You said ${fact.value} on ${monthYear} — still true?`;
  if (fact.source_application_id) {
    return `You said ${fact.value} on your application, ${monthYear} — still true?`;
  }
  return base;
}

/** Latest fact per kind helper (for suggest pipeline). */
export function latestFactPerKind(facts: SensitiveFact[]): Map<SensitiveFactKind, SensitiveFact> {
  const map = new Map<SensitiveFactKind, SensitiveFact>();
  for (const f of facts) {
    const cur = map.get(f.kind);
    if (!cur || new Date(f.stated_at).getTime() > new Date(cur.stated_at).getTime()) {
      map.set(f.kind, f);
    }
  }
  return map;
}
