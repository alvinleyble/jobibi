import { describe, expect, it } from 'vitest';
import { PASTE_MAX_CHARS, PASTE_MIN_CHARS, pastedDocumentProvenance, validatePaste } from './paste';

describe('validatePaste', () => {
  it('rejects kinds other than cover_letter', () => {
    const result = validatePaste('a'.repeat(PASTE_MIN_CHARS), 'resume');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only supported for/);
  });

  it('rejects empty or whitespace-only paste', () => {
    expect(validatePaste('', 'cover_letter').ok).toBe(false);
    expect(validatePaste('   \n\n  ', 'cover_letter').ok).toBe(false);
  });

  it('rejects paste shorter than the minimum', () => {
    const result = validatePaste('a'.repeat(PASTE_MIN_CHARS - 1), 'cover_letter');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too short/);
  });

  it('rejects paste longer than the maximum', () => {
    const result = validatePaste('a'.repeat(PASTE_MAX_CHARS + 1), 'cover_letter');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too long/);
  });

  it('accepts and trims a valid cover letter paste', () => {
    const text = `  ${'a'.repeat(PASTE_MIN_CHARS)}  `;
    const result = validatePaste(text, 'cover_letter');
    expect(result.ok).toBe(true);
    expect(result.text).toBe(text.trim());
  });

  it('accepts paste exactly at the minimum and maximum boundaries', () => {
    expect(validatePaste('a'.repeat(PASTE_MIN_CHARS), 'cover_letter').ok).toBe(true);
    expect(validatePaste('a'.repeat(PASTE_MAX_CHARS), 'cover_letter').ok).toBe(true);
  });
});

describe('pastedDocumentProvenance', () => {
  it('always sets storage_path to null, since a pasted document has no Storage object', () => {
    const provenance = pastedDocumentProvenance('cover_letter', new Date('2026-08-10T00:00:00Z'));
    expect(provenance.storagePath).toBeNull();
  });

  it('produces a synthetic, date-stamped file name and a text/plain mime type', () => {
    const provenance = pastedDocumentProvenance('cover_letter', new Date('2026-08-10T00:00:00Z'));
    expect(provenance.fileName).toBe('pasted-cover_letter-2026-08-10');
    expect(provenance.mimeType).toBe('text/plain');
  });
});
