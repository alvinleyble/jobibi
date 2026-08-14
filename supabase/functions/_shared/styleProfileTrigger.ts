// S9 — shared voice-corpus trigger check, called from every write path
// (capture, gap-answer, manual-input, ingest). Only checks the delta and
// fires a fire-and-forget POST; style-profile itself owns the atomic
// claim/in-flight check, so this never touches style_profile.rebuilding.
import type { SupabaseClient } from '@supabase/supabase-js';
import { VOICE_CORPUS_TRIGGER_DELTA } from '../../../packages/shared/src/styleProfile/styleProfile.ts';

export async function maybeTriggerStyleProfileRebuild(
  supabase: SupabaseClient,
  userId: string,
  authHeader: string,
  supabaseUrl: string,
): Promise<void> {
  try {
    const { count: qaCount } = await supabase.from('qa_pairs').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('origin', ['user_written', 'user_edited']) as unknown as { count: number | null };
    const { count: docCount } = await supabase.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('origin', ['user_written', 'user_edited']) as unknown as { count: number | null };
    const { count: gapCount } = await supabase.from('gap_answers').select('id', { count: 'exact', head: true }).eq('user_id', userId) as unknown as { count: number | null };
    const currentCount = (qaCount ?? 0) + (docCount ?? 0) + (gapCount ?? 0);

    const { data: sp } = await supabase.from('style_profile').select('corpus_size').eq('user_id', userId).maybeSingle();
    const lastSize = (sp as { corpus_size: number } | null)?.corpus_size ?? 0;

    if (currentCount - lastSize < VOICE_CORPUS_TRIGGER_DELTA) return;

    fetch(`${supabaseUrl}/functions/v1/style-profile`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'auto' }),
    }).catch(() => {});
  } catch { /* silent — next write retries */ }
}
