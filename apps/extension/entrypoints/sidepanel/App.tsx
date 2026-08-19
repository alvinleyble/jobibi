import { useEffect, useState, useRef } from 'react';
import { normalizeQuestion } from '@jobibi/shared';
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

export interface CaptureToastState {
  text: string;
  insertedIds: string[];
  canUndo: boolean;
  isUndoing?: boolean;
  isUndone?: boolean;
  error?: string;
  url?: string;
  jobContext?: {
    role?: string;
    roleTitle?: string;
    company?: string;
    url?: string;
  };
  capturedAt?: number;
}

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

  // Persistent capture toast state across tabs
  const [captureToast, setCaptureToast] = useState<CaptureToastState | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const undoToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let errorTimer: number | null = null;

    const showCaptureToast = (payload: {
      inserted?: number;
      droppedMismatched?: number;
      updated?: number;
      insertedIds?: string[];
      url?: string;
      jobContext?: { role?: string; roleTitle?: string; company?: string; url?: string };
    }) => {
      const inserted = payload.inserted ?? 0;
      const dropped = payload.droppedMismatched ?? 0;
      const updated = payload.updated ?? 0;
      const total = inserted + updated;
      let msg: string;
      if (total > 0) {
        msg = `Saved ${total} answer${total === 1 ? '' : 's'} to memory`;
        if (dropped) msg += ` · ${dropped} skipped`;
      } else if (dropped) {
        msg = `${dropped} answer${dropped === 1 ? '' : 's'} skipped (mismatched)`;
      } else {
        msg = 'Answers saved to memory';
      }

      const insertedIds = Array.isArray(payload.insertedIds) ? payload.insertedIds : [];

      if (undoToastTimerRef.current) {
        clearTimeout(undoToastTimerRef.current);
        undoToastTimerRef.current = null;
      }

      setCaptureToast({
        text: msg,
        insertedIds,
        canUndo: insertedIds.length > 0,
        isUndoing: false,
        isUndone: false,
        url: payload.url,
        jobContext: payload.jobContext,
        capturedAt: Date.now(),
      });
    };

    const showError = (message: string) => {
      setCaptureError(`Could not save application answers: ${message}`);
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = window.setTimeout(() => setCaptureError(null), 6000);
    };

    const onMsg = (message: unknown) => {
      if (typeof message === 'object' && message !== null) {
        const m = message as {
          type?: string;
          payload?: {
            inserted?: number;
            droppedMismatched?: number;
            updated?: number;
            message?: string;
            insertedIds?: string[];
            url?: string;
            jobContext?: { roleTitle?: string; role?: string; company?: string; url?: string };
          };
        };
        if (m.type === 'JOBIBI_CAPTURE_COMPLETED' && m.payload) {
          showCaptureToast(m.payload);
        } else if (m.type === 'JOBIBI_CAPTURE_FAILED' && m.payload?.message) {
          showError(m.payload.message);
        } else if (m.type === 'JOBIBI_QUESTIONS' && m.payload) {
          // If questions change for a different job context, dismiss previous capture toast
          const questionsPayload = m.payload;
          setCaptureToast((curr) => {
            if (!curr) return null;
            if (curr.capturedAt && Date.now() - curr.capturedAt < 500) {
              return curr;
            }
            if (curr.jobContext || curr.url) {
              const newRole = questionsPayload.jobContext?.roleTitle ?? questionsPayload.jobContext?.role;
              const oldRole = curr.jobContext?.roleTitle ?? curr.jobContext?.role;
              const newCompany = questionsPayload.jobContext?.company;
              const oldCompany = curr.jobContext?.company;
              const newUrl = questionsPayload.jobContext?.url ?? questionsPayload.url;
              const oldUrl = curr.url ?? curr.jobContext?.url;

              if (
                (oldRole && newRole && oldRole !== newRole) ||
                (oldCompany && newCompany && oldCompany !== newCompany) ||
                (oldUrl && newUrl && oldUrl !== newUrl)
              ) {
                return null;
              }
            }
            return curr;
          });
        }
      }
    };
    browser.runtime.onMessage.addListener(onMsg as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if ('jobibi_last_capture' in changes) {
        const val = (changes.jobibi_last_capture as {
          newValue?: {
            inserted?: number;
            updated?: number;
            droppedMismatched?: number;
            insertedIds?: string[];
            url?: string;
            jobContext?: { roleTitle?: string; role?: string; company?: string; url?: string };
          };
        })?.newValue;
        if (val) {
          showCaptureToast(val);
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

    const onTabUpdated = (_tabId: number, changeInfo: { url?: string }) => {
      if (changeInfo.url) {
        setCaptureToast((curr) => {
          if (!curr) return null;
          if (curr.capturedAt && Date.now() - curr.capturedAt < 500) return curr;
          if (curr.url && changeInfo.url !== curr.url) {
            return null;
          }
          return curr;
        });
      }
    };

    const onTabActivated = async (activeInfo: { tabId: number }) => {
      try {
        const tab = await browser.tabs?.get?.(activeInfo.tabId).catch(() => null);
        if (tab?.url) {
          setCaptureToast((curr) => {
            if (!curr) return null;
            if (curr.capturedAt && Date.now() - curr.capturedAt < 500) return curr;
            if (curr.url && tab.url !== curr.url) {
              return null;
            }
            return curr;
          });
        }
      } catch {
        // ignore
      }
    };

    if (browser.tabs?.onUpdated?.addListener) {
      browser.tabs.onUpdated.addListener(onTabUpdated as Parameters<typeof browser.tabs.onUpdated.addListener>[0]);
    }
    if (browser.tabs?.onActivated?.addListener) {
      browser.tabs.onActivated.addListener(onTabActivated);
    }

    return () => {
      if (errorTimer) clearTimeout(errorTimer);
      if (undoToastTimerRef.current) {
        clearTimeout(undoToastTimerRef.current);
        undoToastTimerRef.current = null;
      }
      browser.runtime.onMessage.removeListener(onMsg as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
      browser.storage.onChanged.removeListener(onStorageChanged);
      if (browser.tabs?.onUpdated?.removeListener) {
        browser.tabs.onUpdated.removeListener(onTabUpdated as Parameters<typeof browser.tabs.onUpdated.removeListener>[0]);
      }
      if (browser.tabs?.onActivated?.removeListener) {
        browser.tabs.onActivated.removeListener(onTabActivated);
      }
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

  const handleUndoCapture = async () => {
    if (!captureToast || !captureToast.insertedIds || captureToast.insertedIds.length === 0 || captureToast.isUndoing) {
      return;
    }

    const idsToUndo = [...captureToast.insertedIds];
    const userId = session?.user?.id;
    if (!userId) return;

    setCaptureToast((prev) => (prev ? { ...prev, isUndoing: true, error: undefined } : null));

    try {
      // 1. Fetch all of the user's qa_pairs so we can tell which memory_chunks are
      // uniquely owned by this capture vs. shared with a still-valid duplicate answer
      const { data: allQaRows, error: fetchError } = await supabase
        .from('qa_pairs')
        .select('id, question_label, answer_text')
        .eq('user_id', userId);

      if (fetchError) {
        throw fetchError;
      }

      const idsToUndoSet = new Set(idsToUndo);
      const qaRows = (allQaRows ?? []).filter((qa) => idsToUndoSet.has(qa.id));
      const remainingRows = (allQaRows ?? []).filter((qa) => !idsToUndoSet.has(qa.id));

      if (qaRows.length > 0) {
        const remainingTexts = new Set(
          remainingRows.map((qa) => `Q: ${qa.question_label}\nA: ${qa.answer_text}`),
        );
        const remainingNorms = new Set(remainingRows.map((qa) => normalizeQuestion(qa.question_label)));

        const itemTexts = new Set<string>();
        const itemNorms = new Set<string>();
        for (const qa of qaRows) {
          const text = `Q: ${qa.question_label}\nA: ${qa.answer_text}`;
          const norm = normalizeQuestion(qa.question_label);
          if (!remainingTexts.has(text)) itemTexts.add(text);
          if (!remainingNorms.has(norm)) itemNorms.add(norm);
        }

        if (itemTexts.size > 0 || itemNorms.size > 0) {
          const { data: chunkRows, error: chunkFetchError } = await supabase
            .from('memory_chunks')
            .select('id, text')
            .eq('user_id', userId)
            .eq('type', 'qa_pair');

          if (chunkFetchError) {
            throw chunkFetchError;
          }

          const chunkIdsToDelete: string[] = [];
          if (chunkRows) {
            for (const ch of chunkRows as Array<{ id: string; text: string }>) {
              const qPart = ch.text.startsWith('Q: ')
                ? (ch.text.split('\nA:')[0]?.slice(2).trim() ?? ch.text)
                : ch.text;
              if (itemTexts.has(ch.text) || itemNorms.has(normalizeQuestion(qPart))) {
                chunkIdsToDelete.push(ch.id);
              }
            }
          }
          if (chunkIdsToDelete.length > 0) {
            const { error: chunkDeleteError } = await supabase
              .from('memory_chunks')
              .delete()
              .in('id', chunkIdsToDelete)
              .eq('user_id', userId);

            if (chunkDeleteError) {
              throw chunkDeleteError;
            }
          }
        }
      }

      // 2. Delete qa_pairs
      const { error: deleteError } = await supabase
        .from('qa_pairs')
        .delete()
        .in('id', idsToUndo)
        .eq('user_id', userId);

      if (deleteError) {
        throw deleteError;
      }

      // 3. Update storage and broadcast undo event
      await browser.storage.local.set({
        jobibi_last_capture_undone: {
          at: Date.now(),
          insertedIds: idsToUndo,
        },
      });

      await browser.runtime
        .sendMessage({
          type: 'JOBIBI_CAPTURE_UNDONE',
          payload: { insertedIds: idsToUndo },
        })
        .catch(() => {});

      // 4. Update toast state to confirm undone
      setCaptureToast({
        text: 'Capture undone',
        insertedIds: [],
        canUndo: false,
        isUndoing: false,
        isUndone: true,
      });

      // Automatically dismiss the 'Capture undone' toast after 5 seconds
      if (undoToastTimerRef.current) {
        clearTimeout(undoToastTimerRef.current);
      }
      undoToastTimerRef.current = window.setTimeout(() => {
        setCaptureToast((current) => (current?.isUndone ? null : current));
        undoToastTimerRef.current = null;
      }, 5000);
    } catch (err) {
      console.error('[App] Failed to undo capture:', err);
      const msg = humanizeErrorMessage(err instanceof Error ? err.message : String(err));
      setCaptureToast((prev) =>
        prev
          ? {
              ...prev,
              isUndoing: false,
              error: `Failed to undo: ${msg}`,
            }
          : null,
      );
    }
  };

  const handleDismissToast = () => {
    if (undoToastTimerRef.current) {
      clearTimeout(undoToastTimerRef.current);
      undoToastTimerRef.current = null;
    }
    setCaptureToast(null);
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
        {captureToast ? (
          <div
            data-testid="capture-toast"
            className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-success-tint-border bg-success-tint px-3 py-2 text-xs font-medium text-success"
          >
            <div className="flex-1 min-w-0 truncate">
              {captureToast.error ? (
                <span className="text-danger">{captureToast.error}</span>
              ) : (
                <span>{captureToast.text}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {captureToast.canUndo && !captureToast.isUndone ? (
                <button
                  type="button"
                  onClick={handleUndoCapture}
                  disabled={captureToast.isUndoing}
                  data-testid="capture-undo-btn"
                  className="rounded px-1.5 py-0.5 text-xs font-bold text-success hover:underline hover:bg-success-tint-border/30 disabled:opacity-50 cursor-pointer border-none bg-transparent"
                >
                  {captureToast.isUndoing ? 'Undoing…' : 'Undo'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleDismissToast}
                data-testid="capture-dismiss-btn"
                aria-label="Dismiss capture notification"
                className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-success/70 hover:text-success hover:bg-success-tint-border/30 cursor-pointer border-none bg-transparent"
              >
                ✕
              </button>
            </div>
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
