import { FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { describeIngestError } from './ingestError';

describe('describeIngestError', () => {
  it('surfaces the ingest function\'s own error message instead of the SDK\'s generic one', async () => {
    const response = new Response(JSON.stringify({ error: 'No extractable text found in this file' }), {
      status: 422,
    });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe('No extractable text found in this file');
  });

  it('surfaces actionable unextractable PDF text error', async () => {
    const pdfMsg = "We couldn't find any selectable text in this PDF. If your resume is a scanned image or photo, please upload a text-based PDF, DOCX, or copy-paste the text.";
    const response = new Response(JSON.stringify({ error: pdfMsg }), {
      status: 422,
    });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe(pdfMsg);
  });

  it('falls back to the generic message when the response body has no error field', async () => {
    const response = new Response(JSON.stringify({ unrelated: true }), { status: 500 });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe('Edge Function returned a non-2xx status code');
  });

  it('falls back to the generic message when the response body is not JSON', async () => {
    const response = new Response('<html>not json</html>', { status: 500 });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe('Edge Function returned a non-2xx status code');
  });

  it('passes through a plain Error message unchanged', async () => {
    const message = await describeIngestError(new Error('Failed to fetch'));
    expect(message).toBe('Failed to fetch');
  });

  it('falls back to a generic message for a non-Error value', async () => {
    const message = await describeIngestError('not an error');
    expect(message).toBe('Ingestion failed.');
  });
});
