import { APP_NAME } from '@jobibi/shared';
import { useSession } from './useSession';
import SignIn from './SignIn';
import { supabase } from './supabase';
import JobStreetQuestions from './JobStreetQuestions';
import MemoryBank from './MemoryBank';

function App() {
  const { session, loading, isBetaTester } = useSession();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  return (
    <div className="flex h-screen flex-col items-center overflow-y-auto bg-white">
      <div className="flex w-full max-w-md flex-col items-center gap-1 p-4 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{APP_NAME}</h1>
        <p className="text-sm text-slate-500">Signed in as {session.user.email}.</p>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
        >
          Sign out
        </button>
      </div>
      <JobStreetQuestions isBetaTester={isBetaTester} />
      <MemoryBank userId={session.user.id} />
    </div>
  );
}

export default App;
