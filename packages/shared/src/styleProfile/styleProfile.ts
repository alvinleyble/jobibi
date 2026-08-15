/**
 * S9 — Style profile helpers (D13, D19).
 * Voice corpus = union of:
 *   - qa_pairs where origin in (user_written, user_edited)
 *   - documents where origin in (user_written, user_edited)
 *   - gap_answers (always counts)
 * Never include accepted_verbatim rows from either table.
 */

export const VOICE_CORPUS_TRIGGER_DELTA = 10;
export const VOICE_CORPUS_MAX_ITEMS = 100;

// Output-length discipline (D8, invariant 8): every drafting/distillation call carries explicit cap.
export const STYLE_PROFILE_MAX_OUTPUT_TOKENS = 400;
export const STYLE_PROFILE_MAX_PROFILE_CHARS = 2000;
export const STYLE_PROFILE_MAX_BULLETS = 8;
export const STYLE_PROFILE_MIN_BULLETS = 5;

// Stale in-flight guard: if rebuilding_started_at is older than this, treat as not in-flight
// (Edge Function may have crashed without clearing flag). Silent-fail path relies on this.
export const STALE_REBUILD_MS = 30 * 60 * 1000; // 30 minutes

export type VoiceCorpusItem = {
  text: string;
  source: 'qa_pair' | 'document' | 'gap_answer';
  createdAt: string;
};

export function isInFlight(profile: {
  rebuilding: boolean;
  rebuilding_started_at: string | null;
} | null): boolean {
  if (!profile?.rebuilding) return false;
  if (!profile.rebuilding_started_at) return true;
  const started = new Date(profile.rebuilding_started_at).getTime();
  if (Number.isNaN(started)) return true;
  return Date.now() - started < STALE_REBUILD_MS;
}

export function shouldTriggerRebuild(currentCount: number, lastCorpusSize: number): boolean {
  return currentCount - lastCorpusSize >= VOICE_CORPUS_TRIGGER_DELTA;
}

/**
 * Build distillation prompt. Content is observations about *how* the person writes,
 * not facts about career. Explicitly instructs against career-fact listing.
 */
export function buildDistillationSystemPrompt(): string {
  return `You are Jobibi's voice analyst. Given the user's own writing samples below, produce a short bulleted profile of *how* this person writes — not what they have done.

Return 5–8 bullets, each one observation about style:
- sentence length and complexity
- formality / tone / register
- recurring phrasing, habits, or punctuation patterns
- typical opening and closing style
- vocabulary preferences

Rules:
- Do NOT list facts about career, roles, companies, or experiences — that is the memory bank's job, not the style profile's.
- Do NOT invent or assume traits not evidenced in the samples.
- Each bullet must be one concise observation starting with "- ".
- Total output ≤${STYLE_PROFILE_MAX_PROFILE_CHARS} chars.
- If samples are too short or repetitive to infer style, say so in one bullet and keep it brief.`;
}

export function buildDistillationUserContent(items: VoiceCorpusItem[]): string {
  const blocks = items
    .slice(0, VOICE_CORPUS_MAX_ITEMS)
    .map((it, i) => `[${i + 1} ${it.source}]\n${it.text.slice(0, 2000)}`)
    .join('\n---\n');
  return `Voice corpus — ${items.length} most-recent qualifying items (cap ${VOICE_CORPUS_MAX_ITEMS}), newest first:\n\n${blocks}\n\nWrite the style profile as 5–8 bullets per the system instruction. Output JSON only.`;
}

export function sanitizeProfileMd(raw: string): string {
  const md = (raw ?? '').trim().slice(0, STYLE_PROFILE_MAX_PROFILE_CHARS);
  // Normalize bullet prefix
  const lines = md
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // Keep only bullet-like lines if they exist; otherwise wrap as single bullet
  const bullets = lines.filter((l) => l.startsWith('-') || l.startsWith('•') || l.startsWith('*'));
  if (bullets.length >= STYLE_PROFILE_MIN_BULLETS) {
    const normalized = bullets.slice(0, STYLE_PROFILE_MAX_BULLETS).map((b) => (b.startsWith('-') ? b : `- ${b.replace(/^[•*]\s*/, '')}`));
    return normalized.join('\n').slice(0, STYLE_PROFILE_MAX_PROFILE_CHARS);
  }
  // If model returned non-bulleted text, coerce to bullets (best-effort)
  if (lines.length) {
    const coerced = lines.slice(0, STYLE_PROFILE_MAX_BULLETS).map((l) => (l.startsWith('-') ? l : `- ${l.replace(/^[•*]\s*/, '')}`));
    return coerced.join('\n').slice(0, STYLE_PROFILE_MAX_PROFILE_CHARS);
  }
  return md;
}
