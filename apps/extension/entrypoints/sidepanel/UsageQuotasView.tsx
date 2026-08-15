import { useState, useEffect, useCallback } from 'react';
import {
  DAILY_SUGGESTION_LIMIT,
  DAILY_COVER_LETTER_LIMIT,
  DAILY_COVER_LETTER_ATTEMPT_LIMIT,
} from '@jobibi/shared';
import { supabase } from './supabase';

interface UsageQuotasViewProps {
  userId: string;
  isBetaTester: boolean;
}

export function UsageQuotasView({ userId, isBetaTester }: UsageQuotasViewProps) {
  const [dailyDecisionsUsed, setDailyDecisionsUsed] = useState(0);
  const [coverLettersUsed, setCoverLettersUsed] = useState(0);
  const [coverAttemptsUsed, setCoverAttemptsUsed] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchQuotas = useCallback(async () => {
    setLoading(true);
    try {
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);

      // 1. Daily suggestions count
      const { count: dailyCount } = (await supabase
        .from('gate_decisions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', todayUtc.toISOString())) as unknown as { count: number | null };
      setDailyDecisionsUsed(dailyCount ?? 0);

      // 2. Daily cover letters count (saved to memory)
      const { count: coverCount } = (await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('kind', 'cover_letter')
        .gte('created_at', todayUtc.toISOString())) as unknown as { count: number | null };
      setCoverLettersUsed(coverCount ?? 0);

      // 3. Daily cover letter draft generations count
      const { count: attemptsCount } = (await supabase
        .from('cover_letter_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', todayUtc.toISOString())) as unknown as { count: number | null };
      setCoverAttemptsUsed(attemptsCount ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchQuotas();
  }, [fetchQuotas]);

  const dailyRemaining = Math.max(0, DAILY_SUGGESTION_LIMIT - dailyDecisionsUsed);
  const coverRemaining = Math.max(0, DAILY_COVER_LETTER_LIMIT - coverLettersUsed);
  const attemptsRemaining = Math.max(0, DAILY_COVER_LETTER_ATTEMPT_LIMIT - coverAttemptsUsed);

  const dailyPercent = isBetaTester ? 0 : Math.min(100, (dailyDecisionsUsed / DAILY_SUGGESTION_LIMIT) * 100);
  const coverPercent = isBetaTester ? 0 : Math.min(100, (coverLettersUsed / DAILY_COVER_LETTER_LIMIT) * 100);
  const attemptsPercent = isBetaTester ? 0 : Math.min(100, (coverAttemptsUsed / DAILY_COVER_LETTER_ATTEMPT_LIMIT) * 100);

  return (
    <div data-screen-label="Usage and Quotas" className="flex flex-col gap-3">
      {/* Daily Suggestions Card */}
      <div className="rounded-[10px] border border-card-border bg-card p-3.5">
        <h3 className="text-[13.5px] font-bold text-ink">Daily suggestions</h3>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-md bg-recess">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${dailyPercent}%` }}
          />
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted" data-testid="daily-quota-status">
          {loading
            ? 'Loading quota…'
            : isBetaTester
              ? '⚡ Unlimited (Beta Tester) · resets midnight UTC'
              : `⚡ ${dailyDecisionsUsed} of ${DAILY_SUGGESTION_LIMIT} used today (${dailyRemaining} remaining) · resets midnight UTC`}
        </p>
      </div>

      {/* Cover Letter Drafting Card */}
      <div className="rounded-[10px] border border-card-border bg-card p-3.5 flex flex-col gap-3">
        <h3 className="text-[13.5px] font-bold text-ink">Daily cover letters</h3>

        {/* Sub-bar 1: Saved to Memory */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px] font-semibold text-ink">
            <span>Saved to memory</span>
            {!loading && !isBetaTester && (
              <span className="text-ink-muted">
                {coverLettersUsed} / {DAILY_COVER_LETTER_LIMIT}
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-md bg-recess">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${coverPercent}%` }}
            />
          </div>
          <p className="mt-0.5 text-[11.5px] text-ink-muted" data-testid="daily-cover-quota-status">
            {loading
              ? 'Loading quota…'
              : isBetaTester
                ? '📄 Unlimited (Beta Tester)'
                : `📄 ${coverLettersUsed} of ${DAILY_COVER_LETTER_LIMIT} used today (${coverRemaining} remaining)`}
          </p>
        </div>

        {/* Sub-bar 2: Draft Generations */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px] font-semibold text-ink">
            <span>Draft generations</span>
            {!loading && !isBetaTester && (
              <span className="text-ink-muted">
                {coverAttemptsUsed} / {DAILY_COVER_LETTER_ATTEMPT_LIMIT}
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-md bg-recess">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${attemptsPercent}%` }}
            />
          </div>
          <p className="mt-0.5 text-[11.5px] text-ink-muted" data-testid="daily-cover-attempts-quota-status">
            {loading
              ? 'Loading quota…'
              : isBetaTester
                ? '⚡ Unlimited (Beta Tester) · resets midnight UTC'
                : `⚡ ${coverAttemptsUsed} of ${DAILY_COVER_LETTER_ATTEMPT_LIMIT} used today (${attemptsRemaining} remaining) · resets midnight UTC`}
          </p>
        </div>
      </div>

      {/* Footnote */}
      <p className="text-[12px] leading-[1.5] text-ink-muted">
        Beta testers get unlimited suggestions and cover letters.
      </p>
    </div>
  );
}

export default UsageQuotasView;
