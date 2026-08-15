import { useState, useEffect } from 'react';
import {
  OUTPUT_LENGTHS,
  OUTPUT_LENGTH_CONFIG,
  type OutputLength,
} from '@jobibi/shared';
import { supabase } from './supabase';
import { humanizeErrorMessage } from './ingestError';

interface SettingsProps {
  userId: string;
  userEmail: string;
  isBetaTester: boolean;
  onOpenUsage: () => void;
  onExportData: () => void;
  exporting?: boolean;
  exportSuccess?: string | null;
  exportError?: string | null;
  onOpenDeleteModal: () => void;
}

export function Settings({
  userId,
  isBetaTester,
  onOpenUsage,
  onExportData,
  exporting = false,
  exportSuccess = null,
  exportError = null,
  onOpenDeleteModal,
}: SettingsProps) {
  const [outputLength, setOutputLength] = useState<OutputLength>('short');
  const [savingLength, setSavingLength] = useState(false);
  const [lengthSavedMessage, setLengthSavedMessage] = useState<string | null>(null);
  const [lengthError, setLengthError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOutputLength() {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('output_length')
          .eq('id', userId)
          .maybeSingle();
        if (profile?.output_length) {
          setOutputLength(profile.output_length as OutputLength);
        }
      } catch {
        // ignore
      }
    }
    void loadOutputLength();
  }, [userId]);

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

  return (
    <div data-screen-label="Settings" className="flex flex-col gap-3">
      {/* Drafting Length / Preferences Card */}
      <div className="rounded-[10px] border border-card-border bg-card p-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[13.5px] font-bold text-ink">Drafting length</h3>
          {savingLength ? (
            <span className="text-[10px] text-ink-muted">Saving…</span>
          ) : lengthSavedMessage ? (
            <span className="text-[10px] font-bold text-success">{lengthSavedMessage}</span>
          ) : null}
        </div>
        <p className="mt-1 text-[12px] text-ink-muted">Choose your preferred answer length for drafts.</p>

        <div className="mt-2.5 flex flex-col gap-2">
          {OUTPUT_LENGTHS.map((len) => {
            const config = OUTPUT_LENGTH_CONFIG[len];
            const isLocked = !isBetaTester && config.premiumOnly;
            const isSelected = outputLength === len;

            return (
              <label
                key={len}
                className={`flex items-center justify-between rounded-lg p-2.5 text-[13px] transition-colors ${
                  isSelected
                    ? 'border-[1.5px] border-accent bg-accent-tint font-bold text-ink'
                    : isLocked
                      ? 'cursor-not-allowed border border-card-border bg-subtle text-ink-disabled opacity-70'
                      : 'cursor-pointer border border-card-border bg-card text-ink hover:bg-subtle'
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
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  <span>
                    {len === 'short'
                      ? 'Short — 2–3 sentences'
                      : len === 'medium'
                        ? 'Standard — a full paragraph'
                        : 'Long — detailed'}
                  </span>
                </div>
                {isLocked ? (
                  <span
                    className="ml-1.5 rounded-md bg-recess px-1.5 py-0.5 text-[10.5px] font-bold text-ink-muted"
                    title="Premium feature"
                  >
                    🔒 Premium
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
        {lengthError ? <p className="mt-2 text-xs text-danger">{lengthError}</p> : null}
      </div>

      {/* Navigation Row: Usage & Quotas */}
      <button
        type="button"
        onClick={onOpenUsage}
        data-testid="settings-usage-btn"
        className="flex w-full items-center justify-between rounded-[10px] border border-card-border bg-card p-3.5 text-left transition-colors hover:bg-subtle"
      >
        <span className="text-[13.5px] font-bold text-ink">Usage &amp; quotas</span>
        <span className="text-[14px] text-ink-muted">›</span>
      </button>

      {/* Navigation Row: Export My Data */}
      <button
        type="button"
        onClick={onExportData}
        disabled={exporting}
        data-testid="export-data-btn"
        className="flex w-full items-center justify-between rounded-[10px] border border-card-border bg-card p-3.5 text-left transition-colors hover:bg-subtle disabled:opacity-50"
      >
        <span className="text-[13.5px] font-bold text-ink">
          {exporting ? 'Exporting JSON…' : 'Export my data'}
        </span>
        <span className="text-[14px] text-ink-muted">›</span>
      </button>
      {exportSuccess ? (
        <p className="rounded bg-success-tint px-2.5 py-1 text-xs font-medium text-success">
          {exportSuccess}
        </p>
      ) : null}
      {exportError ? (
        <p className="rounded bg-danger-tint px-2.5 py-1 text-xs text-danger">{exportError}</p>
      ) : null}

      {/* Navigation Row: Delete Everything */}
      <button
        type="button"
        onClick={onOpenDeleteModal}
        data-testid="delete-everything-btn"
        className="flex w-full items-center justify-between rounded-[10px] border border-danger-tint-border bg-danger-tint p-3.5 text-left transition-colors hover:opacity-90"
      >
        <span className="text-[13.5px] font-bold text-danger">Delete everything</span>
        <span className="text-[14px] text-danger">›</span>
      </button>
    </div>
  );
}
