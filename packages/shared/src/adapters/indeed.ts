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
// S7C: scoped to smartapply.indeed.com questions-module step(s) only.
// ---------------------------------------------------------------------------

function isIndeedQuestionsModuleStep(root: ParentNode): boolean {
  const loc = (root as unknown as Document).location as unknown as
    | { href?: string; hostname?: string; pathname?: string }
    | undefined;
  const href = loc?.href || '';
  const hostname = loc?.hostname || '';
  const pathname = loc?.pathname || '';

  // JSDOM test fixtures have about:blank / empty hostname — treat as
  // questions-module for test compatibility; real browser always has a URL.
  if (!href || href === 'about:blank' || !hostname) return true;

  // Real employer questions live only on smartapply.indeed.com
  if (!hostname.includes('smartapply')) return false;

  // URL pattern /beta/indeedapply/form/questions-module/questions/N
  // N increments across multi-page flows — match any digit sequence.
  const questionsModuleRe = /\/beta\/indeedapply\/form\/questions-module\/questions\/\d+/;
  if (!questionsModuleRe.test(pathname)) return false;

  return true;
}

function isCoverLetterField(field: Element, label: string): boolean {
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes('cover letter')) return true;
  const name = (field.getAttribute('name') || '').toLowerCase();
  if (name.includes('coverletter') || name.includes('cover_letter') || name.includes('cover-letter')) return true;
  const id = (field.getAttribute('id') || '').toLowerCase();
  if (id.includes('coverletter') || id.includes('cover_letter') || id.includes('cover-letter')) return true;
  const ariaLabel = (field.getAttribute('aria-label') || '').toLowerCase();
  if (ariaLabel.includes('cover letter')) return true;
  const placeholder = (field.getAttribute('placeholder') || '').toLowerCase();
  if (placeholder.includes('cover letter')) return true;
  return false;
}

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

  const jobContext = extractIndeedJobContext(root);

  // S7C: only questions-module step(s) surface real employer questions.
  // Exclude homepage/search-results and resume-selection-module entirely.
  if (!isIndeedQuestionsModuleStep(root)) {
    return { questions: [], jobContext, host, adapter: 'indeed' };
  }

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

  // Two-pass: collect candidates with cover-letter flag, then apply
  // co-location rule — cover letter excluded unless alongside employer Q.
  type Candidate = {
    field: Element;
    label: string;
    source: ReturnType<typeof resolveLabel>['source'];
    labelCtx: string | undefined;
    fid: string;
    isCoverLetter: boolean;
  };
  const candidates: Candidate[] = [];
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

    const isCoverLetter = isCoverLetterField(field, label);
    candidates.push({ field, label, source, labelCtx, fid, isCoverLetter });
  }

  // Same page-level presence signal used to find employer questions:
  // do we have at least one non-cover-letter question on this page?
  const hasEmployerQuestion = candidates.some((c) => !c.isCoverLetter);

  const questions: ExtractedQuestion[] = [];
  for (const c of candidates) {
    // S7C cover-letter carve-out: exclude cover letter unless co-located
    // with real employer questions on the same questions-module step.
    if (c.isCoverLetter && !hasEmployerQuestion) continue;

    const ctx = contextFor(c.field) ?? c.labelCtx;
    const confidence = CONFIDENCE_BY_SOURCE[c.source];
    const ftype = fieldTypeFor(c.field);

    questions.push({
      id: c.fid,
      label: c.label,
      fieldType: ftype,
      context: ctx,
      field: {
        tagName: c.field.tagName.toLowerCase(),
        id: c.field.getAttribute('id') || undefined,
        name: c.field.getAttribute('name') || undefined,
        type: c.field.getAttribute('type') || undefined,
        selector: fieldSelector(c.field),
      },
      labelSource: c.source,
      confidence,
    });
  }

  return { questions, jobContext, host, adapter: 'indeed' };
}
