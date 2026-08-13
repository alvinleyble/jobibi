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
// Generic label-proximity fallback extractor (S7)
// Site-agnostic extractor usable when no dedicated adapter matches.
// Uses label-for/proximity heuristics generalized from JobStreet adapter's
// own confidence sourcing (CONFIDENCE_BY_SOURCE), so an unsupported site
// still gets best-effort question detection instead of nothing.
// ---------------------------------------------------------------------------

function extractGenericJobContext(root: ParentNode): JobContext {
  const ctx: JobContext = {};
  // Best-effort: first meaningful h1 as role, nearby company-ish text
  const h1 = (root as Document).querySelector?.('h1');
  if (h1) {
    const t = cleanLabel(h1.textContent || '');
    if (t && t.length >= 3 && t.length <= 120) ctx.roleTitle = t;
  }
  const companySelectors = [
    '[data-testid="company-name"]',
    '[data-companyName]',
    'a[href*="company"]',
    '[class*="company"]',
  ];
  for (const sel of companySelectors) {
    const el = (root as Document).querySelector?.(sel);
    if (el) {
      const t = cleanLabel(el.textContent || '');
      if (t && t.length >= 2 && t.length <= 80 && t !== ctx.roleTitle) {
        ctx.company = t;
        break;
      }
    }
  }
  return ctx;
}

export function extractGenericQuestions(root: ParentNode): ExtractionResult {
  const host =
    (root as Document).location?.hostname ||
    (root as unknown as { host?: string }).host ||
    'unknown';

  // Generic scans the whole document — no site-specific scoping
  const rawFields = Array.from((root as Document | Element).querySelectorAll?.(FIELD_SELECTOR) ?? []);

  const fields = rawFields.filter((el) => {
    if (!isVisible(el)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'password' || type === 'file') return false;
    // Avoid capturing global search boxes: generic is more prone to noise,
    // so require small heuristic — field should be inside a form or have
    // nearby label-like text.
    const name = (el.getAttribute('name') || '').toLowerCase();
    const id = (el.getAttribute('id') || '').toLowerCase();
    // Skip known non-question inputs
    if (['q', 'search', 'keyword', 'what', 'where', 'query', 'email'].includes(name) && !el.closest('form')) {
      // Still allow if there's a clear label-for (then it's likely a question)
      if (!id || !(root as Document).querySelector?.(`label[for="${escapeCss(id)}"]`)) return false;
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

  const jobContext = extractGenericJobContext(root);

  return { questions, jobContext, host, adapter: 'generic' };
}
