// S5b: gap-answer — store answer to Jobibi's gap question, chunk into memory, draft continues (D10)
// Called after an ask outcome. Stores row in gap_answers, embeds answer into memory_chunks (type gap_answer),
// then drafts a copy card grounded in the new material (explicit length cap, strict JSON schema).
// S7A: sensitive storage gate — reject-and-redirect via detectSensitiveUnion before any insert (D17).

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { maybeTriggerStyleProfileRebuild } from '../_shared/styleProfileTrigger.ts';
import { normalizeQuestion } from '../../../packages/shared/src/gate/normalize.ts';
import { keywordOverlap, cosine, hybridScore } from '../../../packages/shared/src/gate/retrieve.ts';
import { detectSensitiveUnion, buildProvenanceLine } from '../../../packages/shared/src/gate/sensitive.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

const MAX_OUTPUT_TOKENS = 600;
const MAX_ANSWER_CHARS = 900;
const MAX_SKELETON_BULLETS = 5;
const MAX_GAP_ANSWER_CHARS = 2000;

const GapAnswerRequestSchema = z.object({
  originalQuestion: z.string().min(5),
  gapQuestion: z.string().min(5),
  answer: z.string().min(3).max(MAX_GAP_ANSWER_CHARS),
  jobContext: z.object({
    role: z.string().min(1),
    company: z.string().min(1),
  }),
  anchoredChunkId: z.string().uuid().nullable().optional(),
  applicationId: z.string().uuid().nullable().optional(),
});

const GapAnswerResponseSchema = z.object({
  gapAnswerId: z.string(),
  memoryChunkId: z.string().nullable(),
  // draft that follows (grounded in new material)
  answer: z.string(),
  skeleton: z.array(z.string()),
  sources: z.array(z.object({ kind: z.string(), label: z.string(), ref: z.string() })),
  questionNorm: z.string(),
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
    const parsed = GapAnswerRequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const { originalQuestion, gapQuestion, answer, jobContext, anchoredChunkId, applicationId } = parsed.data;
    const questionNorm = normalizeQuestion(originalQuestion);
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) return jsonResponse({ error: 'Answer must not be empty' }, 400);

    // S7A sensitive storage gate — reject-and-redirect, never silent refile (D17)
    // Check answer + question texts against typed sensitive_facts before any insert.
    // On hit, return 409 with confirm payload so UI can route to sensitive-confirm.
    try {
      const { data: factRows, error: factErr } = await supabase
        .from('sensitive_facts')
        .select('id, kind, value, stated_at, confirmed_at, source_application_id')
        .eq('user_id', user.id)
        .order('stated_at', { ascending: false })
        .limit(50);
      if (factErr) throw factErr;
      const typedFacts = ((factRows as unknown as { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; source_application_id: string | null }[] | null) ?? []).map((r) => ({
        id: r.id,
        kind: r.kind as import('../../../packages/shared/src/gate/sensitive.ts').SensitiveFact['kind'],
        value: r.value,
        stated_at: r.stated_at,
        confirmed_at: r.confirmed_at,
        source_application_id: r.source_application_id,
      }));
      // Union over multiple texts: answer alone, original question, gap question, and combined
      const textsToCheck = [trimmedAnswer, originalQuestion, gapQuestion].filter(Boolean) as string[];
      const combined = `${originalQuestion} ${trimmedAnswer}`;
      textsToCheck.push(combined);
      let sensitive: ReturnType<typeof detectSensitiveUnion> | null = null;
      for (const t of textsToCheck) {
        const r = detectSensitiveUnion(t, typedFacts);
        if (r.isSensitive) { sensitive = r; break; }
      }
      if (sensitive?.isSensitive) {
        let factPayload: { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; provenanceLine: string } | null = null;
        if (sensitive.fact) {
          factPayload = {
            id: sensitive.fact.id,
            kind: sensitive.fact.kind,
            value: sensitive.fact.value,
            stated_at: sensitive.fact.stated_at,
            confirmed_at: sensitive.fact.confirmed_at ?? null,
            provenanceLine: buildProvenanceLine(sensitive.fact),
          };
        }
        return jsonResponse(
          {
            error: 'sensitive_detected',
            code: 'sensitive_rejected',
            message: `This looks like a sensitive field (${sensitive.kind}) — please confirm or update it via the sensitive flow.`,
            sensitiveKind: sensitive.kind,
            sensitiveVia: sensitive.via,
            sensitiveFact: factPayload,
          },
          409,
        );
      }
    } catch (e) {
      // Fail-closed per S7A: on check error, do not store raw text — reject with generic sensitive routing
      console.error('[gap-answer] sensitive check failed (fail-closed)', e);
      return jsonResponse(
        {
          error: 'sensitive_detected',
          code: 'sensitive_rejected',
          message: 'Could not verify sensitivity — please use the sensitive field flow.',
          sensitiveKind: null,
          sensitiveVia: null,
          sensitiveFact: null,
        },
        409,
      );
    }

    let validAnchoredId: string | null = null;
    if (anchoredChunkId) {
      const { data: anchor } = await supabase.from('memory_chunks').select('id').eq('id', anchoredChunkId).eq('user_id', user.id).maybeSingle();
      if (anchor?.id) validAnchoredId = anchor.id as string;
    }

    const { data: gapRow, error: gapErr } = await supabase
      .from('gap_answers')
      .insert({
        user_id: user.id,
        question_asked: gapQuestion,
        answer_text: trimmedAnswer,
        anchored_chunk_id: validAnchoredId,
        original_question_norm: questionNorm,
        application_id: applicationId ?? null,
      })
      .select('id')
      .single();
    if (gapErr || !gapRow) {
      return jsonResponse({ error: `Could not store gap answer: ${gapErr?.message ?? 'unknown'}` }, 500);
    }

    let embedding: number[] | null = null;
    try {
      embedding = await new Supabase.ai.Session('gte-small').run(trimmedAnswer, { mean_pool: true, normalize: true });
    } catch {
      embedding = null;
    }

    const chunkText = trimmedAnswer;
    const nextIndexRes = await supabase.from('memory_chunks').select('chunk_index').eq('user_id', user.id).order('chunk_index', { ascending: false }).limit(1);
    const nextIdx = (() => {
      const rows = (nextIndexRes.data as unknown as { chunk_index: number }[] | null) ?? [];
      return rows.length ? (rows[0].chunk_index + 1) : 0;
    })();

    let memoryChunkId: string | null = null;
    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      document_id: null,
      chunk_index: nextIdx,
      type: 'gap_answer',
      text: chunkText,
      embedding: embedding ? JSON.stringify(embedding) : null,
    };
    let insertError: unknown = null;
    {
      const { data, error } = await supabase.from('memory_chunks').insert(insertPayload).select('id').single();
      if (error) {
        insertError = error;
        if (embedding) {
          const { data: d2, error: e2 } = await supabase.from('memory_chunks').insert({ ...insertPayload, embedding: null }).select('id').single();
          if (!e2 && d2) {
            memoryChunkId = (d2 as { id: string }).id;
            insertError = null;
          }
        }
      } else if (data) {
        memoryChunkId = (data as { id: string }).id;
      }
    }
    if (insertError) {
      console.warn('memory_chunks insert failed', insertError);
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return jsonResponse({ error: 'OPENAI_API_KEY not configured' }, 500);

    let otherSnippets: string[] = [];
    try {
      const { data: chunks } = await supabase.from('memory_chunks').select('id, text, embedding').eq('user_id', user.id).limit(100);
      const all = (chunks as unknown as { id: string; text: string; embedding: number[] | string | null }[] | null) ?? [];
      const filtered = all.filter((c) => c.id !== memoryChunkId);
      let qEmb: number[] | null = null;
      try {
        qEmb = await new Supabase.ai.Session('gte-small').run(originalQuestion, { mean_pool: true, normalize: true });
      } catch {
        // qEmb stays null; scoring below falls back to keyword overlap
      }
      const scored = filtered.map((c) => {
        const kw = keywordOverlap(originalQuestion, c.text);
        let cos = kw;
        try {
          const emb = typeof c.embedding === 'string'
            ? JSON.parse(c.embedding as string) as number[]
            : (c.embedding as number[] | null);
          if (qEmb && emb && Array.isArray(emb)) cos = cosine(qEmb, emb);
        } catch {
          // cos stays at keyword-overlap fallback
        }
        const h = hybridScore(cos ?? kw, kw);
        return { text: c.text, score: h };
      });
      scored.sort((a, b) => b.score - a.score);
      otherSnippets = scored.slice(0, 3).map((s) => s.text);
    } catch {
      otherSnippets = [];
    }
    const snippets = [chunkText, ...otherSnippets].slice(0, 4).join('\n---\n');

    // S9: style profile into drafting (consistent with suggest/draft-cover-letter)
    let styleProfileMd: string | null = null;
    try {
      const { data: sp } = await supabase.from('style_profile').select('profile_md').eq('user_id', user.id).maybeSingle();
      const md = (sp as { profile_md: string | null } | null)?.profile_md?.trim();
      if (md) styleProfileMd = md.slice(0, 2000);
    } catch { /* omit */ }
    const styleBlock = styleProfileMd ? `Style profile — how the user writes (follow this voice):\n${styleProfileMd}\n\n` : '';
    const system = `${styleBlock}You are Jobibi, an editor of the user's best self. Draft only from the user's retrieved snippets below (first snippet is the user's fresh answer to your gap question, so use it). Never invent. Keep answer ≤${MAX_ANSWER_CHARS} chars. Also return a ${MAX_SKELETON_BULLETS}-bullet skeleton and sources.${styleProfileMd ? ' Match the style profile voice.' : ''}`;
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
        { role: 'user', content: `Original employer question: ${originalQuestion}\nGap question asked: ${gapQuestion}\nUser's gap answer: ${trimmedAnswer}\nJob: ${jobContext.role} at ${jobContext.company}\nSnippets:\n${snippets || '(no snippets)'}\n\nDraft the answer to the original employer question, grounded only in snippets. First snippet is the user's fresh gap answer — prioritize it.` },
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
    const data = (await resp.json()) as { choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    let parsedContent: { answer: string; skeleton: string[]; sources: { kind: string; label: string; ref: string }[] };
    try {
      parsedContent = JSON.parse(content);
    } catch {
      return jsonResponse({ error: 'Model returned non-JSON' }, 502);
    }
    let draftedAnswer = (parsedContent.answer ?? '').slice(0, MAX_ANSWER_CHARS);
    if (draftedAnswer.length > MAX_ANSWER_CHARS) draftedAnswer = draftedAnswer.slice(0, MAX_ANSWER_CHARS);
    const skeleton = (parsedContent.skeleton ?? []).slice(0, MAX_SKELETON_BULLETS);
    const sources = parsedContent.sources ?? [{ kind: 'gap_answer', label: 'Your gap answer', ref: (gapRow as { id: string }).id }];

    // S9: voice-corpus trigger (gap_answers always counts, D13 no filter); style-profile owns claim/in-flight
    await maybeTriggerStyleProfileRebuild(supabase, user.id, authHeader, Deno.env.get('SUPABASE_URL')!);

    return jsonResponse(
      GapAnswerResponseSchema.parse({
        gapAnswerId: (gapRow as { id: string }).id,
        memoryChunkId,
        answer: draftedAnswer,
        skeleton,
        sources,
        questionNorm,
      }),
      200,
    );
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
