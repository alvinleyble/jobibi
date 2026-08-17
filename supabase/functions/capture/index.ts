// S6: capture — the growth loop (D12/D13/D16)
// Stores each submitted answer in qa_pairs with draft_text, origin, edit_distance.
// Also chunks into memory_chunks for future retrieval.
// Verifies mapping via client-provided verification flag; drops mismatched writes.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import { triggerStyleProfileRebuildInBackground } from '../_shared/styleProfileTrigger.ts';
import { normalizeQuestion } from '../../../packages/shared/src/gate/normalize.ts';
import { deriveOrigin, scoreNearDuplicate, scoreMemoryChunkDuplicate, MEMORY_CHUNK_DEDUP_THRESHOLD } from '../../../packages/shared/src/capture/capture.ts';
import { keywordOverlap, hybridScore } from '../../../packages/shared/src/gate/retrieve.ts';

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

  // Track saved state outside so catch block has visibility for truthful error responses
  const inserted: string[] = [];
  let applicationId: string | null = null;
  let droppedMismatched = 0;
  let memoryChunksFailed = 0;
  let dedupSkipped = 0;
  let mismatchesCount = 0;
  let failedItems = 0;

  const captureSuccessResponse = () => jsonResponse({
    ok: true,
    applicationId,
    inserted: inserted.length,
    insertedIds: inserted,
    droppedMismatched,
    droppedSensitive: 0,
    memoryChunksFailed,
    dedupSkipped,
    failedItems,
    sensitiveRejections: [],
    mismatchesLogged: mismatchesCount,
  }, 200);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Please sign in to save application answers.' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: 'Your session has expired. Please sign in again.' }, 401);

    const body = await req.json().catch(() => null);
    const parsed = CaptureRequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: 'Please provide valid application answers to save.' }, 400);

    const { answers, application, jobContext, mismatches } = parsed.data;
    mismatchesCount = mismatches?.length ?? 0;

    // Instantiate embedder session once at request scope
    let embedder: { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } | null = null;
    try {
      embedder = new Supabase.ai.Session('gte-small');
    } catch {
      embedder = null;
    }
    const getEmbedding = async (text: string, opts = { mean_pool: true, normalize: true }): Promise<number[] | null> => {
      if (!embedder) return null;
      try {
        return await embedder.run(text.slice(0, 2000), opts);
      } catch {
        return null;
      }
    };

    // Resolve application row: use provided app or jobContext
    const company = application?.company ?? jobContext?.company ?? null;
    const roleTitle = application?.roleTitle ?? jobContext?.role ?? null;
    const site = application?.site ?? null;
    const url = application?.url ?? jobContext?.url ?? null;
    const urlHash = application?.urlHash ?? null;

    // Create application if we have any context and at least one answer to attach
    if (company || roleTitle || url) {
      try {
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
      } catch (appExc) {
        console.warn('[capture] application insert exception', appExc);
      }
    }

    // Log mismatches for audit (D16) — dropped writes
    if (mismatches && mismatches.length) {
      for (const mm of mismatches) {
        try {
          const { error: logErr } = await supabase.from('capture_mismatches').insert({
            user_id: user.id,
            application_id: applicationId,
            question_label: mm.questionLabel,
            original_mapping: mm.originalMapping ? JSON.parse(JSON.stringify(mm.originalMapping)) : null,
            rederived_mapping: mm.rederivedMapping ? JSON.parse(JSON.stringify(mm.rederivedMapping)) : null,
            reason: mm.reason,
          });
          if (logErr) console.warn('[capture] mismatch log failed', logErr);
        } catch (logExc) {
          console.warn('[capture] mismatch log exception', logExc);
        }
      }
    }

    // Pre-fetch dedup candidates for vector deduplication (>=0.90 hybrid)
    let dedupQaRows: Array<{ id: string; question_label: string; question_norm: string; embedding: unknown }> = [];
    let dedupChunks: Array<{ id: string; text: string; embedding: unknown }> = [];
    try {
      const [qaRes, chunkRes] = await Promise.all([
        supabase.from('qa_pairs').select('id, question_label, question_norm, embedding').eq('user_id', user.id).limit(500),
        supabase.from('memory_chunks').select('id, text, embedding').eq('user_id', user.id).eq('type', 'qa_pair').limit(500),
      ]);
      if (!qaRes.error && qaRes.data) dedupQaRows = qaRes.data as typeof dedupQaRows;
      if (!chunkRes.error && chunkRes.data) dedupChunks = chunkRes.data as typeof dedupChunks;
    } catch {
      // fail open for dedup fetch — proceed without deduplication
    }
    const insertedQLabelsThisBatch: string[] = [];

    // Query max chunk_index once before the answer loop
    let nextChunkIndex = 0;
    try {
      const nextIdxRes = await supabase
        .from('memory_chunks')
        .select('chunk_index')
        .eq('user_id', user.id)
        .order('chunk_index', { ascending: false })
        .limit(1);
      const rows = (nextIdxRes.data as unknown as { chunk_index: number }[] | null) ?? [];
      nextChunkIndex = rows.length ? rows[0].chunk_index + 1 : 0;
    } catch {
      nextChunkIndex = 0;
    }

    for (const ans of answers) {
      try {
        // D16: fail closed — only a write explicitly marked verified survives.
        // A missing flag is treated the same as an explicit false.
        if (ans.mappingVerified !== true) {
          droppedMismatched++;
          // also log this specific drop if not already in mismatches
          try {
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
          } catch (logExc) {
            console.warn('[capture] mismatch log exception', logExc);
          }
          continue;
        }

        const trimmedAnswer = ans.answerText.trim();
        if (!trimmedAnswer) continue;

        const qLabel = ans.questionLabel.trim();
        const qNorm = ans.questionNorm?.trim() ? ans.questionNorm!.trim() : normalizeQuestion(qLabel);

        const { origin, editDistance } = deriveOrigin(ans.draftText ?? null, trimmedAnswer);

        // embedding for qa_pairs (for seen-before)
        const embedding = await getEmbedding(`${qLabel} ${trimmedAnswer}`);

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
              failedItems++;
              continue;
            }
            inserted.push((qaRow2 as { id: string }).id);
          } else {
            failedItems++;
            continue;
          }
        } else {
          inserted.push((qaRow as { id: string }).id);
        }

        // Also chunk into memory_chunks for retrieval (D12 growth loop) — with vector deduplication (>=0.90 hybrid)
        const insertedId = inserted[inserted.length - 1];
        // Keep dedup candidate list in sync: add this question to qa cache so later answers in same batch dedup against it
        dedupQaRows.push({ id: insertedId, question_label: qLabel, question_norm: qNorm, embedding: embedding ? JSON.stringify(embedding) : null });
        // Only chunk if answer is substantive (>10 chars)
        if (trimmedAnswer.length >= 10) {
          // Check near-duplicate before inserting memory_chunks
          let isDuplicate = false;
          try {
            // try to embed question for hybrid cosine comparison (fail open to keyword-only)
            const qEmb = await getEmbedding(qLabel);
            for (const c of dedupQaRows.slice(0, -1)) {
              // exclude the just-pushed current row itself; check against prior rows only
              const s = scoreNearDuplicate(qLabel, { id: c.id, question_label: c.question_label, question_norm: c.question_norm, answer_text: '' , embedding: c.embedding as string | null } as never, { questionEmbedding: qEmb });
              if (s >= MEMORY_CHUNK_DEDUP_THRESHOLD) { isDuplicate = true; break; }
            }
            if (!isDuplicate) {
              for (const ch of dedupChunks) {
                const s = scoreMemoryChunkDuplicate(qLabel, { id: ch.id, text: ch.text, embedding: ch.embedding as string | null }, { questionEmbedding: qEmb });
                if (s >= MEMORY_CHUNK_DEDUP_THRESHOLD) { isDuplicate = true; break; }
              }
            }
            if (!isDuplicate && insertedQLabelsThisBatch.length) {
              for (const prevQ of insertedQLabelsThisBatch) {
                const kw = keywordOverlap(qLabel, prevQ);
                if (hybridScore(kw, kw) >= MEMORY_CHUNK_DEDUP_THRESHOLD) { isDuplicate = true; break; }
              }
            }
          } catch {
            // on scoring error, do not deduplicate
          }
          if (isDuplicate) {
            dedupSkipped++;
          } else {
            try {
              const memEmb = await getEmbedding(trimmedAnswer);
              const memPayload: Record<string, unknown> = {
                user_id: user.id,
                document_id: null,
                chunk_index: nextChunkIndex++,
                type: 'qa_pair',
                text: `Q: ${qLabel}\nA: ${trimmedAnswer}`,
                embedding: memEmb ? JSON.stringify(memEmb) : null,
              };
              const { data: memRow, error: memErr } = await supabase.from('memory_chunks').insert(memPayload).select('id').single();
              if (memErr) {
                let recovered = false;
                if (memEmb) {
                  const { data: memRow2, error: memErr2 } = await supabase.from('memory_chunks').insert({ ...memPayload, embedding: null }).select('id').single();
                  if (!memErr2 && memRow2) recovered = true;
                  else console.error('[capture] memory_chunks insert failed (after retry)', memErr2 ?? memErr);
                } else {
                  console.error('[capture] memory_chunks insert failed', memErr);
                }
                if (!recovered) memoryChunksFailed++;
              } else {
                void memRow;
                // track successful memory chunk for intra-batch dedup
                const newChunkId = (memRow as { id: string }).id;
                dedupChunks.push({ id: newChunkId, text: `Q: ${qLabel}\nA: ${trimmedAnswer}`, embedding: memEmb ? JSON.stringify(memEmb) : null });
                insertedQLabelsThisBatch.push(qLabel);
              }
              void insertedId;
            } catch (e) {
              memoryChunksFailed++;
              console.error('[capture] memory_chunks insert failed', e);
            }
          }
        }
      } catch (itemErr) {
        failedItems++;
        console.error('[capture] error processing answer item:', ans.questionLabel, itemErr);
      }
    }

    // Nothing was saved and at least one answer failed outright — do not claim success.
    if (inserted.length === 0 && failedItems > 0) {
      return jsonResponse({ error: 'We could not save your application answers. Please try again.' }, 500);
    }

    // S9: voice-corpus trigger — style-profile owns claim/in-flight (non-blocking background task)
    if (inserted.length > 0) {
      triggerStyleProfileRebuildInBackground(supabase, user.id, authHeader, Deno.env.get('SUPABASE_URL')!);
    }

    return captureSuccessResponse();
  } catch (e) {
    console.error('[capture] unexpected error:', e);
    if (inserted.length > 0) {
      // Truthful error handling: at least one answer was successfully saved to DB.
      // Return 200 with the saved answer IDs and degrade gracefully.
      return captureSuccessResponse();
    }
    return jsonResponse({ error: 'An unexpected error occurred while saving your application answers. Please try again.' }, 500);
  }
});

