// S8: Draft Cover Letter — grounded, gate-skipped, paste-required on every site
// Reuses the same retrieval-grounded drafting pipeline as suggest (gte-small +
// Luna + strict JSON schema), but deliberately skips the three-outcome
// draft/ask/refuse gate (D10/D15). The human accept/edit/discard step does
// the job the gate does elsewhere: nothing reaches storage unreviewed.
// Job description is ephemeral (never stored). Sensitive exclusion is
// inherited from the shared pipeline (S5c) — no new work, no S7A cross-ref.
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { cosine, hybridScore, keywordOverlap } from '../../../packages/shared/src/gate/retrieve.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

// D8: explicit length cap — output dominates cost, beta budget is fixed $5.
// Cover letters are longer than single-question answers, but still capped.
const MAX_OUTPUT_TOKENS = 800;
const MAX_COVER_LETTER_CHARS = 3000;
const MAX_JOB_DESCRIPTION_CHARS = 8000;
const MIN_JOB_DESCRIPTION_CHARS = 30;

const DraftCoverLetterRequestSchema = z.object({
  jobDescription: z.string().min(MIN_JOB_DESCRIPTION_CHARS).max(MAX_JOB_DESCRIPTION_CHARS),
});

const DraftCoverLetterResponseSchema = z.object({
  draft: z.string(),
  sources: z.array(z.object({ kind: z.string(), label: z.string(), ref: z.string() })),
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    const parsed = DraftCoverLetterRequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const jobDescription = parsed.data.jobDescription.trim();
    if (jobDescription.length < MIN_JOB_DESCRIPTION_CHARS) {
      return jsonResponse({ error: `Job description is too short (minimum ${MIN_JOB_DESCRIPTION_CHARS} characters)` }, 422);
    }

    // ── Retrieve: same hybrid pipeline as suggest, query is the JD text ──
    // No gate after this — always attempt to draft (S8 item 4).
    type MemRow = { id: string | null; text: string; embedding: number[] | null };
    let memoryRows: MemRow[] = [];

    // Try vector search first (match_memory_chunks RPC), fall back to keyword
    try {
      const jdEmbedding = await new Supabase.ai.Session('gte-small').run(jobDescription, {
        mean_pool: true,
        normalize: true,
      });
      const { data, error } = await supabase.rpc('match_memory_chunks' as unknown as string, {
        query_embedding: jdEmbedding,
        match_count: 8,
      } as unknown as Record<string, unknown>);
      if (!error && Array.isArray(data) && data.length) {
        memoryRows = (data as unknown as { id?: string; text: string; embedding: number[] | string }[]).map((r) => ({
          id: (r.id as string) ?? null,
          text: r.text,
          embedding: typeof r.embedding === 'string' ? (r.embedding as unknown as number[]) : (r.embedding as number[] | null),
        })).slice(0, 8);
      }
    } catch {
      // fallback below
    }

    if (memoryRows.length === 0) {
      const { data: chunks } = await supabase.from('memory_chunks').select('id, text, embedding').eq('user_id', user.id).limit(100);
      const all = (chunks as unknown as MemRow[] | null) ?? [];
      all.sort((a, b) => keywordOverlap(jobDescription, b.text) - keywordOverlap(jobDescription, a.text));
      memoryRows = all.slice(0, 8).map((r) => ({ id: (r as unknown as { id: string }).id ?? null, text: r.text, embedding: r.embedding }));
    }

    // Score and pick top snippets for grounding
    let jdEmbedding: number[] | null = null;
    try {
      jdEmbedding = await new Supabase.ai.Session('gte-small').run(jobDescription, { mean_pool: true, normalize: true });
    } catch {
      // stays null — scoring falls back to keyword overlap
    }

    const sanitize = (n: number) => (Number.isFinite(n) ? n : 0);
    const parseEmbedding = (e: unknown): number[] | null => {
      if (!e) return null;
      if (Array.isArray(e)) return e as number[];
      if (typeof e === 'string') {
        try {
          const p = JSON.parse(e);
          if (Array.isArray(p)) return p as number[];
        } catch {
          // fall through
        }
        const nums = e.replace(/^\[|\]$/g, '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        if (nums.length) return nums;
      }
      return null;
    };

    type Scored = { row: MemRow; score: number };
    const scored: Scored[] = [];
    for (const row of memoryRows) {
      const emb = parseEmbedding((row as unknown as { embedding: unknown }).embedding);
      const kw = keywordOverlap(jobDescription, row.text);
      const cos = jdEmbedding && emb ? sanitize(cosine(jdEmbedding, emb)) : kw;
      scored.push({ row, score: sanitize(hybridScore(sanitize(cos), sanitize(kw))) });
    }
    scored.sort((a, b) => b.score - a.score);

    const snippets = scored.slice(0, 6).map((s) => s.row.text).join('\n---\n');

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return jsonResponse({ error: 'OPENAI_API_KEY not configured' }, 500);

    const system = `You are Jobibi, an editor of the user's best self. Draft a cover letter grounded ONLY in the user's retrieved history snippets below. Never invent facts, experiences, or skills not in the snippets. Address the job described, highlighting the user's relevant experience. Keep the letter ≤${MAX_COVER_LETTER_CHARS} chars. Use a professional cover letter structure (greeting, body paragraphs, closing). Do not include salary, notice period, work authorization, or location expectations.`;

    const payload = {
      model: 'gpt-5.6-luna',
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'cover_letter',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              draft: { type: 'string', description: `Cover letter draft ≤${MAX_COVER_LETTER_CHARS} chars, grounded in snippets` },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    label: { type: 'string' },
                    ref: { type: 'string' },
                  },
                  required: ['kind', 'label', 'ref'],
                  additionalProperties: false,
                },
              },
            },
            required: ['draft', 'sources'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Job description:\n${jobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS)}\n\nUser's history snippets:\n${snippets || '(no snippets — draft a general but truthful opening the user can edit)'}\n\nDraft a cover letter grounded only in snippets.`,
        },
      ],
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return jsonResponse({ error: `OpenAI error ${resp.status}: ${text.slice(0, 500)}` }, 502);
    }
    const data = await resp.json() as { choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    let parsedContent: { draft: string; sources: { kind: string; label: string; ref: string }[] };
    try {
      parsedContent = JSON.parse(content);
    } catch {
      return jsonResponse({ error: 'Model returned non-JSON' }, 502);
    }
    const draft = (parsedContent.draft ?? '').slice(0, MAX_COVER_LETTER_CHARS);
    const sources = parsedContent.sources ?? [{ kind: 'memory_chunk', label: 'Your history', ref: 'memory' }];

    return jsonResponse(
      DraftCoverLetterResponseSchema.parse({ draft, sources }),
      200,
    );
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
