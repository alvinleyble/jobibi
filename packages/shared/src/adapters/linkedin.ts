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
// LinkedIn Easy Apply adapter (S7)
// Mirrors jobstreet.ts shape: confidence via CONFIDENCE_BY_SOURCE,
// label-for/proximity/blob-PII guards. Scoped to Easy Apply modal.
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

  // D11: opportunistically capture JD text when already present in DOM behind modal
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
  for (const sel of modalSelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) {
      // Prefer the one that actually contains form fields
      if (el.querySelector(FIELD_SELECTOR)) return el;
    }
  }
  // fallback: any dialog containing fields
  for (const sel of modalSelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) return el;
  }
  return null;
}

export function extractLinkedInQuestions(root: ParentNode): ExtractionResult {
  const host =
    (root as Document).location?.hostname ||
    (root as unknown as { host?: string }).host ||
    'linkedin.com';

  const modal = findEasyApplyModal(root);
  // Scope to modal when present; otherwise scan whole doc (modal may not have opened yet)
  const scope: ParentNode = (modal as unknown as ParentNode) ?? root;

  const rawFields = Array.from((scope as Document | Element).querySelectorAll?.(FIELD_SELECTOR) ?? []);

  const fields = rawFields.filter((el) => {
    if (!isVisible(el)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'password') return false;
    if (type === 'file') return false;
    // Exclude nav/search inputs outside modal context
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (['q', 'search', 'keyword'].includes(name) && !el.closest('form')) return false;
    // Dedupe radio/checkbox groups
    if (type === 'radio' || type === 'checkbox') {
      const gname = el.getAttribute('name');
      if (gname) {
        const first = (scope as Document).querySelector?.(
          `input[type="${type}"][name="${escapeCss(gname)}"]`,
        );
        if (first !== el) return false;
      }
    }
    // LinkedIn Easy Apply step scoping: when modal has step indicator,
    // still include all fields — LinkedIn paginates inside modal, each step is valid
    return true;
  });

  const questions: ExtractedQuestion[] = [];
  const seenIds = new Set<string>();

  for (const field of fields) {
    const { label, source, context: labelCtx } = resolveLabel(field, scope);
    if (!label || source === 'none') continue;
    if (label.length < 4) continue;
    if (label.length > 500) continue;
    if (label.length > 220 && !label.trim().endsWith('?')) continue;
    // PII/blob guard: skip huge non-question blobs
    if (label.length > 180 && !label.includes('?') && label.split(/\s+/).length > 25) continue;

    const fid = fieldId(field);
    if (seenIds.has(fid)) continue;
    seenIds.add(fid);

    const ctx = contextFor(field) ?? labelCtx;
    const confidence = CONFIDENCE_BY_SOURCE[source];
    const ftype = fieldTypeFor(field);

    questions.push({
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
    });
  }

  const jobContext = extractLinkedInJobContext(root);

  return { questions, jobContext, host, adapter: 'linkedin' };
}
