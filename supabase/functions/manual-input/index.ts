// Manual-input — cold raw-text capture for refuse card
// User types their own answer on refuse outcome; no anchor chunk exists.
// Inserts into qa_pairs (origin=user_written) + memory_chunks (type qa_pair) immediately,
// tagged user-written so it feeds voice profile.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { maybeTriggerStyleProfileRebuild } from '../_shared/styleProfileTrigger.ts';
import { normalizeQuestion } from '../../../packages/shared/src/gate/normalize.ts';
import { deriveOrigin } from '../../../packages/shared/src/capture/capture.ts';

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
    if (!authHeader) return jsonResponse({ error: 'Please sign in to save an answer.' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: 'Your session has expired. Please sign in again.' }, 401);

    const body = await req.json().catch(() => null);
    const parsed = ManualInputRequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: 'Please provide a valid question and answer to save.' }, 400);

    const { questionLabel, answerText, jobContext, applicationId } = parsed.data;
    const qLabel = questionLabel.trim();
    const trimmedAnswer = answerText.trim();
    if (!trimmedAnswer) return jsonResponse({ error: 'Please write an answer before saving.' }, 400);
    const qNorm = normalizeQuestion(qLabel);

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
          if (!qaErr2 && qaRow2) {
            qaId = (qaRow2 as { id: string }).id;
          } else {
            console.error('[manual-input] qa_pairs retry insert failed:', qaErr2 ?? qaErr);
            return jsonResponse({ error: 'We could not save your answer to memory. Please try again.' }, 500);
          }
        } else {
          console.error('[manual-input] qa_pairs insert failed:', qaErr);
          return jsonResponse({ error: 'We could not save your answer to memory. Please try again.' }, 500);
        }
      } else {
        qaId = (qaRow as { id: string }).id;
      }
    }

    // Also chunk into memory_chunks for retrieval
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
          let recovered = false;
          if (memEmb) {
            const { data: memRow2, error: memErr2 } = await supabase.from('memory_chunks').insert({ ...memPayload, embedding: null }).select('id').single();
            if (memRow2) {
              memoryChunkId = (memRow2 as { id: string }).id;
              recovered = true;
            } else {
              console.error('[manual-input] memory_chunks insert failed (after retry)', memErr2 ?? memErr);
            }
          } else {
            console.error('[manual-input] memory_chunks insert failed', memErr);
          }
          if (!recovered) {
            return jsonResponse(
              { error: 'Your answer was saved, but search indexing failed. Please try saving again.' },
              500,
            );
          }
        } else if (memRow) {
          memoryChunkId = (memRow as { id: string }).id;
        } else {
          console.error('[manual-input] memory_chunks insert returned no row and no error');
          return jsonResponse(
            { error: 'Your answer was saved, but search indexing returned no ID. Please try saving again.' },
            500,
          );
        }
      } catch (e) {
        console.error('[manual-input] memory_chunks insert failed', e);
        return jsonResponse(
          { error: 'Your answer was saved, but search indexing failed. Please try saving again.' },
          500,
        );
      }
    }

    await maybeTriggerStyleProfileRebuild(supabase, user.id, authHeader, Deno.env.get('SUPABASE_URL')!);

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
    console.error('[manual-input] unexpected error:', e);
    return jsonResponse({ error: 'An unexpected error occurred while saving your answer. Please try again.' }, 500);
  }
});
