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

/**
 * Indeed: the job identity lives in jk= / vjk= / iaKey= / jobKey= / jobid= query params,
 * or the /beta/indeedapply/form or /indeedapply/form path prefix for SmartApply.
 * Step navigation on SmartApply changes the module suffix (/questions-module/...,
 * /resume-selection-module, /review-module) while preserving the form identity.
 */
export function indeedJobKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const jk =
      u.searchParams.get('jk') ||
      u.searchParams.get('vjk') ||
      u.searchParams.get('iaKey') ||
      u.searchParams.get('jobKey') ||
      u.searchParams.get('jobid');
    if (jk) return `jk:${jk}`;
    if (u.pathname.includes('/beta/indeedapply/form') || u.pathname.includes('/indeedapply/form')) {
      const prefix = u.pathname.match(/(\/beta)?\/indeedapply\/form/);
      if (prefix) return prefix[0];
    }
    const view = u.pathname.match(/\/viewjob/);
    if (view) return u.pathname;
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
// The deferred capture runs after the SPA has swapped the step away, so its
// re-derivation describes the *next* step, not the one the user just answered.
// The two sets are therefore unioned by question label rather than one
// replacing the other: the fresh entry wins on conflict (it is the live,
// D16-re-derived mapping) and the snapshot supplies the questions that only
// existed on the step that is now gone. The whole merge is guarded by the
// same-application check.
//
// Mismatches need the same distinction. Once the step is gone, every question
// Jobibi drafted on it is absent from the re-derived mapping, so
// verifySingleMapping reports "missing in re-derived mapping" for all of them.
// That is the expected stale-step signal, not the D16 mis-binding the drop
// exists to catch, so it must not block the merge. Any *other* mismatch reason
// (label/selector/field-id disagreement) is a real mis-binding and still
// suppresses the snapshot's answer for that question.
// ---------------------------------------------------------------------------
export interface ResolvedCapturePayload {
  answers: CaptureAnswerEntry[];
  mismatches: CaptureMismatch[];
  jobContext: JobContext;
  usedSnapshot: boolean;
}

/**
 * True for the "the step is gone" mismatch produced by verifySingleMapping when
 * the re-derived mapping no longer contains the question at all.
 */
export function isStaleStepMismatch(mismatch: CaptureMismatch): boolean {
  return mismatch.reason.startsWith('missing in re-derived mapping');
}

function labelKey(label: string): string {
  return label.replace(/\s+/g, ' ').trim().toLowerCase();
}

function mergeJobContext(fresh: JobContext, snapshot: JobContext): JobContext {
  return {
    roleTitle: fresh.roleTitle ?? snapshot.roleTitle,
    company: fresh.company ?? snapshot.company,
    jobDescription: fresh.jobDescription ?? snapshot.jobDescription,
  };
}

export function resolveCapturePayload(
  freshAnswers: CaptureAnswerEntry[],
  freshMismatches: CaptureMismatch[],
  freshJobContext: JobContext,
  freshUrl: string,
  snapshot: CaptureSnapshot | null,
  jobKeyFromUrl?: JobKeyFromUrl,
): ResolvedCapturePayload {
  const passthrough: ResolvedCapturePayload = {
    answers: freshAnswers,
    mismatches: freshMismatches,
    jobContext: freshJobContext,
    usedSnapshot: false,
  };

  if (
    !snapshot ||
    snapshot.answers.length === 0 ||
    !isSameApplication(snapshot, freshJobContext, freshUrl, jobKeyFromUrl)
  ) {
    return passthrough;
  }

  const freshLabels = new Set(freshAnswers.map((a) => labelKey(a.questionLabel)));
  const blocked = new Set(
    freshMismatches.filter((m) => !isStaleStepMismatch(m)).map((m) => labelKey(m.questionLabel)),
  );

  const merged = new Map<string, CaptureAnswerEntry>();
  let usedSnapshot = false;
  for (const a of snapshot.answers) {
    const key = labelKey(a.questionLabel);
    if (freshLabels.has(key) || blocked.has(key)) continue;
    merged.set(key, a);
    usedSnapshot = true;
  }
  for (const a of freshAnswers) merged.set(labelKey(a.questionLabel), a);

  const answeredLabels = new Set(merged.keys());
  const mismatches: CaptureMismatch[] = [];
  const seenMismatches = new Set<string>();
  for (const m of [...freshMismatches, ...snapshot.mismatches]) {
    const key = labelKey(m.questionLabel);
    // A stale-step mismatch for a question the snapshot did answer is noise.
    if (isStaleStepMismatch(m) && answeredLabels.has(key)) continue;
    const dedupeKey = `${key}\u0000${m.reason}`;
    if (seenMismatches.has(dedupeKey)) continue;
    seenMismatches.add(dedupeKey);
    mismatches.push(m);
  }

  return {
    answers: [...merged.values()],
    mismatches,
    jobContext: mergeJobContext(freshJobContext, snapshot.jobContext),
    usedSnapshot,
  };
}
