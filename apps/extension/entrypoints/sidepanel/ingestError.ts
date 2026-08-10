import { FunctionsHttpError } from '@supabase/supabase-js';

// supabase-js's FunctionsHttpError.message is always the fixed string "Edge
// Function returned a non-2xx status code" — the actual reason the ingest
// function rejected the file (e.g. "No extractable text found in this
// file") is only in its response body. Read that so the user sees why.
export async function describeIngestError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // fall through to the generic message below
    }
  }
  return error instanceof Error ? error.message : 'Ingestion failed.';
}
