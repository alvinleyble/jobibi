import { getUserInitials } from './userUtils';

interface AccountViewProps {
  userId: string;
  userEmail: string;
  isBetaTester: boolean;
  onExportData: () => void;
  exporting?: boolean;
  exportSuccess?: string | null;
  exportError?: string | null;
  onOpenDeleteModal: () => void;
  onSignOut: () => void;
}

export function AccountView({
  userEmail,
  isBetaTester,
  onExportData,
  exporting = false,
  exportSuccess = null,
  exportError = null,
  onOpenDeleteModal,
  onSignOut,
}: AccountViewProps) {
  const initials = getUserInitials(userEmail);

  return (
    <div data-screen-label="Account" className="flex flex-col gap-3.5">
      {/* Identity block */}
      <div className="flex flex-col items-center gap-2 border-b border-card-border pb-4 pt-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-accent-tint-border bg-accent-tint text-[18px] font-extrabold text-accent">
          {initials}
        </div>
        <span className="text-[14px] font-bold text-ink" title={`Signed in as ${userEmail}`}>
          {userEmail}
        </span>
        {isBetaTester ? (
          <span className="rounded-md border border-success-tint-border bg-success-tint px-2 py-0.5 text-[11px] font-bold text-success">
            BETA TESTER
          </span>
        ) : (
          <span className="rounded-md border border-card-border bg-subtle px-2 py-0.5 text-[11px] font-bold text-ink-muted">
            FREE PLAN
          </span>
        )}
      </div>

      {/* Privacy & Stored Data section */}
      <div className="flex flex-col gap-2">
        <h4 className="text-[11.5px] font-bold uppercase tracking-wider text-ink-muted">
          Privacy &amp; Stored Data
        </h4>

        {/* Export Data Navigation Row */}
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

        {/* Delete Everything Navigation Row */}
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

      {/* Outline Sign Out Button */}
      <button
        type="button"
        onClick={onSignOut}
        data-testid="sign-out-btn"
        className="mt-1 w-full rounded-lg border-[1.5px] border-card-border bg-card py-2.5 text-center text-[13.5px] font-bold text-ink transition-colors hover:bg-subtle"
      >
        Sign out
      </button>
    </div>
  );
}
