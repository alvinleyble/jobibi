import { FunctionsHttpError } from '@supabase/supabase-js';

// Humanizes common technical error messages into clear, warm, actionable text.
export function humanizeErrorMessage(rawMessage: string): string {
  const msg = rawMessage.trim();
  if (!msg) return 'Something went wrong. Please try again.';

  // Network / connection errors
  if (/Failed to fetch|NetworkError|Network request failed|net::ERR_|connection refused|fetch failed/i.test(msg)) {
    return 'Unable to connect. Please check your internet connection and try again.';
  }

  // Supabase Edge Function default HTTP error / 5xx server status
  if (
    /Edge Function returned a non-2xx status code/i.test(msg) ||
    /status (?:code )?(?:500|502|503|504)/i.test(msg) ||
    /Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(msg)
  ) {
    return 'Our server encountered a temporary issue. Please try again in a few moments.';
  }

  // JSON parse / unexpected response format errors
  if (/non-JSON|JSON Parse error|Unexpected token|is not valid JSON|SyntaxError/i.test(msg)) {
    return 'We received an unexpected response from the server. Please try again.';
  }

  // Auth / session expiration errors
  if (/JWT expired|invalid claim|Unauthorized|Not authenticated|Missing Authorization/i.test(msg)) {
    return 'Your session has expired. Please sign in again to continue.';
  }

  // Rate limit / quota errors
  if (/rate limit|too many requests/i.test(msg)) {
    return 'You have made too many requests in a short time. Please wait a moment and try again.';
  }

  return msg;
}

// supabase-js's FunctionsHttpError.message is always the fixed string "Edge
// Function returned a non-2xx status code" — the actual reason the ingest
// function rejected the file (e.g. "No extractable text found in this
// file") is only in its response body. Read that so the user sees why.
export async function describeIngestError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.message === 'string' && body.message.trim()) return humanizeErrorMessage(body.message);
      if (typeof body?.error === 'string' && body.error.trim()) return humanizeErrorMessage(body.error);
    } catch {
      // fall through to the friendly generic message below
    }
    return 'Our server encountered a temporary issue. Please try again in a few moments.';
  }
  if (error instanceof Error) {
    return humanizeErrorMessage(error.message);
  }
  if (typeof error === 'string') {
    return humanizeErrorMessage(error);
  }
  return 'Something went wrong while processing your document. Please try again.';
}
