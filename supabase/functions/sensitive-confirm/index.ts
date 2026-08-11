// S5c: sensitive-confirm — confirm/update writes back to sensitive_facts (D17)
// Confirm: set confirmed_at on latest fact of kind (via UPDATE if RLS allows, else INSERT new row with confirmed_at)
// Update: insert new row with fresh stated_at, no confirmed_at, new value
// Both use anon-key + user JWT, so RLS scoped. Existing policy allows INSERT; UPDATE may not exist, so we handle both.

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeaders } from '../_shared/cors.ts';

const SENSITIVE_KINDS = ['salary', 'notice_period', 'work_authorization', 'location'] as const;

const RequestSchema = z.object({
  kind: z.enum(SENSITIVE_KINDS),
  action: z.enum(['confirm', 'update']),
  value: z.string().min(1).max(500).optional(),
  // optional fact id to confirm (if not supplied, latest of kind is used)
  factId: z.string().uuid().optional(),
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
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: parsed.error.flatten() }, 400);

    const { kind, action, value, factId } = parsed.data;

    if (action === 'confirm') {
      // Find fact to confirm: by factId if given, else latest of kind
      type SensitiveFactRow = { id: string; kind: string; value: string; stated_at: string };
      let fact: SensitiveFactRow | null = null;
      if (factId) {
        const { data } = await supabase.from('sensitive_facts').select('id, kind, value, stated_at').eq('id', factId).eq('user_id', user.id).eq('kind', kind).maybeSingle();
        fact = data as unknown as SensitiveFactRow | null;
      } else {
        const { data } = await supabase
          .from('sensitive_facts')
          .select('id, kind, value, stated_at')
          .eq('user_id', user.id)
          .eq('kind', kind)
          .order('stated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        fact = data as unknown as SensitiveFactRow | null;
      }
      if (!fact) return jsonResponse({ error: `No fact found for kind ${kind}` }, 404);

      // Prefer INSERT path to stay within RLS INSERT-only (no update policy). Use UPDATE only if it actually affects a row.
      const nowIso = new Date().toISOString();
      // Try UPDATE with select to verify it actually updated
      try {
        const { data: updData, error: updErr } = await supabase
          .from('sensitive_facts')
          .update({ confirmed_at: nowIso })
          .eq('id', fact.id)
          .eq('user_id', user.id)
          .select('id, kind, value, stated_at, confirmed_at')
          .maybeSingle();
        if (!updErr && updData) {
          const row = updData as unknown as { id: string; kind: string; value: string; stated_at: string; confirmed_at: string };
          return jsonResponse({ ok: true, id: row.id, kind: row.kind, value: row.value, stated_at: row.stated_at, confirmed_at: row.confirmed_at, method: 'update' }, 200);
        }
      } catch {
        // fall through to insert
      }
      // Fallback: INSERT new row with confirmed_at (keeps RLS INSERT-only working)
      const { data: inserted, error: insErr } = await supabase
        .from('sensitive_facts')
        .insert({
          user_id: user.id,
          kind,
          value: fact.value,
          stated_at: nowIso,
          confirmed_at: nowIso,
        })
        .select('id, kind, value, stated_at, confirmed_at')
        .single();
      if (insErr || !inserted) return jsonResponse({ error: `Could not confirm: ${insErr?.message ?? 'unknown'}` }, 500);
      return jsonResponse({ ok: true, ...(inserted as unknown as Record<string, unknown>), method: 'insert' }, 200);
    }

    // action === 'update'
    if (!value || !value.trim()) return jsonResponse({ error: 'value required for update' }, 400);
    const trimmed = value.trim();
    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await supabase
      .from('sensitive_facts')
      .insert({
        user_id: user.id,
        kind,
        value: trimmed,
        stated_at: nowIso,
        confirmed_at: null,
      })
      .select('id, kind, value, stated_at, confirmed_at')
      .single();
    if (insErr || !inserted) return jsonResponse({ error: `Could not update: ${insErr?.message ?? 'unknown'}` }, 500);
    return jsonResponse({ ok: true, ...(inserted as unknown as Record<string, unknown>), method: 'insert' }, 200);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
