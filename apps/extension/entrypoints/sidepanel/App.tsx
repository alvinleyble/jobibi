import { APP_NAME } from '@jobibi/shared';
import { useSession } from './useSession';
import SignIn from './SignIn';
import { supabase } from './supabase';

function App() {
  const { session, loading } = useSession();

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
    <div className="flex h-screen flex-col items-center justify-center gap-2 bg-white p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">{APP_NAME}</h1>
      <p className="text-sm text-slate-500">Signed in as {session.user.email}.</p>
      <button
        type="button"
        onClick={() => supabase.auth.signOut()}
        className="mt-2 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
      >
        Sign out
      </button>
    </div>
  );
}

export default App;
