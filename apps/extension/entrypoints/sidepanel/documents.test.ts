import { describe, expect, it } from 'vitest';
import { validatePaste, PASTE_ALLOWED_KINDS, PASTE_MIN_CHARS, PASTE_MAX_CHARS, pastedDocumentProvenance } from '@jobibi/shared';

describe('Document Management & Ingestion Invariants', () => {
  it('allows pasting text for resume and cover_letter kinds', () => {
    expect(PASTE_ALLOWED_KINDS).toContain('resume');
    expect(PASTE_ALLOWED_KINDS).toContain('cover_letter');
    expect(PASTE_ALLOWED_KINDS).not.toContain('transcript');
  });

  it('validates minimum paste length constraint (PASTE_MIN_CHARS = 20)', () => {
    const tooShort = 'Too short';
    const result = validatePaste(tooShort, 'resume');
    expect(result.ok).toBe(false);
    expect(result.error).toContain(`minimum ${PASTE_MIN_CHARS} characters`);

    const validText = 'This is a valid summary describing 6 years of software engineering experience.';
    const validResult = validatePaste(validText, 'resume');
    expect(validResult.ok).toBe(true);
    expect(validResult.text).toBe(validText);
  });

  it('validates maximum paste length constraint (PASTE_MAX_CHARS = 20,000)', () => {
    const tooLong = 'a'.repeat(PASTE_MAX_CHARS + 1);
    const result = validatePaste(tooLong, 'cover_letter');
    expect(result.ok).toBe(false);
    expect(result.error).toContain(`maximum ${PASTE_MAX_CHARS} characters`);
  });

  it('generates consistent synthetic provenance for pasted documents with null storagePath', () => {
    const fakeDate = new Date('2026-08-15T00:00:00Z');
    const resumeProvenance = pastedDocumentProvenance('resume', fakeDate);
    expect(resumeProvenance.fileName).toBe('pasted-resume-2026-08-15');
    expect(resumeProvenance.mimeType).toBe('text/plain');
    expect(resumeProvenance.storagePath).toBeNull();

    const clProvenance = pastedDocumentProvenance('cover_letter', fakeDate);
    expect(clProvenance.fileName).toBe('pasted-cover_letter-2026-08-15');
    expect(clProvenance.storagePath).toBeNull();
  });

  it('formats document row labels with kind and filename on a single line', () => {
    const kindLabels = {
      resume: 'Resume',
      cover_letter: 'Cover letter',
      transcript: 'Transcript',
    };

    const doc = {
      id: 'doc-1',
      kind: 'cover_letter' as const,
      file_name: 'pasted-cover_letter-2026-08-15',
    };

    const formatted = `${kindLabels[doc.kind]} — ${doc.file_name}`;
    expect(formatted).toBe('Cover letter — pasted-cover_letter-2026-08-15');
  });
});
