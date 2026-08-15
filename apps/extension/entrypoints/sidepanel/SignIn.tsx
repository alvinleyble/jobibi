import { useState } from 'react';
import { supabase } from './supabase';
import { humanizeErrorMessage } from './ingestError';

type Status = 'idle' | 'sending' | 'sent' | 'error';

function humanizeAuthError(msg: string): string {
  if (/rate limit|too many requests/i.test(msg)) {
    return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  }
  if (/invalid email|valid email/i.test(msg)) {
    return 'Please enter a valid email address.';
  }
  return humanizeErrorMessage(msg);
}

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
      setError(humanizeAuthError(signInError.message));
      return;
    }
    setStatus('sent');
  };

  if (status === 'sent') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-panel p-6 text-center text-ink">
        <h1 className="text-[19px] font-extrabold tracking-[-0.01em] text-ink">Check your email</h1>
        <p className="text-xs text-ink-muted leading-relaxed">
          We sent a sign-in link to <span className="font-bold text-ink">{email}</span>. Open it, then come back here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-panel p-6 text-ink">
      <h1 className="text-[19px] font-extrabold tracking-[-0.01em] text-ink">Sign in to Jobibi</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-2.5">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-lg border border-card-border bg-card px-3 py-2 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-on-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
        </button>
        {status === 'error' && <p className="text-xs text-danger">{error}</p>}
      </form>
    </div>
  );
}

export default SignIn;
