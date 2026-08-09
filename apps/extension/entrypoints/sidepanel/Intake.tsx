import { useState } from 'react';
import { SENSITIVE_FACT_KINDS, type SensitiveFactKind } from '@jobibi/shared';
import { supabase } from './supabase';

const FIELD_CONFIG: Record<SensitiveFactKind, { label: string; placeholder: string }> = {
  salary: { label: 'Salary expectation', placeholder: 'e.g. ₱45,000/month' },
  notice_period: { label: 'Notice period', placeholder: 'e.g. 30 days' },
  work_authorization: { label: 'Work authorization', placeholder: 'e.g. PH citizen, no visa needed' },
  location: { label: 'Location', placeholder: 'e.g. Quezon City, PH (open to remote)' },
};

type Status = 'idle' | 'saving' | 'error' | 'saved';

interface IntakeProps {
  userId: string;
  onSaved: () => void;
}

function Intake({ userId, onSaved }: IntakeProps) {
  const [values, setValues] = useState<Record<SensitiveFactKind, string>>({
    salary: '',
    notice_period: '',
    work_authorization: '',
    location: '',
  });
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const allFilled = SENSITIVE_FACT_KINDS.every((kind) => values[kind].trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allFilled) return;

    setStatus('saving');
    setError(null);

    const rows = SENSITIVE_FACT_KINDS.map((kind) => ({
      user_id: userId,
      kind,
      value: values[kind].trim(),
    }));

    const { error: insertError } = await supabase.from('sensitive_facts').insert(rows);
    if (insertError) {
      setStatus('error');
      setError(insertError.message);
      return;
    }

    setStatus('saved');
    setValues({ salary: '', notice_period: '', work_authorization: '', location: '' });
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <h2 className="text-sm font-semibold text-slate-900">Sixty-second intake</h2>
      <p className="text-xs text-slate-500">
        These four facts are always shown to you with their source before Jobibi uses them — never drafted or
        filled automatically.
      </p>
      {SENSITIVE_FACT_KINDS.map((kind) => (
        <label key={kind} className="flex flex-col gap-1 text-xs text-slate-600">
          {FIELD_CONFIG[kind].label}
          <input
            type="text"
            value={values[kind]}
            placeholder={FIELD_CONFIG[kind].placeholder}
            onChange={(e) => setValues((prev) => ({ ...prev, [kind]: e.target.value }))}
            disabled={status === 'saving'}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      ))}
      <button
        type="submit"
        disabled={!allFilled || status === 'saving'}
        className="mt-1 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {status === 'saving' ? 'Saving…' : 'Save'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {status === 'saved' && <p className="text-xs text-emerald-600">Saved.</p>}
    </form>
  );
}

export default Intake;
