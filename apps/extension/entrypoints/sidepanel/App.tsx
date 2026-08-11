import { APP_NAME } from '@jobibi/shared';
import { useSession } from './useSession';
import SignIn from './SignIn';
import { supabase } from './supabase';
import JobStreetQuestions from './JobStreetQuestions';
import MemoryBank from './MemoryBank';
import { SuggestCard } from './SuggestCard';

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

  const isDebugSensitive = typeof window !== 'undefined' && window.location.search.includes('debugSensitive');

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
      {isDebugSensitive ? (
        <div className="w-full max-w-md p-3">
          <h2 className="mb-2 text-sm font-semibold text-violet-700">Debug: Sensitive verification</h2>
          <div className="mb-3 rounded border border-dashed border-violet-300 p-2">
            <p className="mb-1 text-xs font-medium text-slate-700">Test question (oblique, no rule keyword):</p>
            <p className="mb-2 text-xs text-slate-600">What compensation range are you targeting?</p>
            <SuggestCard
              q={{ id: 'debug-salary-oblique', label: 'What compensation range are you targeting?', fieldType: 'text', selector: '#debug', confidence: 1, context: 'debug' }}
              jobContext={{ roleTitle: 'QA Engineer', company: 'TestCo' }}
            />
          </div>
          <div className="mb-3 rounded border border-dashed border-violet-300 p-2">
            <p className="mb-1 text-xs font-medium text-slate-700">Test question (direct):</p>
            <p className="mb-2 text-xs text-slate-600">What is your expected salary?</p>
            <SuggestCard
              q={{ id: 'debug-salary-direct', label: 'What is your expected salary?', fieldType: 'text', selector: '#debug2', confidence: 1, context: 'debug' }}
              jobContext={{ roleTitle: 'QA Engineer', company: 'TestCo' }}
            />
          </div>
          <div className="mb-3 rounded border border-dashed border-slate-300 p-2">
            <p className="mb-1 text-xs font-medium text-slate-700">Control (non-sensitive):</p>
            <p className="mb-2 text-xs text-slate-600">Tell us about a QA bug you caught.</p>
            <SuggestCard
              q={{ id: 'debug-qa', label: 'Tell us about a QA bug you caught before release and how you did it.', fieldType: 'textarea', selector: '#debug3', confidence: 1, context: 'debug' }}
              jobContext={{ roleTitle: 'QA Engineer', company: 'TestCo' }}
            />
          </div>
        </div>
      ) : null}
      <JobStreetQuestions />
      <MemoryBank userId={session.user.id} />
    </div>
  );
}

export default App;
