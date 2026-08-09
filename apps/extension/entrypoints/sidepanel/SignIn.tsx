import { useState } from 'react';
import { supabase } from './supabase';

type Status = 'idle' | 'sending' | 'sent' | 'error';

function SignIn() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: browser.runtime.getURL('/callback.html'),
      },
    });

    if (signInError) {
      setStatus('error');
      setError(signInError.message);
      return;
    }
    setStatus('sent');
  };

  if (status === 'sent') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-white p-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
        <p className="text-sm text-slate-500">We sent a sign-in link to {email}. Open it, then come back here.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white p-6">
      <h1 className="text-xl font-semibold text-slate-900">Sign in to Jobibi</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
        </button>
        {status === 'error' && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </div>
  );
}

export default SignIn;
