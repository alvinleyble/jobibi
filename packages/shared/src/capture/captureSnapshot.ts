import type { JobContext } from '../adapters/types.ts';

// Answer entry shape shared between the live capture path and the eager
// pre-navigation snapshot (reliable step-transition trigger, Q3).
export interface CaptureAnswerEntry {
  questionLabel: string;
  answerText: string;
  draftText: string | null;
  fieldSelector: string;
  fieldId: string;
  mappingVerified: boolean;
  mismatchReason?: string;
}

export interface CaptureMismatch {
  questionLabel: string;
  reason: string;
}

export interface CaptureSnapshot {
  answers: CaptureAnswerEntry[];
  mismatches: CaptureMismatch[];
  jobContext: JobContext;
  url: string;
  host: string;
}

// ---------------------------------------------------------------------------
// Q3 snapshot-at-click: same-application guard.
//
// The question→field mapping is gone after an SPA step transition, so a stashed
// snapshot cannot be re-verified against the now-gone mapping (D16). Instead we
// verify the *application* is still the same job — role/company match when both
// are present, plus a job key derived from the URL. A stashed snapshot for a
// different job is discarded, preserving D16's cross-job guard without a false
// missing-drop.
// ---------------------------------------------------------------------------

export type JobKeyFromUrl = (url: string) => string;

/** JobStreet/Seek: everything before /apply/ is the job path. */
export function defaultJobKeyFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split('/apply/')[0] ?? '';
  } catch {
    return '';
  }
}

/**
 * LinkedIn: the job identity lives in /jobs/view/{id} (or ?currentJobId= for
 * recommended-feed listings). Step navigation keeps the URL fixed, so a change
 * here means the user actually moved to a different job.
 */
export function linkedInJobKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const view = u.pathname.match(/\/jobs\/view\/(\d+)/);
    if (view) return `view:${view[1]}`;
    const currentJobId = u.searchParams.get('currentJobId');
    if (currentJobId) return `currentJobId:${currentJobId}`;
    return u.pathname;
  } catch {
    return url;
  }
}

export function isSameApplication(
  snapshot: CaptureSnapshot,
  freshJobContext: JobContext,
  freshUrl: string,
  jobKeyFromUrl: JobKeyFromUrl = defaultJobKeyFromUrl,
): boolean {
  const s = snapshot.jobContext;
  const f = freshJobContext;
  if (s.roleTitle && f.roleTitle && s.roleTitle !== f.roleTitle) return false;
  if (s.company && f.company && s.company !== f.company) return false;
  try {
    const snapKey = jobKeyFromUrl(snapshot.url);
    const freshKey = jobKeyFromUrl(freshUrl);
    if (snapKey && freshKey && snapKey !== freshKey) return false;
  } catch {
    // Unparseable URL — fall back to the jobContext check alone.
  }
  return true;
}

// ---------------------------------------------------------------------------
// Merge decision (Q3).
//
// When the deferred capture re-derives an empty step after an SPA transition
// (the DOM has already swapped to the next step), merge the snapshot stashed at
// click time — guarded by the same-application check. A non-empty fresh
// derivation always wins: it is the live, D16-re-derived mapping.
// ---------------------------------------------------------------------------
export interface ResolvedCapturePayload {
  answers: CaptureAnswerEntry[];
  mismatches: CaptureMismatch[];
  jobContext: JobContext;
  usedSnapshot: boolean;
}

export function resolveCapturePayload(
  freshAnswers: CaptureAnswerEntry[],
  freshMismatches: CaptureMismatch[],
  freshJobContext: JobContext,
  freshUrl: string,
  snapshot: CaptureSnapshot | null,
  jobKeyFromUrl?: JobKeyFromUrl,
): ResolvedCapturePayload {
  if (
    freshAnswers.length === 0 &&
    freshMismatches.length === 0 &&
    snapshot &&
    snapshot.answers.length > 0 &&
    isSameApplication(snapshot, freshJobContext, freshUrl, jobKeyFromUrl)
  ) {
    return {
      answers: snapshot.answers,
      mismatches: snapshot.mismatches,
      jobContext: snapshot.jobContext,
      usedSnapshot: true,
    };
  }
  return {
    answers: freshAnswers,
    mismatches: freshMismatches,
    jobContext: freshJobContext,
    usedSnapshot: false,
  };
}
