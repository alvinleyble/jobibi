import type { DocumentKind } from '../index.ts';

// S3b: paste is only offered for cover letters — resumes and transcripts
// stay upload-only (transcripts especially lose fidelity when pasted).
export const PASTE_ALLOWED_KINDS: readonly DocumentKind[] = ['cover_letter'];

export const PASTE_MIN_CHARS = 50;
export const PASTE_MAX_CHARS = 20000;

export interface PasteValidationResult {
  ok: boolean;
  error?: string;
  text?: string;
}

/**
 * Validates a pasted-text ingest request, trimming the text on success.
 * Mirrors the file-upload validation shape so callers can surface `error`
 * verbatim via the existing describeIngestError pattern.
 */
export function validatePaste(text: string, kind: DocumentKind): PasteValidationResult {
  if (!PASTE_ALLOWED_KINDS.includes(kind)) {
    return { ok: false, error: `Paste is only supported for: ${PASTE_ALLOWED_KINDS.join(', ')}` };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Pasted text is empty' };
  }
  if (trimmed.length < PASTE_MIN_CHARS) {
    return { ok: false, error: `Pasted text is too short (minimum ${PASTE_MIN_CHARS} characters)` };
  }
  if (trimmed.length > PASTE_MAX_CHARS) {
    return { ok: false, error: `Pasted text is too long (maximum ${PASTE_MAX_CHARS} characters)` };
  }
  return { ok: true, text: trimmed };
}

export interface PastedDocumentProvenance {
  fileName: string;
  mimeType: string;
  storagePath: null;
}

/**
 * Synthetic provenance for a pasted document, which has no Storage object.
 * `storagePath` is always null — the `documents.storage_path` column is
 * nullable specifically for this case (see the S3b migration).
 */
export function pastedDocumentProvenance(kind: DocumentKind, now: Date = new Date()): PastedDocumentProvenance {
  return {
    fileName: `pasted-${kind}-${now.toISOString().slice(0, 10)}`,
    mimeType: 'text/plain',
    storagePath: null,
  };
}
