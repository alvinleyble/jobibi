// S5a: suggest — gate, draft, refuse (D15, D10, D8, D14)
// Every call carries explicit length cap; model never decides refuse.
// Sensitive handling (S5c union) runs before gate but is S5c, not here.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeQuestion } from '../../../packages/shared/src/gate/normalize.ts';
import { decideGate, mockScores } from '../../../packages/shared/src/gate/gate.ts';
import { cosine, hybridScore, keywordOverlap } from '../../../packages/shared/src/gate/retrieve.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

const MAX_OUTPUT_TOKENS = 600; // D8: output cost control + field limits
const MAX_ANSWER_CHARS = 900;
const MAX_SKELETON_BULLETS = 5;

const SuggestRequestSchema = z.object({
  question: z.string().min(5),
  jobContext: z.object({
    role: z.string().min(1),
    company: z.string().min(1),
  }),
});

const SuggestResponseSchema = z.object({
  outcome: z.enum(['draft', 'refuse']),
  questionNorm: z.string(),
  questionMatch: z.number(),
  roleMatch: z.number(),
  // draft
  answer: z.string().optional(),
  skeleton: z.array(z.string()).optional(),
  sources: z.array(z.object({ kind: z.string(), label: z.string(), ref: z.string() })).optional(),
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
  return "I don't have anything in your history that matches this question, so I won't guess — want to write it yourself or ask me to ask you one short follow-up after S5b ships?";
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

    // Retrieve: top-k hybrid (vector + keyword). For S5a minimal, use hnsw via RPC if available; fallback to keyword.
    let memoryRows: { text: string; embedding: number[] | null }[] = [];
    try {
      const qEmbedding = await new Supabase.ai.Session('gte-small').run(parsed.data.question);
      // Try vector search via SQL function if exists; else fallback
      const { data, error } = await supabase.rpc('match_memory_chunks' as unknown as string, {
        query_embedding: qEmbedding,
        match_count: 8,
      } as unknown as Record<string, unknown>);
      if (!error && Array.isArray(data) && data.length) {
        memoryRows = (data as unknown as { text: string; embedding: number[] }[]).slice(0, 8);
      }
    } catch {
      // fallback below
    }

    if (memoryRows.length === 0) {
      // Fallback: keyword scan over user's chunks (small corpora; cold start)
      const { data: chunks } = await supabase.from('memory_chunks').select('text, embedding').eq('user_id', user.id).limit(100);
      const all = (chunks as unknown as { text: string; embedding: number[] | null }[] | null) ?? [];
      // Keep top 8 by keyword overlap
      all.sort((a, b) => keywordOverlap(parsed.data.question, b.text) - keywordOverlap(parsed.data.question, a.text));
      memoryRows = all.slice(0, 8);
    }

    // Build scores for gate: need per-chunk hybrid q vs chunk and role vs chunk
    let qEmbedding: number[] | null = null;
    try { qEmbedding = await new Supabase.ai.Session('gte-small').run(parsed.data.question); } catch {}
    let rEmbedding: number[] | null = null;
    try { rEmbedding = await new Supabase.ai.Session('gte-small').run(jobText); } catch {}

    const questionScores: number[] = [];
    const roleScores: number[] = [];
    for (const row of memoryRows) {
      const kwQ = keywordOverlap(parsed.data.question, row.text);
      const kwR = keywordOverlap(jobText, row.text);
      const cosQ = qEmbedding && row.embedding ? cosine(qEmbedding, row.embedding) : kwQ;
      const cosR = rEmbedding && row.embedding ? cosine(rEmbedding, row.embedding) : kwR;
      questionScores.push(hybridScore(cosQ, kwQ));
      roleScores.push(hybridScore(cosR, kwR));
    }
    questionScores.sort((a, b) => b - a);
    roleScores.sort((a, b) => b - a);

    // Gate: code decides. If refuse, never call model. If ask, S5a treats as refuse (ask is S5b); so S5a only has draft/refuse.
    const gate = decideGate({ questionScores, roleScores });
    // Map ask → refuse for S5a (ask ships in S5b)
    const outcome: 'draft' | 'refuse' = gate.outcome === 'draft' ? 'draft' : 'refuse';

    // Log every decision (D15) before drafting
    await supabase.from('gate_decisions').insert({
      user_id: user.id,
      question_norm: questionNorm,
      question_match: gate.questionMatch,
      role_match: gate.roleMatch,
      outcome,
      user_action: null,
    });

    if (outcome === 'refuse') {
      return jsonResponse(
        SuggestResponseSchema.parse({
          outcome: 'refuse',
          questionNorm,
          questionMatch: gate.questionMatch,
          roleMatch: gate.roleMatch,
          refuseMessage: refuseMessageFor(),
        }),
        200,
      );
    }

    // Draft via Luna with explicit length cap and strict JSON schema (D8, D14)
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return jsonResponse({ error: 'OPENAI_API_KEY not configured' }, 500);

    const snippets = memoryRows.slice(0, 4).map((r) => r.text).join('\n---\n');
    const system = `You are Jobibi, an editor of the user's best self. Draft only from the user's retrieved snippets below. Never invent. Keep answer ≤${MAX_ANSWER_CHARS} chars. Also return a ${MAX_SKELETON_BULLETS}-bullet skeleton and sources.`;

    const payload = {
      model: 'gpt-5.6-luna',
      max_tokens: MAX_OUTPUT_TOKENS,
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

    // Enforce length cap if model overshot despite instruction
    if (answer.length > MAX_ANSWER_CHARS) answer = answer.slice(0, MAX_ANSWER_CHARS);

    return jsonResponse(
      SuggestResponseSchema.parse({
        outcome: 'draft',
        questionNorm,
        questionMatch: gate.questionMatch,
        roleMatch: gate.roleMatch,
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
