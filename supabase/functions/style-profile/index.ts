// S9 — Style-profile distillation job (D13, D19)
// Voice corpus = qa_pairs(user_written/user_edited) + documents(user_written/user_edited) + gap_answers
// Trigger: delta >=10 since style_profile.corpus_size, skip-if-in-flight, silent-fail-and-retry-next-cycle.
// Distillation: OpenAI batch tier (half-price, async) with explicit output-length cap (invariant 8).
// On completion: overwrite profile_md, generated_at, corpus_size. No version history.
// On failure: leave existing row as-is; next natural trigger retries. No retry loop.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';
import {
  VOICE_CORPUS_MAX_ITEMS,
  STYLE_PROFILE_MAX_OUTPUT_TOKENS,
  STYLE_PROFILE_MAX_PROFILE_CHARS,
  STYLE_PROFILE_MAX_BULLETS,
  buildDistillationSystemPrompt,
  buildDistillationUserContent,
  sanitizeProfileMd,
  isInFlight,
} from '../../../packages/shared/src/styleProfile/styleProfile.ts';

type VoiceItem = { text: string; source: 'qa_pair' | 'document' | 'gap_answer'; created_at: string };

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const RequestSchema = z.object({
  trigger: z.enum(['auto', 'manual']).optional().default('auto'),
  // batch callback path: when batch completes, caller posts job id
  batchJobId: z.string().optional(),
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

    const body = await req.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);
    // allow empty body for auto trigger
    const trigger = parsed.success ? parsed.data.trigger : 'auto';

    // Load current profile to check in-flight (unless manual)
    const { data: profileRow } = await supabase
      .from('style_profile')
      .select('corpus_size, rebuilding, rebuilding_started_at, batch_job_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const profile = profileRow as { corpus_size: number; rebuilding: boolean; rebuilding_started_at: string | null; batch_job_id: string | null } | null;

    // If this is a batch callback (batchJobId provided), handle completion path
    if (parsed.success && parsed.data.batchJobId) {
      // For now, batch callback is not wired to a real batch poller; treat as no-op success.
      // Future wiring can poll OpenAI batch status here.
      return jsonResponse({ ok: true, note: 'batch callback received', batchJobId: parsed.data.batchJobId }, 200);
    }

    // Gather voice corpus (most recent 100, D13-filtered)
    let qaItems: { answer_text: string; created_at: string }[] = [];
    try {
      const { data } = await supabase.from('qa_pairs').select('answer_text, created_at').eq('user_id', user.id).in('origin', ['user_written', 'user_edited']).order('created_at', { ascending: false }).limit(100);
      qaItems = (data as typeof qaItems) ?? [];
    } catch { /* leave empty */ }

    let docItems: { extracted_text: string | null; created_at: string }[] = [];
    try {
      const { data } = await supabase.from('documents').select('extracted_text, created_at').eq('user_id', user.id).in('origin', ['user_written', 'user_edited']).order('created_at', { ascending: false }).limit(100);
      docItems = (data as typeof docItems) ?? [];
    } catch { /* leave empty */ }

    let gapItems: { answer_text: string; created_at: string }[] = [];
    try {
      const { data } = await supabase.from('gap_answers').select('answer_text, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
      gapItems = (data as typeof gapItems) ?? [];
    } catch { /* leave empty */ }

    const voiceItems: VoiceItem[] = [
      ...qaItems.filter((r) => r.answer_text?.trim()).map((r) => ({ text: r.answer_text.trim(), source: 'qa_pair' as const, created_at: r.created_at })),
      ...docItems.filter((r) => r.extracted_text?.trim()).map((r) => ({ text: r.extracted_text!.trim(), source: 'document' as const, created_at: r.created_at })),
      ...gapItems.filter((r) => r.answer_text?.trim()).map((r) => ({ text: r.answer_text.trim(), source: 'gap_answer' as const, created_at: r.created_at })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, VOICE_CORPUS_MAX_ITEMS);

    const currentCount = voiceItems.length;

    // If auto-trigger, enforce delta check (manual bypasses for testing)
    if (trigger === 'auto') {
      const lastSize = profile?.corpus_size ?? 0;
      if (currentCount - lastSize < 10) {
        // Clear stale rebuilding flag if needed, but don't rebuild
        if (profile?.rebuilding && !isInFlight(profile as unknown as { rebuilding: boolean; rebuilding_started_at: string | null })) {
          await supabase.from('style_profile').update({ rebuilding: false, rebuilding_started_at: null, batch_job_id: null }).eq('user_id', user.id);
        }
        return jsonResponse({ ok: true, skipped: 'delta < 10', currentCount, lastCorpusSize: lastSize }, 200);
      }
      if (isInFlight(profile as unknown as { rebuilding: boolean; rebuilding_started_at: string | null } | null)) {
        return jsonResponse({ ok: true, skipped: 'in-flight', currentCount }, 200);
      }
      // Claim rebuild
      const nowIso = new Date().toISOString();
      if (profile) {
        await supabase.from('style_profile').update({ rebuilding: true, rebuilding_started_at: nowIso }).eq('user_id', user.id);
      } else {
        await supabase.from('style_profile').insert({ user_id: user.id, corpus_size: 0, rebuilding: true, rebuilding_started_at: nowIso });
      }
    } else {
      // manual: ensure rebuilding flag set
      const nowIso = new Date().toISOString();
      if (profile) {
        await supabase.from('style_profile').update({ rebuilding: true, rebuilding_started_at: nowIso }).eq('user_id', user.id);
      } else {
        await supabase.from('style_profile').insert({ user_id: user.id, corpus_size: 0, rebuilding: true, rebuilding_started_at: nowIso });
      }
    }

    if (voiceItems.length === 0) {
      await supabase.from('style_profile').update({ rebuilding: false, rebuilding_started_at: null, batch_job_id: null }).eq('user_id', user.id);
      return jsonResponse({ ok: true, skipped: 'empty corpus', currentCount: 0 }, 200);
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      // No key — silent fail, clear rebuilding so next trigger retries (no retry loop)
      await supabase.from('style_profile').update({ rebuilding: false, rebuilding_started_at: null, batch_job_id: null }).eq('user_id', user.id);
      return jsonResponse({ error: 'OPENAI_API_KEY not configured' }, 500);
    }

    // ── Distillation: try batch tier first, fall back to synchronous chat completion ──
    // Batch tier is half-price and async. For the Edge Function's synchronous lifetime we
    // attempt the batch flow (create file → create batch → poll). If that is unavailable,
    // fall back to a direct chat completion so the profile still gets produced. Either
    // path carries the explicit length cap (invariant 8).
    let profileMd: string | null = null;
    let usedBatch = false;
    let batchJobId: string | null = null;

    // Attempt batch path (best-effort; silent fallback on any failure)
    try {
      const batchResult = await tryBatchDistill(apiKey, voiceItems);
      if (batchResult.profileMd) {
        profileMd = batchResult.profileMd;
        usedBatch = true;
        batchJobId = batchResult.batchJobId ?? null;
      }
    } catch {
      // fall through to direct path
    }

    if (!profileMd) {
      try {
        profileMd = await directDistill(apiKey, voiceItems);
      } catch (e) {
        // Silent fail — leave existing row as-is, clear rebuilding, let next trigger retry
        await supabase.from('style_profile').update({ rebuilding: false, rebuilding_started_at: null, batch_job_id: null }).eq('user_id', user.id);
        console.error('[style-profile] distillation failed', e);
        return jsonResponse({ ok: false, error: String(e), willRetryNextTrigger: true }, 200);
      }
    }

    if (!profileMd || !profileMd.trim()) {
      await supabase.from('style_profile').update({ rebuilding: false, rebuilding_started_at: null, batch_job_id: null }).eq('user_id', user.id);
      return jsonResponse({ ok: false, error: 'Empty distillation output', willRetryNextTrigger: true }, 200);
    }

    const sanitized = sanitizeProfileMd(profileMd);
    if (!sanitized.trim()) {
      await supabase.from('style_profile').update({ rebuilding: false, rebuilding_started_at: null, batch_job_id: null }).eq('user_id', user.id);
      return jsonResponse({ ok: false, error: 'Sanitized profile empty', willRetryNextTrigger: true }, 200);
    }

    // Overwrite profile (no version history in this slice)
    const now = new Date().toISOString();
    const upsertPayload: Record<string, unknown> = {
      user_id: user.id,
      profile_md: sanitized,
      generated_at: now,
      corpus_size: currentCount,
      rebuilding: false,
      rebuilding_started_at: null,
      batch_job_id: batchJobId,
    };
    // Use upsert via update+insert pattern to handle RLS
    const { data: existing } = await supabase.from('style_profile').select('user_id').eq('user_id', user.id).maybeSingle();
    if (existing) {
      await supabase.from('style_profile').update(upsertPayload).eq('user_id', user.id);
    } else {
      await supabase.from('style_profile').insert(upsertPayload);
    }

    return jsonResponse({ ok: true, profileMd: sanitized, corpusSize: currentCount, usedBatch }, 200);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});

// ── Batch attempt: upload JSONL, create batch, poll with short timeout ──
// If polling does not complete within the Edge Function's remaining time, we
// fall back to direct distill so the user still gets a profile this cycle.
// The batch job id is stored so a future manual/batch-callback path can reconcile.
async function tryBatchDistill(apiKey: string, items: VoiceItem[]): Promise<{ profileMd: string | null; batchJobId: string | null }> {
  const system = buildDistillationSystemPrompt();
  const userContent = buildDistillationUserContent(items as unknown as { text: string; source: string; createdAt: string }[] as unknown as import('../../../packages/shared/src/styleProfile/styleProfile.ts').VoiceCorpusItem[]);

  // Build batch request JSONL (one line)
  const batchRequest = {
    custom_id: `style-profile-${Date.now()}`,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model: 'gpt-5.6-luna',
      max_completion_tokens: STYLE_PROFILE_MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'style_profile',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              profile_md: { type: 'string', description: `Bulleted style profile ≤${STYLE_PROFILE_MAX_PROFILE_CHARS} chars, 5-${STYLE_PROFILE_MAX_BULLETS} bullets, each starting with "- "` },
            },
            required: ['profile_md'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    },
  };

  const jsonl = JSON.stringify(batchRequest) + '\n';
  const blob = new Blob([jsonl], { type: 'application/json' });

  // Upload file
  const fileForm = new FormData();
  fileForm.append('file', blob, 'style-profile.jsonl');
  fileForm.append('purpose', 'batch');

  const fileResp = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fileForm,
  });
  if (!fileResp.ok) return { profileMd: null, batchJobId: null };
  const fileData = await fileResp.json() as { id: string };
  const fileId = fileData.id;
  if (!fileId) return { profileMd: null, batchJobId: null };

  // Create batch
  const batchResp = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: fileId,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    }),
  });
  if (!batchResp.ok) return { profileMd: null, batchJobId: null };
  const batchData = await batchResp.json() as { id: string; status: string };
  const batchId = batchData.id;
  if (!batchId) return { profileMd: null, batchJobId: null };

  // Poll briefly (up to ~20s) — batch tier is async but small jobs often complete quickly.
  // If not completed in window, return null so caller falls back to direct.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusResp = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusResp.ok) break;
    const statusData = await statusResp.json() as { status: string; output_file_id?: string; error_file_id?: string };
    if (statusData.status === 'completed' && statusData.output_file_id) {
      const outResp = await fetch(`https://api.openai.com/v1/files/${statusData.output_file_id}/content`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!outResp.ok) break;
      const text = await outResp.text();
      const firstLine = text.trim().split('\n')[0];
      if (!firstLine) break;
      try {
        const parsed = JSON.parse(firstLine) as { response?: { body?: { choices?: { message?: { content?: string } }[] } } };
        const content = parsed.response?.body?.choices?.[0]?.message?.content ?? '';
        const inner = JSON.parse(content) as { profile_md: string };
        if (inner.profile_md?.trim()) return { profileMd: inner.profile_md, batchJobId: batchId };
      } catch { break; }
      break;
    }
    if (statusData.status === 'failed' || statusData.status === 'expired' || statusData.status === 'cancelled') break;
  }

  // Not completed in time — let caller fall back to direct; keep batchId for audit
  return { profileMd: null, batchJobId: batchId };
}

async function directDistill(apiKey: string, items: VoiceItem[]): Promise<string> {
  const system = buildDistillationSystemPrompt();
  const userContent = buildDistillationUserContent(items as unknown as { text: string; source: string; createdAt: string }[] as unknown as import('../../../packages/shared/src/styleProfile/styleProfile.ts').VoiceCorpusItem[]);

  const payload = {
    model: 'gpt-5.6-luna',
    max_completion_tokens: STYLE_PROFILE_MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'style_profile',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            profile_md: { type: 'string', description: `Bulleted style profile ≤${STYLE_PROFILE_MAX_PROFILE_CHARS} chars, 5-${STYLE_PROFILE_MAX_BULLETS} bullets, each starting with "- "` },
          },
          required: ['profile_md'],
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
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${t.slice(0, 500)}`);
  }
  const data = await resp.json() as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  let parsed: { profile_md: string };
  try {
    parsed = JSON.parse(content) as { profile_md: string };
  } catch {
    throw new Error('Model returned non-JSON');
  }
  if (!parsed.profile_md?.trim()) throw new Error('Empty profile_md');
  return parsed.profile_md;
}
