import { useEffect, useState } from 'react';
import { useSession } from './useSession';
import SignIn from './SignIn';
import { Onboarding } from './Onboarding';
import { supabase } from './supabase';
import JobStreetQuestions from './JobStreetQuestions';
import MemoryBank from './MemoryBank';
import { Settings } from './Settings';
import { UsageQuotasView } from './UsageQuotasView';
import { AccountView } from './AccountView';
import { useTheme } from './useTheme';
import { getUserInitials } from './userUtils';
import { humanizeErrorMessage } from './ingestError';

export type TabType = 'suggest' | 'memory' | 'settings';
export type SubViewType = null | 'usage' | 'account';

function App() {
  const { session, loading, isBetaTester } = useSession();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('suggest');
  const [activeView, setActiveView] = useState<SubViewType>(null);
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);

  // Export Data state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Delete everything modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Capture toast state across tabs
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    let toastTimer: number | null = null;
    let errorTimer: number | null = null;

    const showToast = (inserted: number, dropped = 0) => {
      if (inserted || dropped) {
        const parts = [`Saved ${inserted} answer${inserted === 1 ? '' : 's'} to memory`];
        if (dropped) parts.push(`${dropped} mismatched skipped`);
        setCaptureMsg(parts.join(' · '));
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => setCaptureMsg(null), 4000);
      }
    };

    const showError = (message: string) => {
      setCaptureError(`Could not save application answers: ${message}`);
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = window.setTimeout(() => setCaptureError(null), 6000);
    };

    const onMsg = (message: unknown) => {
      if (typeof message === 'object' && message !== null) {
        const m = message as { type?: string; payload?: { inserted?: number; droppedMismatched?: number; message?: string } };
        if (m.type === 'JOBIBI_CAPTURE_COMPLETED' && m.payload) {
          showToast(m.payload.inserted ?? 0, m.payload.droppedMismatched ?? 0);
        } else if (m.type === 'JOBIBI_CAPTURE_FAILED' && m.payload?.message) {
          showError(m.payload.message);
        }
      }
    };
    browser.runtime.onMessage.addListener(onMsg as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if ('jobibi_last_capture' in changes) {
        const val = (changes.jobibi_last_capture as { newValue?: { inserted?: number; droppedMismatched?: number } })?.newValue;
        if (val && typeof val.inserted === 'number') {
          showToast(val.inserted, val.droppedMismatched ?? 0);
        }
      }
      if ('jobibi_last_capture_error' in changes) {
        const val = (changes.jobibi_last_capture_error as { newValue?: { message?: string } })?.newValue;
        if (val?.message) {
          showError(val.message);
        }
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    return () => {
      if (toastTimer) clearTimeout(toastTimer);
      if (errorTimer) clearTimeout(errorTimer);
      browser.runtime.onMessage.removeListener(onMsg as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setIsOnboarded(null);
      return;
    }

    const checkOnboardingStatus = async () => {
      const userId = session.user.id;
      const key = `jobibi_onboarding_completed_${userId}`;

      // Check local / browser storage
      let localDone = false;
      try {
        const stored = await browser.storage.local.get(key);
        if (stored[key]) {
          localDone = true;
        }
      } catch {
        if (typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'true') {
          localDone = true;
        }
      }

      if (localDone) {
        setIsOnboarded(true);
        return;
      }

      // Check if user has uploaded documents in Supabase
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('id')
          .eq('user_id', userId)
          .limit(1);

        if (!error && data && data.length > 0) {
          setIsOnboarded(true);
          try {
            await browser.storage.local.set({ [key]: true });
          } catch {
            localStorage?.setItem(key, 'true');
          }
          return;
        }
      } catch {
        // ignore
      }

      setIsOnboarded(false);
    };

    void checkOnboardingStatus();
  }, [session?.user?.id]);

  const handleOnboardingComplete = async () => {
    if (session?.user?.id) {
      const key = `jobibi_onboarding_completed_${session.user.id}`;
      try {
        await browser.storage.local.set({ [key]: true });
      } catch {
        localStorage?.setItem(key, 'true');
      }
    }
    setIsOnboarded(true);
  };

  const handleTabSwitch = (tab: TabType) => {
    setActiveTab(tab);
    setActiveView(null);
  };

  const handleExportData = async () => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    const userEmail = session.user.email ?? '';

    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const [
        profilesRes,
        documentsRes,
        memoryChunksRes,
        qaPairsRes,
        gapAnswersRes,
        styleProfileRes,
        applicationsRes,
        gateDecisionsRes,
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId),
        supabase.from('documents').select('*').eq('user_id', userId),
        supabase.from('memory_chunks').select('*').eq('user_id', userId),
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

  const handleDeleteEverything = async () => {
    if (!session?.user?.id) return;
    if (deleteConfirmText.trim() !== 'DELETE') {
      setDeleteError('Please type "DELETE" exactly to confirm.');
      return;
    }
    const userId = session.user.id;
    setDeleting(true);
    setDeleteError(null);
    try {
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

      await Promise.allSettled([
        supabase.from('memory_chunks').delete().eq('user_id', userId),
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

      await supabase.auth.signOut();
    } catch (err) {
      setDeleteError(humanizeErrorMessage(err instanceof Error ? err.message : String(err)));
      setDeleting(false);
    }
  };

  if (loading || (session && isOnboarded === null)) {
    return (
      <div className="flex h-screen items-center justify-center bg-panel">
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  if (!isOnboarded) {
    return (
      <Onboarding
        userId={session.user.id}
        userEmail={session.user.email ?? ''}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  const initials = getUserInitials(session.user.email);

  return (
    <div className="flex h-screen w-full max-w-[400px] flex-col bg-panel font-sans text-ink">
      {/* Top Header Chrome */}
      <header className="shrink-0">
        {activeView === null ? (
          <div>
            {/* Wordmark, Theme Toggle, Avatar */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[19px] font-extrabold tracking-[-0.01em] text-ink">
                  Jobibi
                </span>
                {isBetaTester ? (
                  <span className="rounded-md border border-success-tint-border bg-success-tint px-1.5 py-0.5 text-[10px] font-bold text-success">
                    BETA
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label="Toggle dark mode"
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  data-testid="theme-toggle-btn"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] border-card-border bg-card text-[14px] text-ink transition-colors hover:bg-subtle cursor-pointer"
                >
                  {theme === 'dark' ? '☀' : '☾'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('account')}
                  aria-label="Open Account"
                  title={`Account (${session.user.email})`}
                  data-testid="avatar-btn"
                  className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-accent-tint-border bg-accent-tint text-[12.5px] font-extrabold text-accent transition-opacity hover:opacity-80 cursor-pointer"
                >
                  {initials}
                </button>
              </div>
            </div>

            {/* 3-Tab Segmented Switcher */}
            <nav
              aria-label="Main Navigation"
              className="mx-4 mb-3 flex rounded-[10px] border-[1.5px] border-card-border bg-track p-[3px] gap-0.5"
            >
              <button
                type="button"
                onClick={() => handleTabSwitch('suggest')}
                data-testid="tab-suggest-btn"
                className={`flex-1 rounded-[7px] py-1.5 text-center text-[13.5px] font-bold transition-colors cursor-pointer border-none ${
                  activeTab === 'suggest'
                    ? 'bg-accent text-on-accent'
                    : 'bg-transparent text-ink-secondary hover:text-ink'
                }`}
              >
                Suggest
              </button>
              <button
                type="button"
                onClick={() => handleTabSwitch('memory')}
                data-testid="tab-memory-btn"
                className={`flex-1 rounded-[7px] py-1.5 text-center text-[13.5px] font-bold transition-colors cursor-pointer border-none ${
                  activeTab === 'memory'
                    ? 'bg-accent text-on-accent'
                    : 'bg-transparent text-ink-secondary hover:text-ink'
                }`}
              >
                Memory
              </button>
              <button
                type="button"
                onClick={() => handleTabSwitch('settings')}
                data-testid="tab-settings-btn"
                className={`flex-1 rounded-[7px] py-1.5 text-center text-[13.5px] font-bold transition-colors cursor-pointer border-none ${
                  activeTab === 'settings'
                    ? 'bg-accent text-on-accent'
                    : 'bg-transparent text-ink-secondary hover:text-ink'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>
        ) : (
          /* Back Header for Sub-Screens */
          <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-card-border">
            <button
              type="button"
              onClick={() => setActiveView(null)}
              aria-label="Back"
              data-testid="settings-back-btn"
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border-[1.5px] border-card-border bg-card text-[14px] font-bold text-ink transition-colors hover:bg-subtle cursor-pointer"
            >
              ←
            </button>
            <span className="text-[17px] font-extrabold text-ink">
              {activeView === 'usage' ? 'Usage & quotas' : 'Account'}
            </span>
          </div>
        )}
      </header>

      {/* Main Scrollable Content Area */}
      <main className="flex-1 overflow-y-auto px-4 pb-5">
        {/* Capture Toast Banner */}
        {captureMsg ? (
          <div
            data-testid="capture-toast"
            className="mb-3 rounded-lg border border-success-tint-border bg-success-tint px-3 py-2 text-xs font-medium text-success"
          >
            {captureMsg}
          </div>
        ) : null}
        {captureError ? (
          <div
            data-testid="capture-error-toast"
            className="mb-3 rounded-lg border border-danger-tint-border bg-danger-tint px-3 py-2 text-xs font-medium text-danger"
          >
            {captureError}
          </div>
        ) : null}

        {activeView === 'usage' ? (
          <UsageQuotasView userId={session.user.id} isBetaTester={isBetaTester} />
        ) : activeView === 'account' ? (
          <AccountView
            userId={session.user.id}
            userEmail={session.user.email ?? ''}
            isBetaTester={isBetaTester}
            onExportData={handleExportData}
            exporting={exporting}
            exportSuccess={exportSuccess}
            exportError={exportError}
            onOpenDeleteModal={() => {
              setShowDeleteModal(true);
              setDeleteConfirmText('');
              setDeleteError(null);
            }}
            onSignOut={() => supabase.auth.signOut()}
          />
        ) : activeTab === 'suggest' ? (
          <JobStreetQuestions isBetaTester={isBetaTester} />
        ) : activeTab === 'memory' ? (
          <MemoryBank userId={session.user.id} />
        ) : (
          <Settings
            userId={session.user.id}
            userEmail={session.user.email ?? ''}
            isBetaTester={isBetaTester}
            onOpenUsage={() => setActiveView('usage')}
          />
        )}
      </main>

      {/* Delete Everything Confirmation Modal */}
      {showDeleteModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-[320px] rounded-xl border border-card-border bg-card p-4.5 shadow-2xl text-left">
            <h3 id="delete-modal-title" className="text-[15px] font-extrabold text-danger">
              Permanently Delete Everything?
            </h3>
            <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-secondary">
              This permanently removes your documents, stored answers, and facts. This cannot be undone.
            </p>
            <p className="mt-3 text-[12px] font-bold text-ink">
              Type <span className="font-mono text-danger">DELETE</span> below to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              data-testid="delete-confirm-input"
              className="mt-1.5 w-full rounded-lg border border-card-border bg-card p-2 text-xs font-mono text-ink focus:border-danger focus:outline-none"
              disabled={deleting}
            />
            {deleteError ? <p className="mt-1.5 text-xs text-danger">{deleteError}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-bold text-ink hover:bg-subtle transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteEverything}
                disabled={deleteConfirmText.trim() !== 'DELETE' || deleting}
                data-testid="confirm-delete-everything-btn"
                className="rounded-lg bg-danger px-3 py-1.5 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
