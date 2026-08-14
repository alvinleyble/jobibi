import { describe, expect, it } from 'vitest';
import { executeAutofill, AUTOFILL_CONFIDENCE_THRESHOLD } from '@jobibi/shared';

describe('extension autofill contract', () => {
  it('AUTOFILL_CONFIDENCE_THRESHOLD is locked at 0.75 per D16', () => {
    expect(AUTOFILL_CONFIDENCE_THRESHOLD).toBe(0.75);
  });

  it('rejects auto-fill when confidence is low (< 0.75)', () => {
    const res = executeAutofill({
      el: null,
      text: 'Draft answer',
      confidence: 0.5,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Auto-fill disabled: Low confidence mapping (< 0.75). Please copy and paste manually.');
  });

  it('rejects auto-fill when isSensitive is true (D17 structural exclusion)', () => {
    const res = executeAutofill({
      el: null,
      text: 'Draft answer',
      confidence: 0.95,
      isSensitive: true,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Auto-fill disabled: Sensitive fields cannot be auto-filled.');
  });
});
