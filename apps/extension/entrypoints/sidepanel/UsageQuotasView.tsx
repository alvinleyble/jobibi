import { useState, useEffect, useCallback } from 'react';
import { DAILY_SUGGESTION_LIMIT, WEEKLY_COVER_LETTER_LIMIT } from '@jobibi/shared';
import { supabase } from './supabase';

interface UsageQuotasViewProps {
  userId: string;
  isBetaTester: boolean;
}

export function UsageQuotasView({ userId, isBetaTester }: UsageQuotasViewProps) {
  const [dailyDecisionsUsed, setDailyDecisionsUsed] = useState(0);
  const [coverLettersUsed, setCoverLettersUsed] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchQuotas = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Daily suggestions count
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      const { count: dailyCount } = (await supabase
        .from('gate_decisions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', todayUtc.toISOString())) as unknown as { count: number | null };
      setDailyDecisionsUsed(dailyCount ?? 0);

      // 2. Weekly cover letters count
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: coverCount } = (await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('kind', 'cover_letter')
        .gte('created_at', sevenDaysAgo)) as unknown as { count: number | null };
      setCoverLettersUsed(coverCount ?? 0);
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
  const coverRemaining = Math.max(0, WEEKLY_COVER_LETTER_LIMIT - coverLettersUsed);

  const dailyPercent = isBetaTester ? 0 : Math.min(100, (dailyDecisionsUsed / DAILY_SUGGESTION_LIMIT) * 100);
  const coverPercent = isBetaTester ? 0 : Math.min(100, (coverLettersUsed / WEEKLY_COVER_LETTER_LIMIT) * 100);

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
      <div className="rounded-[10px] border border-card-border bg-card p-3.5">
        <h3 className="text-[13.5px] font-bold text-ink">Cover letter drafting</h3>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-md bg-recess">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${coverPercent}%` }}
          />
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted" data-testid="weekly-cover-quota-status">
          {loading
            ? 'Loading quota…'
            : isBetaTester
              ? '📄 Unlimited (Beta Tester)'
              : `📄 ${coverLettersUsed} of ${WEEKLY_COVER_LETTER_LIMIT} used this week (${coverRemaining} remaining) · resets in 7 days`}
        </p>
      </div>

      {/* Footnote */}
      <p className="text-[12px] leading-[1.5] text-ink-muted">
        Beta testers get unlimited suggestions and cover letters.
      </p>
    </div>
  );
}
