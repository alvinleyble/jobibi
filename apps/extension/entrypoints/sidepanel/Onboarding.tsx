import { useState } from 'react';
import { APP_NAME } from '@jobibi/shared';
import UploadDocument from './UploadDocument';
import { describeIngestError } from './ingestError';
import { supabase } from './supabase';

interface OnboardingProps {
  userId: string;
  userEmail: string;
  onComplete: () => void;
}

type OnboardingStep = 'upload_resume' | 'voice_seed';

export function Onboarding({ userId, userEmail, onComplete }: OnboardingProps) {
  const [step, setStep] = useState<OnboardingStep>('upload_resume');
  const [voiceText, setVoiceText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSaveVoiceSeed = async () => {
    if (!voiceText.trim()) return;

    setStatus('saving');
    setError(null);

    const { data, error: ingestError } = await supabase.functions.invoke<{ documentId: string; chunkCount: number }>(
      'ingest',
      {
        body: {
          text: voiceText.trim(),
          kind: 'resume',
          origin: 'user_written',
        },
      },
    );

    if (ingestError || !data) {
      setStatus('error');
      setError(ingestError ? await describeIngestError(ingestError) : 'Failed to save voice sample.');
      return;
    }

    setStatus('idle');
    onComplete();
  };

  const handleSkipVoiceSeed = () => {
    onComplete();
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      {/* Top Header */}
      <header className="flex w-full items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-base font-bold tracking-tight text-slate-900">{APP_NAME}</h1>
        <div className="flex items-center gap-2">
          <span className="max-w-[180px] truncate text-xs text-slate-500" title={`Signed in as ${userEmail}`}>
            Signed in as {userEmail}
          </span>
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

      {/* Main Content Area */}
      <main className="flex flex-1 flex-col items-center p-4">
        <div className="flex w-full max-w-md flex-col gap-4">
          {step === 'upload_resume' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Step 1 of 2 · Getting Started
                </span>
                <h2 className="text-lg font-semibold text-slate-900">Upload your resume</h2>
                <p className="text-xs text-slate-500">
                  Jobibi drafts application answers grounded in your real work history. Upload your resume to begin.
                </p>
              </div>

              <div data-testid="onboarding-resume-step">
                <UploadDocument
                  userId={userId}
                  title="Resume upload"
                  onIngested={() => setStep('voice_seed')}
                />
              </div>
            </div>
          ) : (
            <div data-testid="onboarding-voice-step" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Step 2 of 2 · Optional
                </span>
                <h2 className="text-lg font-semibold text-slate-900">Career highlights &amp; writing style</h2>
                <p className="text-xs text-slate-500">
                  In a few sentences, describe your career highlights or writing style in your own words (or skip).
                </p>
              </div>

              <div className="flex flex-col gap-2 rounded border border-slate-200 p-3 bg-white">
                <label htmlFor="voice-seed-textarea" className="text-xs font-medium text-slate-700">
                  Your summary in your own words
                </label>
                <textarea
                  id="voice-seed-textarea"
                  data-testid="voice-seed-input"
                  rows={4}
                  value={voiceText}
                  onChange={(e) => setVoiceText(e.target.value)}
                  disabled={status === 'saving'}
                  placeholder="e.g. Lead frontend engineer with 6+ years building high-performance web apps in React and TypeScript. I write direct, concise prose and focus on measurable business impact."
                  className="rounded border border-slate-300 p-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400">
                  This seeds your voice corpus so Jobibi begins matching your natural tone from Day 1.
                </p>

                {error && <p className="text-xs text-red-600" data-testid="voice-seed-error">{error}</p>}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleSkipVoiceSeed}
                    disabled={status === 'saving'}
                    data-testid="voice-seed-skip-btn"
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveVoiceSeed()}
                    disabled={status === 'saving' || voiceText.trim().length === 0}
                    data-testid="voice-seed-save-btn"
                    className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {status === 'saving' ? 'Saving…' : 'Save & Continue'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default Onboarding;
