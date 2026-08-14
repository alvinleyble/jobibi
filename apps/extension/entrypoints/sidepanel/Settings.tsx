import { useState, useEffect, useCallback } from 'react';
import {
  OUTPUT_LENGTHS,
  OUTPUT_LENGTH_CONFIG,
  DAILY_SUGGESTION_LIMIT,
  WEEKLY_COVER_LETTER_LIMIT,
  type OutputLength,
} from '@jobibi/shared';
import { supabase } from './supabase';
import { humanizeErrorMessage } from './ingestError';

interface SettingsProps {
  userId: string;
  userEmail: string;
  isBetaTester: boolean;
  onClose: () => void;
}

export function Settings({ userId, userEmail, isBetaTester, onClose }: SettingsProps) {
  const [outputLength, setOutputLength] = useState<OutputLength>('short');
  const [savingLength, setSavingLength] = useState(false);
  const [lengthSavedMessage, setLengthSavedMessage] = useState<string | null>(null);
  const [lengthError, setLengthError] = useState<string | null>(null);

  // Quotas
  const [dailyDecisionsUsed, setDailyDecisionsUsed] = useState(0);
  const [coverLettersUsed, setCoverLettersUsed] = useState(0);
  const [loadingQuotas, setLoadingQuotas] = useState(true);

  // Privacy & Data
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchProfileAndQuotas = useCallback(async () => {
    setLoadingQuotas(true);
    try {
      // 1. Output length
      const { data: profile } = await supabase
        .from('profiles')
        .select('output_length')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.output_length) {
        setOutputLength(profile.output_length as OutputLength);
      }

      // 2. Daily suggestions count
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      const { count: dailyCount } = (await supabase
        .from('gate_decisions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', todayUtc.toISOString())) as unknown as { count: number | null };
      setDailyDecisionsUsed(dailyCount ?? 0);

      // 3. Weekly cover letters count
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
      setLoadingQuotas(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchProfileAndQuotas();
  }, [fetchProfileAndQuotas]);

  const onSelectLength = async (newLength: OutputLength) => {
    if (!isBetaTester && OUTPUT_LENGTH_CONFIG[newLength].premiumOnly) {
      return;
    }
    setOutputLength(newLength);
    setSavingLength(true);
    setLengthError(null);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ output_length: newLength })
        .eq('id', userId);
      if (error) {
        setLengthError(humanizeErrorMessage(error.message));
      } else {
        setLengthSavedMessage('Saved ✓');
        setTimeout(() => setLengthSavedMessage(null), 2500);
      }
    } catch (e) {
      setLengthError(humanizeErrorMessage(e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingLength(false);
    }
  };

  const onExportData = async () => {
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const [
        profilesRes,
        documentsRes,
        memoryChunksRes,
        sensitiveFactsRes,
        qaPairsRes,
        gapAnswersRes,
        styleProfileRes,
        applicationsRes,
        gateDecisionsRes,
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId),
        supabase.from('documents').select('*').eq('user_id', userId),
        supabase.from('memory_chunks').select('*').eq('user_id', userId),
        supabase.from('sensitive_facts').select('*').eq('user_id', userId),
        supabase.from('qa_pairs').select('*').eq('user_id', userId),
        supabase.from('gap_answers').select('*').eq('user_id', userId),
        supabase.from('style_profile').select('*').eq('user_id', userId),
        supabase.from('applications').select('*').eq('user_id', userId),
        supabase.from('gate_decisions').select('*').eq('user_id', userId),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        userId,
        userEmail,
        profiles: profilesRes.data ?? [],
        documents: documentsRes.data ?? [],
        memory_chunks: memoryChunksRes.data ?? [],
        sensitive_facts: sensitiveFactsRes.data ?? [],
        qa_pairs: qaPairsRes.data ?? [],
        gap_answers: gapAnswersRes.data ?? [],
        style_profile: styleProfileRes.data ?? [],
        applications: applicationsRes.data ?? [],
        gate_decisions: gateDecisionsRes.data ?? [],
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jobibi-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportSuccess('Data exported successfully!');
      setTimeout(() => setExportSuccess(null), 3000);
    } catch (err) {
      setExportError(humanizeErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  const onDeleteEverything = async () => {
    if (deleteConfirmText.trim() !== 'DELETE') {
      setDeleteError('Please type "DELETE" exactly to confirm.');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      // 1. Storage bucket purge
      try {
        const { data: storageFiles } = await supabase.storage.from('documents').list(userId);
        if (storageFiles && storageFiles.length > 0) {
          await supabase.storage
            .from('documents')
            .remove(storageFiles.map((f) => `${userId}/${f.name}`));
        }
      } catch (e) {
        console.warn('[Settings] Storage purge exception:', e);
      }

      // 2. Database rows purge
      await Promise.allSettled([
        supabase.from('memory_chunks').delete().eq('user_id', userId),
        supabase.from('sensitive_facts').delete().eq('user_id', userId),
        supabase.from('qa_pairs').delete().eq('user_id', userId),
        supabase.from('gap_answers').delete().eq('user_id', userId),
        supabase.from('documents').delete().eq('user_id', userId),
        supabase.from('style_profile').delete().eq('user_id', userId),
        supabase.from('gate_decisions').delete().eq('user_id', userId),
        supabase.from('capture_mismatches').delete().eq('user_id', userId),
        supabase.from('extraction_failures').delete().eq('user_id', userId),
        supabase.from('applications').delete().eq('user_id', userId),
        supabase.from('profiles').delete().eq('id', userId),
      ]);

      // 3. Sign out
      await supabase.auth.signOut();
    } catch (err) {
      setDeleteError(humanizeErrorMessage(err instanceof Error ? err.message : String(err)));
      setDeleting(false);
    }
  };

  const dailyRemaining = Math.max(0, DAILY_SUGGESTION_LIMIT - dailyDecisionsUsed);
  const coverRemaining = Math.max(0, WEEKLY_COVER_LETTER_LIMIT - coverLettersUsed);

  return (
    <div className="flex w-full max-w-md flex-col gap-4 p-4 text-left">
      {/* Header with Back button */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to Main Panel"
            data-testid="settings-back-btn"
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Back
          </button>
          <h2 className="text-base font-semibold text-slate-900">Settings &amp; Privacy</h2>
        </div>
      </div>

      {/* Section 1: Drafting Preferences */}
      <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Drafting Preferences
          </h3>
          {savingLength ? (
            <span className="text-[10px] text-slate-500">Saving…</span>
          ) : lengthSavedMessage ? (
            <span className="text-[10px] font-medium text-emerald-600">{lengthSavedMessage}</span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">Choose your preferred answer length for drafts.</p>

        <div className="mt-3 flex flex-col gap-2">
          {OUTPUT_LENGTHS.map((len) => {
            const config = OUTPUT_LENGTH_CONFIG[len];
            const isLocked = !isBetaTester && config.premiumOnly;
            const isSelected = outputLength === len;

            return (
              <label
                key={len}
                className={`flex items-center justify-between rounded border p-2.5 text-xs transition-colors ${
                  isSelected
                    ? 'border-slate-900 bg-slate-50 font-medium text-slate-900'
                    : isLocked
                      ? 'cursor-not-allowed border-slate-200 bg-slate-50/50 text-slate-400 opacity-70'
                      : 'cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                title={isLocked ? 'Available for Premium users' : undefined}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="output_length"
                    value={len}
                    checked={isSelected}
                    disabled={isLocked || savingLength}
                    onChange={() => onSelectLength(len)}
                    className="h-3.5 w-3.5 border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>{config.label}</span>
                </div>
                {isLocked ? (
                  <span
                    className="flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                    title="Premium feature"
                  >
                    🔒 Premium
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
        {lengthError ? <p className="mt-2 text-xs text-red-600">{lengthError}</p> : null}
      </div>

      {/* Section 2: Usage & Quotas */}
      <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Usage &amp; Quotas
        </h3>
        <p className="mt-1 text-xs text-slate-500">Track your daily and weekly generation limits.</p>

        {loadingQuotas ? (
          <p className="mt-2 text-xs text-slate-400">Loading quota data…</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            {/* Daily Suggestions */}
            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">Daily Suggestions</span>
                <span
                  data-testid="daily-quota-status"
                  className="font-semibold text-slate-900"
                  title="Daily quota resets every day at midnight (00:00) UTC."
                >
                  {isBetaTester
                    ? '⚡ Unlimited (Beta Tester)'
                    : `⚡ ${dailyRemaining} / ${DAILY_SUGGESTION_LIMIT} remaining today`}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Resets daily at 00:00 UTC. Enforced to preserve beta runway.
              </p>
            </div>

            {/* Weekly Cover Letters */}
            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">Cover Letter Drafting</span>
                <span
                  data-testid="weekly-cover-quota-status"
                  className="font-semibold text-slate-900"
                >
                  {isBetaTester
                    ? '📄 Unlimited (Beta Tester)'
                    : `📄 ${coverRemaining} / ${WEEKLY_COVER_LETTER_LIMIT} remaining this week`}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                1 free draft every 7 days for non-beta users.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Privacy Surface (D12) */}
      <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Privacy Surface (D12)
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Export your complete memory bank or permanently purge your account data.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {/* Export Data */}
          <div>
            <button
              type="button"
              onClick={onExportData}
              disabled={exporting}
              data-testid="export-data-btn"
              className="flex w-full items-center justify-center rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? 'Exporting JSON…' : '📥 Export My Data'}
            </button>
            {exportError ? <p className="mt-1 text-xs text-red-600">{exportError}</p> : null}
            {exportSuccess ? (
              <p className="mt-1 text-xs font-medium text-emerald-600">{exportSuccess}</p>
            ) : null}
          </div>

          {/* Delete Everything */}
          <div>
            <button
              type="button"
              onClick={() => {
                setShowDeleteModal(true);
                setDeleteConfirmText('');
                setDeleteError(null);
              }}
              data-testid="delete-everything-btn"
              className="flex w-full items-center justify-center rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              🗑️ Delete Everything
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Delete Everything */}
      {showDeleteModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="w-full max-w-sm rounded-lg border border-red-200 bg-white p-4 shadow-xl text-left">
            <h3 id="delete-modal-title" className="text-sm font-bold text-red-700">
              Permanently Delete Everything?
            </h3>
            <p className="mt-2 text-xs text-slate-600">
              This action <strong>cannot be undone</strong>. This will permanently delete all your
              uploaded resumes, extracted memory chunks, sensitive facts, stored Q&amp;A pairs, gap
              answers, and style profile, and purge your account from Jobibi.
            </p>
            <p className="mt-3 text-xs font-medium text-slate-800">
              Type <span className="font-mono font-bold text-red-700">DELETE</span> below to
              confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              data-testid="delete-confirm-input"
              className="mt-1.5 w-full rounded border border-slate-300 p-1.5 text-xs text-slate-900 font-mono focus:border-red-500 focus:ring-red-500"
              disabled={deleting}
            />
            {deleteError ? <p className="mt-1.5 text-xs text-red-600">{deleteError}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDeleteEverything}
                disabled={deleteConfirmText.trim() !== 'DELETE' || deleting}
                data-testid="confirm-delete-everything-btn"
                className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {deleting ? 'Deleting everything…' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
