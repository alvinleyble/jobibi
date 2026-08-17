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
// Cover-letter textarea detection (S8a)
// ---------------------------------------------------------------------------

/**
 * The Choose-documents step carries a single cover-letter textarea, which is
 * drafted through S8's adapter-independent Draft Cover Letter facility rather
 * than treated as an application question. When the page has no `_Q_` employer
 * question signal, that textarea is the one non-question field on the apply
 * flow that must stay excluded — the role-requirements step's employer
 * questions (salary, qualifications, years-of-experience, radio and checkbox
 * groups) do NOT carry `_Q_` ids and must NOT be dropped alongside it.
 * Mirrors the `isCoverLetterField` heuristics in linkedin.ts / indeed.ts.
 */
function isCoverLetterField(field: Element, label: string): boolean {
  const lowLabel = label.toLowerCase();
  if (lowLabel.includes('cover letter') || lowLabel.includes('coverletter')) return true;
  if (lowLabel.trim() === 'cover letter') return true;
  const aria = (field.getAttribute('aria-label') || '').toLowerCase();
  if (aria.includes('cover letter') || aria.includes('coverletter')) return true;
  const ph = (field.getAttribute('placeholder') || '').toLowerCase();
  if (ph.includes('cover letter') || ph.includes('introduce yourself')) return true;
  const name = (field.getAttribute('name') || '').toLowerCase();
  if (name.includes('coverletter') || name.includes('cover_letter') || name.includes('cover-letter')) return true;
  const id = (field.getAttribute('id') || '').toLowerCase();
  if (id.includes('coverletter') || id.includes('cover_letter') || id.includes('cover-letter')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Job context (best-effort)
// ---------------------------------------------------------------------------

function extractJobContext(root: ParentNode): JobContext {
  const ctx: JobContext = {};
  // Common JobStreet selectors for role title — try multiple.
  const roleSelectors = [
    '[data-testid="job-title"]',
    'h1[data-automation="jobTitle"]',
    'h1',
    '[class*="job-title"]',
    '[class*="JobTitle"]',
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
    '[data-testid="company-name"]',
    '[data-automation="companyName"]',
    'a[data-automation="jobCompany"]',
    '[class*="company"]',
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

// ---------------------------------------------------------------------------
// Public entry: pure function over a DOM root (Document or Element)
// ---------------------------------------------------------------------------

export function extractJobStreetQuestions(root: ParentNode): ExtractionResult {
  const host =
    (root as Document).location?.hostname ||
    (root as unknown as { host?: string }).host ||
    'jobstreet';

  const rawFields = Array.from((root as Document | Element).querySelectorAll?.(FIELD_SELECTOR) ?? []);

  // Site-generic step scoping: when the page has real employer questions
  // (PH_Q_ / _Q_ — e.g. PH_Q_7791_V86_A151031, PH_Q_7288…), keep only those.
  // This excludes stepper, job header ("Applying for…"), profile card, and
  // the Choose-documents cover-letter textarea without hardcoding any company
  // name. On the role-requirements step the employer questions do NOT carry
  // _Q_ ids (salary/qualification/year dropdowns, radio and checkbox groups),
  // so _Q_ is a positive-only signal: its absence never drops a field.
  const hasEmployerQOnPage = rawFields.some(
    (f) => /_Q_/.test(f.getAttribute('id') || '') || /_Q_/.test(f.getAttribute('name') || ''),
  );
  const bodyText = (root as Document).body?.textContent || (root as Document).textContent || '';
  const isApplyFlow =
    bodyText.includes('Answer employer questions') && bodyText.includes('Choose documents');

  const fields = rawFields.filter((el) => {
    if (!isVisible(el)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'password' || type === 'file') {
      if (type === 'file') return false;
    }
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (['q', 'search', 'keyword'].includes(name) && !(el.closest('form'))) return false;

    if (hasEmployerQOnPage) {
      const id = el.getAttribute('id') || '';
      const rawName = el.getAttribute('name') || '';
      const isEmployerQ = /_Q_/.test(id) || /_Q_/.test(rawName) || /question-.*_Q_/.test(id);
      if (!isEmployerQ) return false;
    }

    if (type === 'radio' || type === 'checkbox') {
      const gname = el.getAttribute('name');
      if (gname) {
        const first = (root as Document).querySelector?.(
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
    const { label, source, context: labelCtx } = resolveLabel(field, root);
    if (!label || source === 'none') continue;
    // After step-scoping via _Q_, stepper/PII already excluded, but keep
    // the huge-blob guard for hidden options lists.
    if (label.length < 4) continue;
    if (label.length > 500) continue;
    if (label.length > 220 && !label.trim().endsWith('?')) continue;

    // S8a: on the real apply flow, when there is no _Q_ employer-question
    // signal, exclude the Choose-documents cover-letter textarea. Other
    // non-_Q_ fields here are the role-requirements employer questions and
    // must stay (they carry no _Q_ id).
    if (!hasEmployerQOnPage && isApplyFlow && isCoverLetterField(field, label)) continue;

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

  // Special: radio/checkbox groups often have the question in a legend or
  // heading above the group, not per-button. If we kept one radio per
  // group, its proximity label is the group question — already handled.
  // For checkboxes with distinct questions per box, each keeps its own
  // wrapping label (label-wrap) which already wins.

  const jobContext = extractJobContext(root);

  return { questions, jobContext, host };
}
