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
import {
  OUTPUT_LENGTH_CONFIG,
  WEEKLY_COVER_LETTER_LIMIT,
  trimGracefully,
  type OutputLength,
} from '../../../packages/shared/src/settings/settings.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

// D8: explicit length cap — output dominates cost, beta budget is fixed $5.
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
    if (!authHeader) return jsonResponse({ error: 'Please sign in to generate a cover letter.' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: 'Your session has expired. Please sign in again.' }, 401);

    // ── S12: Profile, Beta Status, and Quota/Length Enforcement ──
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('is_beta_tester, output_length')
      .eq('id', user.id)
      .maybeSingle();
    const isBetaTester = Boolean((profileRow as { is_beta_tester?: boolean } | null)?.is_beta_tester);
    const userOutputLength: OutputLength = ((profileRow as { output_length?: string } | null)?.output_length as OutputLength) || 'short';
    const activeOutputLength: OutputLength = isBetaTester ? userOutputLength : 'short';
    const lengthConfig = OUTPUT_LENGTH_CONFIG[activeOutputLength] || OUTPUT_LENGTH_CONFIG.short;

    if (!isBetaTester) {
      const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: coverLetterCount } = (await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('kind', 'cover_letter')
        .gte('created_at', sevenDaysAgoIso)) as unknown as { count: number | null };
      if ((coverLetterCount ?? 0) >= WEEKLY_COVER_LETTER_LIMIT) {
        return jsonResponse(
          {
            error: 'weekly_cover_letter_quota_reached',
            code: 'weekly_cover_letter_quota_reached',
            limit: WEEKLY_COVER_LETTER_LIMIT,
            used: coverLetterCount ?? WEEKLY_COVER_LETTER_LIMIT,
            message: `Weekly cover letter limit reached (${WEEKLY_COVER_LETTER_LIMIT} free per 7 days). Upgrade to Premium for unlimited cover letters.`,
          },
          429,
        );
      }
    }

    const body = await req.json().catch(() => null);
    const parsed = DraftCoverLetterRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: `Please provide a valid job description (at least ${MIN_JOB_DESCRIPTION_CHARS} characters).` }, 400);
    }

    const jobDescription = parsed.data.jobDescription.trim();
    if (jobDescription.length < MIN_JOB_DESCRIPTION_CHARS) {
      return jsonResponse({ error: `Please provide a longer job description (at least ${MIN_JOB_DESCRIPTION_CHARS} characters) so Jobibi can draft a tailored cover letter.` }, 422);
    }

    // ── Retrieve: same hybrid pipeline as suggest, query is the JD text ──
    // No gate after this — always attempt to draft (S8 item 4).
    type MemRow = { id: string | null; text: string; embedding: number[] | null };
    let memoryRows: MemRow[] = [];
    let jdEmbedding: number[] | null = null;

    // Try vector search first (match_memory_chunks RPC), fall back to keyword
    try {
      jdEmbedding = await new Supabase.ai.Session('gte-small').run(jobDescription, {
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
    if (!apiKey) {
      console.error('[draft-cover-letter] OPENAI_API_KEY not configured');
      return jsonResponse({ error: 'The drafting service is temporarily unavailable. Please try again in a few moments.' }, 500);
    }

    // S9: inject style profile into cached system prompt (same as suggest, ARCHITECTURE step 9)
    let styleProfileMd: string | null = null;
    try {
      const { data: sp } = await supabase.from('style_profile').select('profile_md').eq('user_id', user.id).maybeSingle();
      const md = (sp as { profile_md: string | null } | null)?.profile_md?.trim();
      if (md) styleProfileMd = md.slice(0, 2000);
    } catch { /* omit on error */ }
    const styleBlock = styleProfileMd ? `Style profile — how the user writes (follow this voice):\n${styleProfileMd}\n\n` : '';
    const system = `${styleBlock}You are Jobibi, an editor of the user's best self. Draft a cover letter tailored to the job description below, highlighting the user's relevant experience grounded in the history snippets. Never invent specific unmentioned employers or credentials. If snippets are minimal or absent, draft a polished, customizable cover letter aligning with the job requirements that the user can personalize. Keep the letter ${lengthConfig.wordRange} (≤${lengthConfig.maxChars} chars). Use a professional cover letter structure (greeting, body paragraphs, closing). Do not include salary, notice period, work authorization, or location expectations.${styleProfileMd ? ' Match the style profile voice.' : ''}`;

    const payload = {
      model: 'gpt-5.6-luna',
      max_completion_tokens: Math.max(800, lengthConfig.maxTokens + 400),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'cover_letter',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              draft: { type: 'string', description: `Cover letter draft (${lengthConfig.wordRange}, ≤${lengthConfig.maxChars} chars), grounded in snippets` },
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
          content: `Job description:\n${jobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS)}\n\nUser's history snippets:\n${snippets || '(no specific snippets available — draft a strong opening and body tailored to the job requirements that the user can personalize)'}\n\nDraft a cover letter (${lengthConfig.wordRange}, ≤${lengthConfig.maxChars} chars).`,
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
      console.error('[draft-cover-letter] OpenAI API error:', resp.status, text);
      return jsonResponse({ error: 'We could not generate your cover letter right now. Please try again in a moment.' }, 502);
    }
    const data = (await resp.json()) as {
      choices?: {
        message?: { content?: string | null; refusal?: string | null };
        finish_reason?: string | null;
      }[];
    };

    const choice = data.choices?.[0];
    if (!choice) {
      console.error('[draft-cover-letter] No response choices returned by model');
      return jsonResponse({ error: 'We could not generate your cover letter right now. Please try again in a moment.' }, 502);
    }

    if (choice.message?.refusal) {
      console.error('[draft-cover-letter] Model refusal:', choice.message.refusal);
      return jsonResponse({ error: 'Jobibi was unable to draft a cover letter for this job description. Please check the text and try again.' }, 502);
    }

    const rawContent = choice.message?.content?.trim() ?? '';
    if (!rawContent) {
      console.error('[draft-cover-letter] Empty content from model, finish_reason:', choice.finish_reason);
      return jsonResponse(
        { error: 'We could not generate your cover letter. Please try again.' },
        502,
      );
    }

    // Strip markdown code fences if present
    let jsonStr = rawContent;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    let parsedContent: { draft?: string; sources?: { kind: string; label: string; ref: string }[] };
    try {
      parsedContent = JSON.parse(jsonStr);
    } catch {
      // Fallback: extract substring between first '{' and last '}'
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsedContent = JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1));
        } catch {
          console.error('[draft-cover-letter] Model returned non-JSON:', rawContent);
          return jsonResponse({ error: 'Something went wrong while formatting your cover letter. Please try generating again.' }, 502);
        }
      } else {
        console.error('[draft-cover-letter] Model returned non-JSON:', rawContent);
        return jsonResponse({ error: 'Something went wrong while formatting your cover letter. Please try generating again.' }, 502);
      }
    }

    const draft = trimGracefully(parsedContent.draft ?? '', lengthConfig.maxChars);
    const sources = parsedContent.sources ?? [{ kind: 'memory_chunk', label: 'Your history', ref: 'memory' }];

    return jsonResponse(
      DraftCoverLetterResponseSchema.parse({ draft, sources }),
      200,
    );
  } catch (e) {
    console.error('[draft-cover-letter] unexpected error:', e);
    return jsonResponse({ error: 'An unexpected error occurred while drafting your cover letter. Please try again.' }, 500);
  }
});
