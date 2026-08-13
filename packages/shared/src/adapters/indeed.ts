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
// Indeed adapter (S7)
// Mirrors jobstreet.ts shape: confidence via CONFIDENCE_BY_SOURCE,
// label-for/proximity/blob-PII guards. Scoped to Indeed application flow.
// ---------------------------------------------------------------------------

function extractIndeedJobContext(root: ParentNode): JobContext {
  const ctx: JobContext = {};

  const roleSelectors = [
    '[data-testid="jobTitle"]',
    'h1.jobsearch-JobInfoHeader-title',
    'h1[data-testid="jobsearch-JobInfoHeader-title"]',
    'h1.icl-u-xs-mb--xs',
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
    '[data-testid="companyName"]',
    '[data-companyName]',
    '.jobsearch-InlineCompanyRating a',
    '.jobsearch-CompanyAvatar-companyName',
    'a[data-testid="company-name"]',
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

  return ctx;
}

function findIndeedFormRoot(root: ParentNode): ParentNode {
  const formSelectors = [
    '[data-testid="application-form"]',
    '.ia-Questions',
    'form[name="ia-questions"]',
    '#indeedApplyForm',
    'form[data-testid="apply-form"]',
    '[role="dialog"]',
  ];
  for (const sel of formSelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el && el.querySelector(FIELD_SELECTOR)) return el as unknown as ParentNode;
  }
  // Fallback: any form that contains fields
  const forms = Array.from((root as Document).querySelectorAll?.('form') ?? []);
  for (const f of forms) {
    if (f.querySelector(FIELD_SELECTOR)) return f as unknown as ParentNode;
  }
  return root;
}

export function extractIndeedQuestions(root: ParentNode): ExtractionResult {
  const host =
    (root as Document).location?.hostname ||
    (root as unknown as { host?: string }).host ||
    'indeed.com';

  const scope = findIndeedFormRoot(root);
  const rawFields = Array.from((scope as Document | Element).querySelectorAll?.(FIELD_SELECTOR) ?? []);

  const fields = rawFields.filter((el) => {
    if (!isVisible(el)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'password') return false;
    if (type === 'file') return false;
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (['q', 'search', 'keyword', 'what', 'where'].includes(name) && !el.closest('form')) return false;
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

  const questions: ExtractedQuestion[] = [];
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

  const jobContext = extractIndeedJobContext(root);

  return { questions, jobContext, host, adapter: 'indeed' };
}
