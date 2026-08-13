// S7A: manual-input — cold raw-text capture for refuse card (D17 storage gate)
// User types their own answer on refuse outcome; no anchor chunk exists.
// Inserts into qa_pairs (origin=user_written) + memory_chunks (type qa_pair) immediately,
// tagged user-written so it feeds voice profile. Reject-and-redirect via detectSensitiveUnion
// before any write — value only enters sensitive_facts via sensitive-confirm UI.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeQuestion } from '../../../packages/shared/src/gate/normalize.ts';
import { deriveOrigin } from '../../../packages/shared/src/capture/capture.ts';
import { detectSensitiveUnion, buildProvenanceLine } from '../../../packages/shared/src/gate/sensitive.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

const MAX_ANSWER_CHARS = 2000;

const ManualInputRequestSchema = z.object({
  questionLabel: z.string().min(2).max(500),
  answerText: z.string().min(3).max(MAX_ANSWER_CHARS),
  jobContext: z
    .object({
      role: z.string().min(1).optional(),
      company: z.string().min(1).optional(),
      url: z.string().optional(),
    })
    .optional(),
  applicationId: z.string().uuid().nullable().optional(),
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
    const parsed = ManualInputRequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const { questionLabel, answerText, jobContext, applicationId } = parsed.data;
    const qLabel = questionLabel.trim();
    const trimmedAnswer = answerText.trim();
    if (!trimmedAnswer) return jsonResponse({ error: 'Answer must not be empty' }, 400);
    const qNorm = normalizeQuestion(qLabel);

    // ── S7A sensitive storage gate (D17) — reject-and-redirect before any insert ──
    try {
      const { data: factRows } = await supabase
        .from('sensitive_facts')
        .select('id, kind, value, stated_at, confirmed_at, source_application_id')
        .eq('user_id', user.id)
        .order('stated_at', { ascending: false })
        .limit(50);
      const typedFacts = ((factRows as unknown as { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; source_application_id: string | null }[] | null) ?? []).map((r) => ({
        id: r.id,
        kind: r.kind as import('../../../packages/shared/src/gate/sensitive.ts').SensitiveFact['kind'],
        value: r.value,
        stated_at: r.stated_at,
        confirmed_at: r.confirmed_at,
        source_application_id: r.source_application_id,
      }));
      const combined = `${qLabel} ${trimmedAnswer}`;
      const candidates = [combined, trimmedAnswer, qLabel];
      let sensitive: ReturnType<typeof detectSensitiveUnion> | null = null;
      for (const t of candidates) {
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
      console.error('[manual-input] sensitive check failed (fail-closed)', e);
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

    // Resolve application id if we have context and caller didn't supply
    let resolvedApplicationId: string | null = applicationId ?? null;
    if (!resolvedApplicationId && jobContext && (jobContext.company || jobContext.role)) {
      const company = jobContext.company ?? null;
      const roleTitle = jobContext.role ?? null;
      const url = jobContext.url ?? null;
      try {
        const { data: appRow } = await supabase
          .from('applications')
          .insert({
            user_id: user.id,
            company,
            role_title: roleTitle,
            url,
            submitted_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (appRow) resolvedApplicationId = (appRow as { id: string }).id;
      } catch {
        // proceed without application link
      }
    }

    const { origin, editDistance } = deriveOrigin(null, trimmedAnswer);

    // embedding for qa_pairs
    let embedding: number[] | null = null;
    try {
      const toEmbed = `${qLabel} ${trimmedAnswer}`.slice(0, 2000);
      embedding = await new Supabase.ai.Session('gte-small').run(toEmbed, { mean_pool: true, normalize: true });
    } catch {
      embedding = null;
    }

    const qaPayload: Record<string, unknown> = {
      user_id: user.id,
      application_id: resolvedApplicationId,
      question_label: qLabel,
      question_norm: qNorm,
      answer_text: trimmedAnswer,
      draft_text: null,
      origin,
      edit_distance: editDistance,
      embedding: embedding ? JSON.stringify(embedding) : null,
    };

    let qaId: string | null = null;
    {
      const { data: qaRow, error: qaErr } = await supabase.from('qa_pairs').insert(qaPayload).select('id').single();
      if (qaErr || !qaRow) {
        if (embedding) {
          const { data: qaRow2, error: qaErr2 } = await supabase.from('qa_pairs').insert({ ...qaPayload, embedding: null }).select('id').single();
          if (!qaErr2 && qaRow2) qaId = (qaRow2 as { id: string }).id;
          else return jsonResponse({ error: `Could not store answer: ${qaErr?.message ?? qaErr2?.message ?? 'unknown'}` }, 500);
        } else {
          return jsonResponse({ error: `Could not store answer: ${qaErr?.message ?? 'unknown'}` }, 500);
        }
      } else {
        qaId = (qaRow as { id: string }).id;
      }
    }

    // Also chunk into memory_chunks for retrieval (same pattern as gap-answer:119, tagged user-written via qa_pairs origin)
    let memoryChunkId: string | null = null;
    if (trimmedAnswer.length >= 3) {
      try {
        let memEmb: number[] | null = null;
        try {
          memEmb = await new Supabase.ai.Session('gte-small').run(trimmedAnswer, { mean_pool: true, normalize: true });
        } catch { memEmb = null; }
        const nextIdxRes = await supabase.from('memory_chunks').select('chunk_index').eq('user_id', user.id).order('chunk_index', { ascending: false }).limit(1);
        const rows = (nextIdxRes.data as unknown as { chunk_index: number }[] | null) ?? [];
        const nextIdx = rows.length ? rows[0].chunk_index + 1 : 0;
        const memPayload: Record<string, unknown> = {
          user_id: user.id,
          document_id: null,
          chunk_index: nextIdx,
          type: 'qa_pair',
          text: `Q: ${qLabel}\nA: ${trimmedAnswer}`,
          embedding: memEmb ? JSON.stringify(memEmb) : null,
        };
        const { data: memRow, error: memErr } = await supabase.from('memory_chunks').insert(memPayload).select('id').single();
        if (memErr) {
          if (memEmb) {
            const { data: memRow2 } = await supabase.from('memory_chunks').insert({ ...memPayload, embedding: null }).select('id').single();
            if (memRow2) memoryChunkId = (memRow2 as { id: string }).id;
          }
        } else if (memRow) {
          memoryChunkId = (memRow as { id: string }).id;
        }
      } catch (e) {
        console.warn('[manual-input] memory_chunks insert failed', e);
      }
    }

    return jsonResponse(
      {
        ok: true,
        qaPairId: qaId,
        memoryChunkId,
        questionNorm: qNorm,
      },
      200,
    );
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
