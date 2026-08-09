import { useEffect, useState } from 'react';
import { supabase } from '../sidepanel/supabase';

type Status = 'exchanging' | 'done' | 'error';

function Callback() {
  const [status, setStatus] = useState<Status>('exchanging');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      setStatus('error');
      setError('No sign-in code was found in this link.');
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) {
        setStatus('error');
        setError(exchangeError.message);
        return;
      }
      setStatus('done');
    });
  }, []);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 bg-white p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Jobibi</h1>
      {status === 'exchanging' && <p className="text-sm text-slate-500">Signing you in…</p>}
      {status === 'done' && (
        <p className="text-sm text-slate-500">You're signed in. Close this tab and reopen the Jobibi side panel.</p>
      )}
      {status === 'error' && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default Callback;
