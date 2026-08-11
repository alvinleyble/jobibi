// S5b: suggest — gate (draft/ask/refuse), draft, gap-question (D10, D15, D8, D14)
// Gate decides; model never decides refuse. On ask Luna words one anchored gap question
// after code has already decided. Sensitive handling (S5c) stays ahead but is S5c.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeQuestion } from '../../../packages/shared/src/gate/normalize.ts';
import { decideGate } from '../../../packages/shared/src/gate/gate.ts';
import { cosine, hybridScore, keywordOverlap } from '../../../packages/shared/src/gate/retrieve.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

const MAX_OUTPUT_TOKENS = 600; // D8: output cost control + field limits
const MAX_ANSWER_CHARS = 900;
const MAX_SKELETON_BULLETS = 5;
const MAX_GAP_QUESTION_CHARS = 180;
const MAX_GAP_TOKENS = 200;

const SuggestRequestSchema = z.object({
  question: z.string().min(5),
  jobContext: z.object({
    role: z.string().min(1),
    company: z.string().min(1),
  }),
});

const SuggestResponseSchema = z.object({
  outcome: z.enum(['draft', 'ask', 'refuse']),
  questionNorm: z.string(),
  questionMatch: z.number(),
  roleMatch: z.number(),
  // draft
  answer: z.string().optional(),
  skeleton: z.array(z.string()).optional(),
  sources: z.array(z.object({ kind: z.string(), label: z.string(), ref: z.string() })).optional(),
  // ask
  gapQuestion: z.string().optional(),
  anchoredChunkId: z.string().nullable().optional(),
  anchoredChunkText: z.string().optional(),
  // refuse
  refuseMessage: z.string().optional(),
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function refuseMessageFor(): string {
  return "I don't have anything in your history that matches this question, so I won't guess — want to write it yourself or answer one short follow-up instead?";
}

function buildFallbackGapQuestion(anchorText: string, role: string): string {
  const snippet = anchorText.slice(0, 80).replace(/\s+/g, ' ').trim();
  const base = snippet
    ? `You mentioned "${snippet}" — how did that play out for this ${role} role?`
    : `Can you share a short example that fits this ${role} role?`;
  return base.slice(0, MAX_GAP_QUESTION_CHARS);
}

async function generateGapQuestion(
  apiKey: string,
  employerQuestion: string,
  anchorText: string,
  jobRole: string,
): Promise<string> {
  const system = `You are Jobibi. Write ONE short gap question anchored to the user's history snippet. Rules: one sentence, one line, ≤${MAX_GAP_QUESTION_CHARS} chars, ends with ?, references the snippet so the user can answer in seconds without writing an essay. Never answer the employer question. Output JSON only.`;
  const userContent = `Employer question: ${employerQuestion}\nJob role: ${jobRole}\nAnchored snippet from history:\n${anchorText.slice(0, 400)}\n\nWrite the gap question.`;
  const payload = {
    model: 'gpt-5.6-luna',
    max_completion_tokens: MAX_GAP_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'gap_question',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            gapQuestion: { type: 'string', description: `One-line anchored gap question ≤${MAX_GAP_QUESTION_CHARS} chars, ends with ?` },
          },
          required: ['gapQuestion'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  };
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) return buildFallbackGapQuestion(anchorText, jobRole);
  const data = (await resp.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(content) as { gapQuestion: string };
    let q = (parsed.gapQuestion ?? '').trim().replace(/\s+/g, ' ');
    if (!q) return buildFallbackGapQuestion(anchorText, jobRole);
    if (!q.endsWith('?')) q += '?';
    if (q.length > MAX_GAP_QUESTION_CHARS) q = q.slice(0, MAX_GAP_QUESTION_CHARS - 1) + '?';
    q = q.split('\n')[0].trim();
    return q;
  } catch {
    return buildFallbackGapQuestion(anchorText, jobRole);
  }
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

    const body = await req.json();
    const parsed = SuggestRequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const questionNorm = normalizeQuestion(parsed.data.question);
    const jobText = `${parsed.data.jobContext.role} ${parsed.data.jobContext.company}`;

    type MemRow = { id: string | null; text: string; embedding: number[] | null };
    let memoryRows: MemRow[] = [];
    try {
      const qEmbedding = await new Supabase.ai.Session('gte-small').run(parsed.data.question, { mean_pool: true, normalize: true });
      const { data, error } = await supabase.rpc('match_memory_chunks' as unknown as string, {
        query_embedding: qEmbedding,
        match_count: 8,
      } as unknown as Record<string, unknown>);
      if (!error && Array.isArray(data) && data.length) {
        memoryRows = (data as unknown as { id?: string; text: string; embedding: number[] | string }[]).map((r) => ({
          id: (r.id as string) ?? null,
          text: r.text,
          embedding: typeof r.embedding === 'string' ? r.embedding as unknown as number[] : (r.embedding as number[] | null),
        })).slice(0, 8);
      }
    } catch {
      // fallback below
    }

    if (memoryRows.length === 0) {
      const { data: chunks } = await supabase.from('memory_chunks').select('id, text, embedding').eq('user_id', user.id).limit(100);
      const all = (chunks as unknown as MemRow[] | null) ?? [];
      all.sort((a, b) => keywordOverlap(parsed.data.question, b.text) - keywordOverlap(parsed.data.question, a.text));
      memoryRows = all.slice(0, 8).map((r) => ({ id: (r as unknown as { id: string }).id ?? null, text: r.text, embedding: r.embedding }));
    }

    let qEmbedding: number[] | null = null;
    try {
      qEmbedding = await new Supabase.ai.Session('gte-small').run(parsed.data.question, { mean_pool: true, normalize: true });
    } catch {
      // qEmbedding stays null; scoring below falls back to keyword overlap
    }
    let rEmbedding: number[] | null = null;
    try {
      rEmbedding = await new Supabase.ai.Session('gte-small').run(jobText, { mean_pool: true, normalize: true });
    } catch {
      // rEmbedding stays null; scoring below falls back to keyword overlap
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
          // fall through to manual comma-split parse below
        }
        const nums = e.replace(/^\[|\]$/g, '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        if (nums.length) return nums;
      }
      return null;
    };

    type Scored = { row: MemRow; qScore: number; rScore: number };
    const scored: Scored[] = [];
    for (const row of memoryRows) {
      const emb = parseEmbedding((row as unknown as { embedding: unknown }).embedding);
      const kwQ = keywordOverlap(parsed.data.question, row.text);
      const kwR = keywordOverlap(jobText, row.text);
      const cosQ = qEmbedding && emb ? sanitize(cosine(qEmbedding, emb)) : kwQ;
      const cosR = rEmbedding && emb ? sanitize(cosine(rEmbedding, emb)) : kwR;
      scored.push({
        row,
        qScore: sanitize(hybridScore(sanitize(cosQ), sanitize(kwQ))),
        rScore: sanitize(hybridScore(sanitize(cosR), sanitize(kwR))),
      });
    }
    scored.sort((a, b) => b.qScore - a.qScore);
    const questionScores = scored.map((s) => s.qScore).sort((a, b) => b - a);
    const roleScores = scored.map((s) => s.rScore).sort((a, b) => b - a);

    const gate = decideGate({ questionScores, roleScores });

    const safeQ = Number.isFinite(gate.questionMatch) ? gate.questionMatch : 0;
    const safeR = Number.isFinite(gate.roleMatch) ? gate.roleMatch : 0;
    await supabase.from('gate_decisions').insert({
      user_id: user.id,
      question_norm: questionNorm,
      question_match: safeQ,
      role_match: safeR,
      outcome: gate.outcome,
      user_action: null,
    });

    if (gate.outcome === 'refuse') {
      return jsonResponse(
        SuggestResponseSchema.parse({
          outcome: 'refuse',
          questionNorm,
          questionMatch: safeQ,
          roleMatch: safeR,
          refuseMessage: refuseMessageFor(),
        }),
        200,
      );
    }

    if (gate.outcome === 'ask') {
      const anchor = scored[0];
      const anchorText = anchor?.row.text ?? memoryRows[0]?.text ?? '';
      const anchoredChunkId = anchor?.row.id ?? null;
      let gapQuestion: string;
      const apiKey = Deno.env.get('OPENAI_API_KEY');
      if (apiKey && anchorText) {
        gapQuestion = await generateGapQuestion(apiKey, parsed.data.question, anchorText, parsed.data.jobContext.role);
      } else {
        gapQuestion = buildFallbackGapQuestion(anchorText, parsed.data.jobContext.role);
      }
      gapQuestion = gapQuestion.split('\n')[0].trim().replace(/\s+/g, ' ');
      if (!gapQuestion.endsWith('?')) gapQuestion = gapQuestion.replace(/[.!]*$/, '') + '?';
      if (gapQuestion.length > MAX_GAP_QUESTION_CHARS) gapQuestion = gapQuestion.slice(0, MAX_GAP_QUESTION_CHARS - 1) + '?';
      return jsonResponse(
        SuggestResponseSchema.parse({
          outcome: 'ask',
          questionNorm,
          questionMatch: safeQ,
          roleMatch: safeR,
          gapQuestion,
          anchoredChunkId,
          anchoredChunkText: anchorText.slice(0, 400),
        }),
        200,
      );
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return jsonResponse({ error: 'OPENAI_API_KEY not configured' }, 500);

    const snippets = scored.slice(0, 4).map((s) => s.row.text).join('\n---\n');
    const system = `You are Jobibi, an editor of the user's best self. Draft only from the user's retrieved snippets below. Never invent. Keep answer ≤${MAX_ANSWER_CHARS} chars. Also return a ${MAX_SKELETON_BULLETS}-bullet skeleton and sources.`;

    const payload = {
      model: 'gpt-5.6-luna',
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'copy_card',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              answer: { type: 'string', description: `Copy-paste answer ≤${MAX_ANSWER_CHARS} chars, grounded in snippets` },
              skeleton: { type: 'array', items: { type: 'string' }, maxItems: MAX_SKELETON_BULLETS },
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
            required: ['answer', 'skeleton', 'sources'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Question: ${parsed.data.question}\nJob: ${parsed.data.jobContext.role} at ${parsed.data.jobContext.company}\nSnippets:\n${snippets || '(no snippets)'}\n\nDraft an answer grounded only in snippets. If snippets lack material, set answer to empty is not allowed — this path is draft only.` },
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
    let parsedContent: { answer: string; skeleton: string[]; sources: { kind: string; label: string; ref: string }[] };
    try {
      parsedContent = JSON.parse(content);
    } catch {
      return jsonResponse({ error: 'Model returned non-JSON' }, 502);
    }
    let answer = (parsedContent.answer ?? '').slice(0, MAX_ANSWER_CHARS);
    const skeleton = (parsedContent.skeleton ?? []).slice(0, MAX_SKELETON_BULLETS);
    const sources = parsedContent.sources ?? [{ kind: 'memory_chunk', label: 'Your history', ref: 'memory' }];

    if (answer.length > MAX_ANSWER_CHARS) answer = answer.slice(0, MAX_ANSWER_CHARS);

    return jsonResponse(
      SuggestResponseSchema.parse({
        outcome: 'draft',
        questionNorm,
        questionMatch: safeQ,
        roleMatch: safeR,
        answer,
        skeleton,
        sources,
      }),
      200,
    );
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
