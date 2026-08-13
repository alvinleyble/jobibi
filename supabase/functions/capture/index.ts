// S6: capture — the growth loop (D12/D13/D16)
// Stores each submitted answer in qa_pairs with draft_text, origin, edit_distance.
// Also chunks into memory_chunks for future retrieval.
// Verifies mapping via client-provided verification flag; drops mismatched writes.
// S7A: sensitive storage gate — reject-and-redirect via detectSensitiveUnion before any insert (D17).

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeQuestion } from '../../../packages/shared/src/gate/normalize.ts';
import { deriveOrigin } from '../../../packages/shared/src/capture/capture.ts';
import { detectSensitiveUnion, buildProvenanceLine } from '../../../packages/shared/src/gate/sensitive.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const CaptureItemSchema = z.object({
  questionLabel: z.string().min(2),
  questionNorm: z.string().optional(),
  answerText: z.string().min(1),
  draftText: z.string().nullable().optional(),
  fieldSelector: z.string().optional(),
  fieldId: z.string().optional(),
  // D16: client indicates whether mapping was verified
  mappingVerified: z.boolean().optional(),
  mismatchReason: z.string().optional(),
});

const CaptureRequestSchema = z.object({
  application: z.object({
    company: z.string().optional(),
    roleTitle: z.string().optional(),
    site: z.string().optional(),
    url: z.string().optional(),
    urlHash: z.string().optional(),
  }).optional(),
  jobContext: z.object({
    role: z.string().optional(),
    company: z.string().optional(),
    url: z.string().optional(),
  }).optional(),
  answers: z.array(CaptureItemSchema).min(1).max(50),
  // When client detects mismatch, it may still send mismatches for logging
  mismatches: z.array(z.object({
    questionLabel: z.string(),
    reason: z.string(),
    originalMapping: z.unknown().optional(),
    rederivedMapping: z.unknown().optional(),
  })).optional(),
});

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
    const parsed = CaptureRequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const { answers, application, jobContext, mismatches } = parsed.data;

    // Resolve application row: use provided app or jobContext
    let applicationId: string | null = null;
    const company = application?.company ?? jobContext?.company ?? null;
    const roleTitle = application?.roleTitle ?? jobContext?.role ?? null;
    const site = application?.site ?? null;
    const url = application?.url ?? jobContext?.url ?? null;
    const urlHash = application?.urlHash ?? null;

    // Create application if we have any context and at least one answer to attach
    if (company || roleTitle || url) {
      const { data: appRow, error: appErr } = await supabase
        .from('applications')
        .insert({
          user_id: user.id,
          company,
          role_title: roleTitle,
          site,
          url,
          url_hash: urlHash,
          submitted_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (!appErr && appRow) applicationId = (appRow as { id: string }).id;
      else {
        // If insert fails (RLS etc), proceed without application link
        console.warn('[capture] application insert failed', appErr);
      }
    }

    // Log mismatches for audit (D16) — dropped writes
    if (mismatches && mismatches.length) {
      for (const mm of mismatches) {
        const { error: logErr } = await supabase.from('capture_mismatches').insert({
          user_id: user.id,
          application_id: applicationId,
          question_label: mm.questionLabel,
          original_mapping: mm.originalMapping ? JSON.parse(JSON.stringify(mm.originalMapping)) : null,
          rederived_mapping: mm.rederivedMapping ? JSON.parse(JSON.stringify(mm.rederivedMapping)) : null,
          reason: mm.reason,
        });
        if (logErr) console.warn('[capture] mismatch log failed', logErr);
      }
    }

    // S7A: fetch sensitive facts once for storage gate — option C: retry once then fail-closed (captain 2026-08-13)
    let typedFacts: import('../../../packages/shared/src/gate/sensitive.ts').SensitiveFact[] = [];
    let sensitiveFetchFailed = false;
    {
      let lastError: unknown = null;
      let success = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { data: factRows, error: factErr } = await supabase
            .from('sensitive_facts')
            .select('id, kind, value, stated_at, confirmed_at, source_application_id')
            .eq('user_id', user.id)
            .order('stated_at', { ascending: false })
            .limit(50);
          if (factErr) throw factErr;
          const rows = (factRows as unknown as { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; source_application_id: string | null }[] | null) ?? [];
          typedFacts = rows.map((r) => ({
            id: r.id,
            kind: r.kind as import('../../../packages/shared/src/gate/sensitive.ts').SensitiveFact['kind'],
            value: r.value,
            stated_at: r.stated_at,
            confirmed_at: r.confirmed_at,
            source_application_id: r.source_application_id,
          }));
          success = true;
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (attempt === 0) console.warn('[capture] sensitive facts fetch failed, retrying', e);
          else console.error('[capture] sensitive facts fetch failed after retry (fail-closed)', e);
        }
      }
      if (!success) {
        sensitiveFetchFailed = true;
        console.error('[capture] fail-closed after retry, dropping capture batch', lastError);
      }
    }
    if (sensitiveFetchFailed) {
      return jsonResponse(
        {
          error: 'sensitive_detected',
          code: 'sensitive_rejected',
          message: 'Could not verify sensitivity — capture aborted, please retry.',
          sensitiveKind: null,
          sensitiveVia: null,
          sensitiveFact: null,
          inserted: 0,
          droppedSensitive: answers.length,
          droppedMismatched: 0,
        },
        409,
      );
    }

    const inserted: string[] = [];
    let droppedMismatched = 0;
    let droppedSensitive = 0;
    const sensitiveRejections: Array<{ questionLabel: string; sensitiveKind: string | null; sensitiveVia: string | null; sensitiveFact: { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; provenanceLine: string } | null }> = [];

    for (const ans of answers) {
      // D16: fail closed — only a write explicitly marked verified survives.
      // A missing flag is treated the same as an explicit false.
      if (ans.mappingVerified !== true) {
        droppedMismatched++;
        // also log this specific drop if not already in mismatches
        const { error: logErr } = await supabase.from('capture_mismatches').insert({
          user_id: user.id,
          application_id: applicationId,
          question_label: ans.questionLabel,
          original_mapping: ans.fieldSelector ? { selector: ans.fieldSelector, id: ans.fieldId } : null,
          rederived_mapping: null,
          reason: ans.mismatchReason ?? (ans.mappingVerified === false
            ? 'mapping mismatch (client-verified false)'
            : 'mapping verification missing (fail-closed)'),
        });
        if (logErr) console.warn('[capture] mismatch log failed', logErr);
        continue;
      }

      const trimmedAnswer = ans.answerText.trim();
      if (!trimmedAnswer) continue;

      const qLabel = ans.questionLabel.trim();
      const qNorm = ans.questionNorm?.trim() ? ans.questionNorm!.trim() : normalizeQuestion(qLabel);

      // S7A sensitive storage gate — reject-and-redirect before any write
      // Check combined question+answer (covers both question-sensitive and answer-sensitive)
      // Never silently reclassify into sensitive_facts; just drop and route to confirm UI.
      const combinedForSensitive = `${qLabel} ${trimmedAnswer}`;
      let sensitiveHit: ReturnType<typeof detectSensitiveUnion> | null = null;
      try {
        // check combined first, then individual to prioritize any hit
        const c = detectSensitiveUnion(combinedForSensitive, typedFacts);
        if (c.isSensitive) sensitiveHit = c;
        else {
          const a = detectSensitiveUnion(trimmedAnswer, typedFacts);
          if (a.isSensitive) sensitiveHit = a;
          else {
            const q = detectSensitiveUnion(qLabel, typedFacts);
            if (q.isSensitive) sensitiveHit = q;
          }
        }
      } catch (e) {
        console.error('[capture] sensitive check error (fail-closed)', e);
        sensitiveHit = { isSensitive: true, kind: null, via: null, ruleHit: null, retrievalHit: null, fact: null };
      }
      if (sensitiveHit?.isSensitive) {
        droppedSensitive++;
        let factPayload: { id: string; kind: string; value: string; stated_at: string; confirmed_at: string | null; provenanceLine: string } | null = null;
        if (sensitiveHit.fact) {
          factPayload = {
            id: sensitiveHit.fact.id,
            kind: sensitiveHit.fact.kind,
            value: sensitiveHit.fact.value,
            stated_at: sensitiveHit.fact.stated_at,
            confirmed_at: sensitiveHit.fact.confirmed_at ?? null,
            provenanceLine: buildProvenanceLine(sensitiveHit.fact),
          };
        }
        sensitiveRejections.push({
          questionLabel: qLabel,
          sensitiveKind: sensitiveHit.kind,
          sensitiveVia: sensitiveHit.via,
          sensitiveFact: factPayload,
        });
        continue;
      }

      const { origin, editDistance } = deriveOrigin(ans.draftText ?? null, trimmedAnswer);

      // embedding for qa_pairs (for seen-before)
      let embedding: number[] | null = null;
      try {
        const toEmbed = `${qLabel} ${trimmedAnswer}`.slice(0, 2000);
        embedding = await new Supabase.ai.Session('gte-small').run(toEmbed, { mean_pool: true, normalize: true });
      } catch {
        embedding = null;
      }

      const qaPayload: Record<string, unknown> = {
        user_id: user.id,
        application_id: applicationId,
        question_label: qLabel,
        question_norm: qNorm,
        answer_text: trimmedAnswer,
        draft_text: ans.draftText ?? null,
        origin,
        edit_distance: editDistance,
        embedding: embedding ? JSON.stringify(embedding) : null,
      };

      const { data: qaRow, error: qaErr } = await supabase
        .from('qa_pairs')
        .insert(qaPayload)
        .select('id')
        .single();

      if (qaErr || !qaRow) {
        console.warn('[capture] qa_pairs insert failed', qaErr);
        // retry without embedding if embedding column was issue
        if (embedding) {
          const { data: qaRow2, error: qaErr2 } = await supabase
            .from('qa_pairs')
            .insert({ ...qaPayload, embedding: null })
            .select('id')
            .single();
          if (qaErr2 || !qaRow2) {
            console.error('[capture] qa_pairs insert failed without embedding', qaErr2);
            continue;
          }
          inserted.push((qaRow2 as { id: string }).id);
        } else {
          continue;
        }
      } else {
        inserted.push((qaRow as { id: string }).id);
      }

      // Also chunk into memory_chunks for retrieval (D12 growth loop)
      const insertedId = inserted[inserted.length - 1];
      // Only chunk if answer is substantive (>10 chars)
      if (trimmedAnswer.length >= 10) {
        try {
          let memEmb: number[] | null = null;
          try {
            memEmb = await new Supabase.ai.Session('gte-small').run(trimmedAnswer, { mean_pool: true, normalize: true });
          } catch { memEmb = null; }
          // determine next chunk_index
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
          const { error: memErr } = await supabase.from('memory_chunks').insert(memPayload);
          if (memErr) {
            // retry without embedding
            if (memEmb) {
              await supabase.from('memory_chunks').insert({ ...memPayload, embedding: null });
            }
          }
          // success: linked implicitly via text; no fk to qa_pairs needed
          void insertedId;
        } catch (e) {
          console.warn('[capture] memory_chunks insert failed', e);
        }
      }
    }

    return jsonResponse({
      ok: true,
      applicationId,
      inserted: inserted.length,
      insertedIds: inserted,
      droppedMismatched,
      droppedSensitive,
      sensitiveRejections,
      mismatchesLogged: mismatches?.length ?? 0,
    }, 200);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
