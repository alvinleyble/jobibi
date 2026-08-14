import type { DocumentKind } from '../index.ts';

// Paste is supported for cover letters and resume / career highlights / voice seeding.
export const PASTE_ALLOWED_KINDS: readonly DocumentKind[] = ['cover_letter', 'resume'];

export const PASTE_MIN_CHARS = 20;
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
    return { ok: false, error: `Pasting text is only supported for: ${PASTE_ALLOWED_KINDS.join(', ')}` };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Please enter or paste some text to continue.' };
  }
  if (trimmed.length < PASTE_MIN_CHARS) {
    return { ok: false, error: `Your text is too short (minimum ${PASTE_MIN_CHARS} characters). Please provide a little more detail.` };
  }
  if (trimmed.length > PASTE_MAX_CHARS) {
    return { ok: false, error: `Your text is too long (maximum ${PASTE_MAX_CHARS} characters). Please shorten it and try again.` };
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
