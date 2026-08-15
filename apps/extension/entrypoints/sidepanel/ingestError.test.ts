import { FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { describeIngestError, humanizeErrorMessage } from './ingestError';

describe('humanizeErrorMessage', () => {
  it('humanizes network errors into clear actionable text', () => {
    expect(humanizeErrorMessage('TypeError: Failed to fetch')).toBe(
      'Unable to connect. Please check your internet connection and try again.',
    );
    expect(humanizeErrorMessage('NetworkError when attempting to fetch resource.')).toBe(
      'Unable to connect. Please check your internet connection and try again.',
    );
  });

  it('humanizes Edge Function 5xx / SDK generic errors into clear actionable text', () => {
    expect(humanizeErrorMessage('Edge Function returned a non-2xx status code')).toBe(
      'Our server encountered a temporary issue. Please try again in a few moments.',
    );
    expect(humanizeErrorMessage('status code 500')).toBe(
      'Our server encountered a temporary issue. Please try again in a few moments.',
    );
  });

  it('humanizes non-JSON and parse errors', () => {
    expect(humanizeErrorMessage('Model returned non-JSON')).toBe(
      'We received an unexpected response from the server. Please try again.',
    );
    expect(humanizeErrorMessage('Unexpected token < in JSON at position 0')).toBe(
      'We received an unexpected response from the server. Please try again.',
    );
  });

  it('preserves clean user-friendly messages', () => {
    const msg = 'Please upload a text-based PDF, DOCX, or TXT file.';
    expect(humanizeErrorMessage(msg)).toBe(msg);
  });
});

describe('describeIngestError', () => {
  it('surfaces the ingest function\'s own error message instead of the SDK\'s generic one', async () => {
    const response = new Response(JSON.stringify({ error: 'Please upload a text-based PDF, DOCX, or TXT file.' }), {
      status: 422,
    });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe('Please upload a text-based PDF, DOCX, or TXT file.');
  });

  it('surfaces actionable unextractable PDF text error', async () => {
    const pdfMsg = "We couldn't find any selectable text in this PDF. If your resume is a scanned image or photo, please upload a text-based PDF, DOCX, or copy-paste the text.";
    const response = new Response(JSON.stringify({ error: pdfMsg }), {
      status: 422,
    });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe(pdfMsg);
  });

  it('surfaces user-friendly message when error is a code and message is descriptive', async () => {
    const response = new Response(
      JSON.stringify({
        error: 'daily_cover_letter_preview_limit_reached',
        code: 'daily_cover_letter_preview_limit_reached',
        limit: 5,
        used: 5,
        message: "You've reached today's preview limit (5 drafts per day). Please try again tomorrow, or upgrade to Pro for unlimited cover letter drafting.",
      }),
      { status: 429 },
    );
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe(
      "You've reached today's preview limit (5 drafts per day). Please try again tomorrow, or upgrade to Pro for unlimited cover letter drafting.",
    );
  });

  it('falls back to a friendly message when the response body has no error field', async () => {
    const response = new Response(JSON.stringify({ unrelated: true }), { status: 500 });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe('Our server encountered a temporary issue. Please try again in a few moments.');
  });

  it('falls back to a friendly message when the response body is not JSON', async () => {
    const response = new Response('<html>not json</html>', { status: 500 });
    const message = await describeIngestError(new FunctionsHttpError(response));
    expect(message).toBe('Our server encountered a temporary issue. Please try again in a few moments.');
  });

  it('humanizes a plain network Error message', async () => {
    const message = await describeIngestError(new Error('Failed to fetch'));
    expect(message).toBe('Unable to connect. Please check your internet connection and try again.');
  });

  it('falls back to a friendly generic message for a non-Error value', async () => {
    const message = await describeIngestError('not an error');
    expect(message).toBe('not an error');
  });
});
