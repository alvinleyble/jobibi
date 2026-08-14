import { useEffect, useState } from 'react';
import { APP_NAME } from '@jobibi/shared';
import { useSession } from './useSession';
import SignIn from './SignIn';
import { Onboarding } from './Onboarding';
import { supabase } from './supabase';
import JobStreetQuestions from './JobStreetQuestions';
import MemoryBank from './MemoryBank';
import { Settings } from './Settings';

function App() {
  const { session, loading, isBetaTester } = useSession();
  const [showSettings, setShowSettings] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);

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

  if (loading || (session && isOnboarded === null)) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-sm text-slate-500">Loading…</p>
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

  return (
    <div className="flex h-screen flex-col items-center overflow-y-auto bg-white">
      {/* Top Header Navigation Bar */}
      <header className="flex w-full max-w-md items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-slate-900 tracking-tight">{APP_NAME}</h1>
          {isBetaTester ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
              BETA
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="max-w-[180px] truncate text-xs text-slate-500" title={`Signed in as ${session.user.email}`}>
            Signed in as {session.user.email}
          </span>
          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            aria-label="Settings"
            title="Settings & Privacy"
            data-testid="settings-btn"
            className={`rounded p-1.5 text-xs font-medium transition-colors ${
              showSettings
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            ⚙️
          </button>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            aria-label="Sign out"
            data-testid="sign-out-btn"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main View vs Settings View */}
      {showSettings ? (
        <Settings
          userId={session.user.id}
          userEmail={session.user.email ?? ''}
          isBetaTester={isBetaTester}
          onClose={() => setShowSettings(false)}
        />
      ) : (
        <>
          <JobStreetQuestions isBetaTester={isBetaTester} />
          <MemoryBank userId={session.user.id} />
        </>
      )}
    </div>
  );
}

export default App;
