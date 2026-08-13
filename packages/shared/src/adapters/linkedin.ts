import type { ExtractedQuestion, ExtractionResult, JobContext } from './types.ts';
import {
  CONFIDENCE_BY_SOURCE,
  FIELD_SELECTOR,
  fieldTypeFor,
  isVisible,
  escapeCss,
  cleanLabel,
  fieldSelector,
  fieldId,
  resolveLabel,
  contextFor,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// LinkedIn Easy Apply adapter (S7B scoping)
// - Detects only within Easy Apply dialog container.
// - Within dialog, detects only on Additional Questions step (header or
//   employer-question markers). Skips contact-info, resume, review steps and
//   underlying search page entirely.
// - Cover Letter carve-out: a cover-letter field is excluded UNLESS it is
//   co-located in the same step as real employer questions (same presence
//   signal). Signal is "employer question exists in this step" — header or
//   dash-form markers or question-like label.
// Also opportunistically captures JD text when present behind modal (D11).
// ---------------------------------------------------------------------------

function extractLinkedInJobContext(root: ParentNode): JobContext {
  const ctx: JobContext = {};

  const roleSelectors = [
    '.jobs-unified-top-card__job-title',
    '.job-details-jobs-unified-top-card__job-title',
    'h1[data-test-job-title]',
    'h1.jobs-unified-top-card__job-title',
    'h2.jobs-unified-top-card__job-title',
    'h1',
  ];
  for (const sel of roleSelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) {
      const t = cleanLabel(el.textContent || '');
      if (t && t.length >= 3 && t.length <= 120) {
        ctx.roleTitle = t;
        break;
      }
    }
  }

  const companySelectors = [
    '.jobs-unified-top-card__company-name',
    '.job-details-jobs-unified-top-card__company-name',
    'a[data-test-company-name]',
    '.jobs-unified-top-card__subtitle a',
    '[class*="company"] a',
  ];
  for (const sel of companySelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) {
      const t = cleanLabel(el.textContent || '');
      if (t && t.length >= 2 && t.length <= 80) {
        ctx.company = t;
        break;
      }
    }
  }

  const jdSelectors = [
    '.jobs-description-content__text',
    '.jobs-description__content',
    '[data-test-job-description]',
    '.description__text',
    '.jobs-box__html-content',
    '#job-details',
  ];
  for (const sel of jdSelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) {
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (raw.length >= 50 && raw.length <= 15000) {
        ctx.jobDescription = raw.slice(0, 8000);
        break;
      }
    }
  }

  return ctx;
}

function findEasyApplyModal(root: ParentNode): Element | null {
  const modalSelectors = [
    '.jobs-easy-apply-modal',
    '.jobs-easy-apply-content',
    '[data-test-modal="easy-apply-modal"]',
    '.artdeco-modal--is-open',
    '.artdeco-modal',
    '[role="dialog"]',
  ];
  // Prefer modal that actually contains form fields
  for (const sel of modalSelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) {
      if (el.querySelector(FIELD_SELECTOR)) return el;
    }
  }
  // Fallback: any matching dialog, but only if it looks like Easy Apply (has text hint)
  for (const sel of modalSelectors) {
    const el = (root as Document).querySelector?.(sel) as Element | null;
    if (el) {
      const txt = (el.textContent || '').toLowerCase();
      // Heuristic: Easy Apply modals contain these markers
      if (txt.includes('easy apply') || txt.includes('additional questions') || el.querySelector('.fb-dash-form-element, .fb-form-element, .jobs-easy-apply-form-element')) {
        return el;
      }
    }
  }
  // Last resort: any dialog/modal
  for (const sel of modalSelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) return el;
  }
  return null;
}

function isCoverLetterField(field: Element, label: string): boolean {
  const lowLabel = label.toLowerCase();
  if (lowLabel.includes('cover letter') || lowLabel.includes('coverletter')) return true;
  const aria = (field.getAttribute('aria-label') || '').toLowerCase();
  if (aria.includes('cover letter')) return true;
  if (aria === 'write a cover letter') return true;
  const ph = (field.getAttribute('placeholder') || '').toLowerCase();
  if (ph.includes('cover letter') || ph.includes('introduce yourself')) return true;
  // Also check placeholder that commonly belongs to cover letter draft area
  // Generic detection: textarea with label exactly "Cover letter" (case-insensitive) is cover
  if (lowLabel.trim() === 'cover letter') return true;
  return false;
}

function isAdditionalQuestionsStep(modal: Element): boolean {
  const txt = (modal.textContent || '').toLowerCase();
  if (txt.includes('additional questions')) return true;
  if (modal.querySelector('.fb-dash-form-element, .fb-form-element, .jobs-easy-apply-form-element, [data-test-text-entity-list-form-component], [data-test-form-element]')) {
    return true;
  }
  // Fallback heuristic: modal contains at least one field whose label looks like an employer question
  // (contains ? or is long multi-word). This covers test fixtures that lack LinkedIn-specific classes.
  // We avoid counting cover-letter or obvious contact-info labels as employer question signal.
  const contactInfoExact = new Set([
    'phone',
    'phone number',
    'mobile phone number',
    'email',
    'email address',
    'city',
    'street address',
    'state',
    'province',
    'zip code',
    'postal code',
    'country',
    'first name',
    'last name',
    'full name',
    'address',
    'location',
    'home address',
  ]);
  const fields = Array.from(modal.querySelectorAll(FIELD_SELECTOR));
  for (const f of fields) {
    const type = (f.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'file') continue;
    if (!isVisible(f as Element)) continue;
    const { label } = resolveLabel(f as Element, modal as unknown as ParentNode);
    if (!label) continue;
    if (isCoverLetterField(f as Element, label)) continue;
    const low = label.toLowerCase().trim();
    if (contactInfoExact.has(low)) continue;
    // employer question heuristics: ? or reasonably descriptive prompt
    if (label.includes('?')) return true;
    if (label.length >= 12) return true;
  }
  return false;
}

export function extractLinkedInQuestions(root: ParentNode): ExtractionResult {
  const host =
    (root as Document).location?.hostname ||
    (root as unknown as { host?: string }).host ||
    'linkedin.com';

  const modal = findEasyApplyModal(root);
  const jobContext = extractLinkedInJobContext(root);

  // S7B: if no Easy Apply dialog container, return no questions (skip search page entirely)
  if (!modal) {
    return { questions: [], jobContext, host, adapter: 'linkedin' };
  }

  // S7B: within dialog, only Additional Questions step
  if (!isAdditionalQuestionsStep(modal)) {
    return { questions: [], jobContext, host, adapter: 'linkedin' };
  }

  const scope: ParentNode = modal as unknown as ParentNode;

  const rawFields = Array.from((scope as Document | Element).querySelectorAll?.(FIELD_SELECTOR) ?? []);

  const fields = rawFields.filter((el) => {
    if (!isVisible(el)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'password') return false;
    if (type === 'file') return false;
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (['q', 'search', 'keyword'].includes(name) && !el.closest('form')) return false;
    if (type === 'radio' || type === 'checkbox') {
      const gname = el.getAttribute('name');
      if (gname) {
        const first = (scope as Document).querySelector?.(
          `input[type="${type}"][name="${escapeCss(gname)}"]`,
        );
        if (first !== el) return false;
      }
    }
    return true;
  });

  // Build candidate questions, partitioning cover-letter vs employer
  const employerCandidates: ExtractedQuestion[] = [];
  const coverCandidates: ExtractedQuestion[] = [];
  const seenIds = new Set<string>();

  for (const field of fields) {
    const { label, source, context: labelCtx } = resolveLabel(field, scope);
    if (!label || source === 'none') continue;
    if (label.length < 4) continue;
    if (label.length > 500) continue;
    if (label.length > 220 && !label.trim().endsWith('?')) continue;
    if (label.length > 180 && !label.includes('?') && label.split(/\s+/).length > 25) continue;

    const fid = fieldId(field);
    if (seenIds.has(fid)) continue;
    seenIds.add(fid);

    const ctx = contextFor(field) ?? labelCtx;
    const confidence = CONFIDENCE_BY_SOURCE[source];
    const ftype = fieldTypeFor(field);

    const q: ExtractedQuestion = {
      id: fid,
      label,
      fieldType: ftype,
      context: ctx,
      field: {
        tagName: field.tagName.toLowerCase(),
        id: field.getAttribute('id') || undefined,
        name: field.getAttribute('name') || undefined,
        type: field.getAttribute('type') || undefined,
        selector: fieldSelector(field),
      },
      labelSource: source,
      confidence,
    };

    if (isCoverLetterField(field, label)) {
      coverCandidates.push(q);
    } else {
      employerCandidates.push(q);
    }
  }

  // S7B cover-letter carve-out: do NOT specially target cover letter UNLESS co-located with employer questions
  // Same page-level presence signal: employer question exists in this step
  let questions: ExtractedQuestion[];
  if (coverCandidates.length > 0 && employerCandidates.length === 0) {
    // No employer question present in this step -> cover letter not co-located, exclude it
    questions = [];
  } else if (coverCandidates.length > 0 && employerCandidates.length > 0) {
    // Co-located: keep both (no special exclusion)
    questions = [...employerCandidates, ...coverCandidates];
  } else {
    questions = employerCandidates;
  }

  return { questions, jobContext, host, adapter: 'linkedin' };
}
