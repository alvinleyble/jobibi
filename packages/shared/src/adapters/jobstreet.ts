import type {
  ExtractedQuestion,
  ExtractionResult,
  FieldType,
  JobContext,
  LabelSource,
} from './types.ts';

// ---------------------------------------------------------------------------
// Confidence table (D16). Higher = more certain the label belongs to the
// field. Used both at suggestion time and re-derived at capture.
// ---------------------------------------------------------------------------
const CONFIDENCE_BY_SOURCE: Record<LabelSource, number> = {
  'label-for': 1.0,
  'label-wrap': 0.95,
  'aria-labelledby': 0.85,
  'aria-label': 0.8,
  placeholder: 0.6,
  proximity: 0.5,
  none: 0,
};

// Fields JobStreet application forms use. Keep selector tight — we only
// want question-answer fields, not search boxes or nav inputs.
const FIELD_SELECTOR =
  'textarea, input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input:not([type]), select, input[type="radio"], input[type="checkbox"]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldTypeFor(el: Element): FieldType {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'input') {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (t === 'radio') return 'radio';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'file') return 'file';
    if (t === 'email') return 'email';
    if (t === 'number') return 'number';
    if (t === 'tel') return 'text';
    if (t === 'url') return 'text';
    return 'text';
  }
  return 'unknown';
}

function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = (el.getAttribute('style') || '').toLowerCase();
  if (style.includes('display:none') || style.includes('visibility:hidden')) return false;
  // Do not use getBoundingClientRect — JSDOM returns 0 for everything,
  // and form fields (textarea/input/select) have no text content, so a
  // rect check would hide every field in tests.
  return true;
}

function escapeCss(s: string): string {
  const c = (globalThis as unknown as { CSS?: { escape: (v: string) => string } }).CSS;
  if (c?.escape) return c.escape(s);
  // Fallback for environments without CSS.escape (Node without jsdom global).
  return s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function cleanLabel(text: string): string {
  // Collapse whitespace, strip trailing * / : / (required) markers JobStreet uses.
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[\*:：:]\s*$/, '')
    .replace(/\s*\(required\)\s*$/i, '')
    .trim();
}

function fieldSelector(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return `#${escapeCss(id)}`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
  // fallback: tag + nth-of-type within parent
  const parent = el.parentElement;
  if (!parent) return el.tagName.toLowerCase();
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  const idx = sameTag.indexOf(el);
  if (sameTag.length > 1 && idx >= 0) {
    return `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
  }
  return el.tagName.toLowerCase();
}

function fieldId(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return id;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}:${name}`;
  return fieldSelector(el);
}

// ---------------------------------------------------------------------------
// Label resolution (ordered by confidence)
// ---------------------------------------------------------------------------

function resolveLabel(
  field: Element,
  root: ParentNode,
): { label: string; source: LabelSource; context?: string } {
  // For grouped radio/checkbox (same name, >1 inputs) the per-option
  // <label for="id"> (e.g. "JIRA") is NOT the question — the group header
  // "Which of the following issue and bug tracking software do you have
  // experience with?" is. Detect grouping first and prefer the group label.
  const gType = (field.getAttribute('type') || '').toLowerCase();
  const gName = field.getAttribute('name');
  const isGrouped =
    (gType === 'radio' || gType === 'checkbox') &&
    !!gName &&
    (root as Document).querySelectorAll?.(`input[type="${gType}"][name="${escapeCss(gName)}"]`)?.length > 1;
  if (isGrouped) {
    const fieldset = field.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) {
        const t = cleanLabel(legend.textContent || '');
        if (t) return { label: t, source: 'proximity' };
      }
    }
    const groupHeader = findGroupHeaderForGroupedField(field, root, gName!);
    if (groupHeader) return { label: groupHeader, source: 'proximity' };
    const proxEarly = findProximityLabel(field);
    if (proxEarly && proxEarly.length > 15) return { label: proxEarly, source: 'proximity' };
  }

  // 1. <label for="id">
  const id = field.getAttribute('id');
  if (id) {
    const lbl = root.querySelector(`label[for="${escapeCss(id)}"]`);
    if (lbl) {
      const t = cleanLabel(lbl.textContent || '');
      if (t) return { label: t, source: 'label-for' };
    }
  }

  // 2. Wrapping <label> — for non-grouped radio/checkbox, prefer a fieldset
  //    legend / group label over the per-option wrapping label ("Yes"/"No").
  const type = gType;
  const isOption = type === 'radio' || type === 'checkbox';
  if (isOption && !isGrouped) {
    const fieldset = field.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) {
        const t = cleanLabel(legend.textContent || '');
        if (t) return { label: t, source: 'proximity' };
      }
    }
    const proxEarly = findProximityLabel(field);
    if (proxEarly) return { label: proxEarly, source: 'proximity' };
  }
  const wrap = field.closest('label');
  if (wrap) {
    // Clone and remove the field itself to get label text.
    const clone = wrap.cloneNode(true) as HTMLElement;
    const inner = clone.querySelector(field.tagName.toLowerCase());
    if (inner) inner.remove();
    const t = cleanLabel(clone.textContent || '');
    if (t) return { label: t, source: 'label-wrap' };
  }

  // 3. aria-labelledby
  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const parts = ids
      .map((lid) => root.querySelector(`#${escapeCss(lid)}`)?.textContent || '')
      .map(cleanLabel)
      .filter(Boolean);
    if (parts.length) {
      return { label: parts.join(' '), source: 'aria-labelledby' };
    }
  }

  // 4. aria-label
  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) {
    const t = cleanLabel(ariaLabel);
    if (t) return { label: t, source: 'aria-label' };
  }

  // 5. placeholder (also kept as context for other sources, but as sole
  //    label it is weaker).
  const placeholder = field.getAttribute('placeholder');
  if (placeholder) {
    const t = cleanLabel(placeholder);
    // Only use placeholder as label when it looks like a question/prompt
    // (contains ? or is longer than 8 chars). Very short placeholders
    // like "e.g." are not question labels.
    if (t && (t.includes('?') || t.length > 8)) {
      return { label: t, source: 'placeholder', context: t };
    }
  }

  // 6. Proximity: look for nearby text — previous label-like element,
  //    preceding heading, or data attributes JobStreet uses.
  const prox = findProximityLabel(field);
  if (prox) return { label: prox, source: 'proximity' };

  return { label: '', source: 'none' };
}

function findProximityLabel(field: Element): string | null {
  // Walk up a few ancestors and scan previous siblings for a likely label.
  // JobStreet often has structure: <div><span>Question text</span><textarea/></div>
  // or <div><p>Question</p><input/></div>

  // Check previous siblings of the field and its ancestors up to 3 levels.
  let cur: Element | null = field;
  for (let depth = 0; depth < 3 && cur; depth++) {
    let sib: Element | null = cur.previousElementSibling;
    while (sib) {
      const tag = sib.tagName.toLowerCase();
      // Likely label carriers.
      if (['label', 'span', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'legend', 'strong', 'b'].includes(tag)) {
        // Prefer direct text, or a nested span/p.
        const txt = cleanLabel(sib.textContent || '');
        // Require a meaningful label (at least 4 chars, looks like a question/prompt).
        if (txt.length >= 4 && txt.length <= 300) {
          // Skip pure helper text that is very short.
          return txt;
        }
      }
      sib = sib.previousElementSibling;
    }
    // Also check parent's previous sibling.
    cur = cur.parentElement;
    if (!cur) break;
    // Also check parent has a heading-like child before the field's container.
    const parentPrev = cur.previousElementSibling;
    if (parentPrev) {
      const txt = cleanLabel(parentPrev.textContent || '');
      if (txt.length >= 4 && txt.length <= 300 && txt.length < 500) {
        // Only if it's not a huge block.
        const words = txt.split(/\s+/).length;
        if (words <= 30) return txt;
      }
    }
  }

  // Check field's parent has a preceding text node-like child.
  const parent = field.parentElement;
  if (parent) {
    const children = Array.from(parent.childNodes);
    const fieldIdx = children.indexOf(field);
    if (fieldIdx > 0) {
      for (let i = fieldIdx - 1; i >= 0; i--) {
        const n = children[i] as Element & { textContent: string | null };
        const txt = cleanLabel(n.textContent || '');
        if (txt.length >= 4 && txt.length <= 300) return txt;
      }
    }
  }

  return null;
}

function findGroupHeaderForGroupedField(field: Element, root: ParentNode, name: string): string | null {
  const gType = (field.getAttribute('type') || '').toLowerCase();
  const all = Array.from(
    (root as Document).querySelectorAll?.(`input[type="${gType}"][name="${escapeCss(name)}"]`) ?? [],
  ) as Element[];
  if (all.length <= 1) return null;
  const isQuestionLike = (txt: string) => {
    if (txt.length < 15 || txt.length > 200) return false;
    if (/@/.test(txt)) return false;
    if (!txt.includes('?') && txt.split(/\s+/).length < 4) return false;
    if (txt.length < 30 && !txt.includes('?')) return false;
    return true;
  };
  const first = all[0]!;
  let container: Element | null = first.parentElement;
  while (container && container !== root) {
    const contained = all.filter((el) => container!.contains(el)).length;
    if (contained >= Math.min(all.length, 3)) {
      // 1. Heading is often the *first child inside* the same wrapper
      // (JobStreet: outer _8dh32a6x contains <div><strong>Which …with?</strong></div>
      // followed by the 12 checkbox divs). Check inside first.
      for (const child of Array.from(container.children)) {
        if (child.contains(first)) continue;
        if (child.querySelector?.('input, select, textarea') && child.textContent?.includes('JIRA')) continue;
        // Don't pick a child that itself holds inputs as heading — but allow
        // a heading child that has no inputs (the <strong> question).
        if (child.querySelector?.('input, select, textarea')) continue;
        const txt = cleanLabel(child.textContent || '');
        if (isQuestionLike(txt)) return txt;
        // Also check one level deeper (the <strong> is inside a span inside the div).
        const inner = child.querySelector?.('strong, span, p, h3, h4');
        if (inner) {
          const innerTxt = cleanLabel(inner.textContent || '');
          if (isQuestionLike(innerTxt)) return innerTxt;
        }
      }
      // 2. Otherwise look at previous siblings of the container.
      let sib: Element | null = container.previousElementSibling;
      while (sib) {
        if (sib.querySelector?.('input, select, textarea')) {
          sib = sib.previousElementSibling;
          continue;
        }
        const txt = cleanLabel(sib.textContent || '');
        if (isQuestionLike(txt)) return txt;
        sib = sib.previousElementSibling;
      }
      const parent = container.parentElement;
      if (parent) {
        let psib: Element | null = parent.previousElementSibling;
        while (psib) {
          if (!psib.querySelector?.('input, select, textarea')) {
            const txt = cleanLabel(psib.textContent || '');
            if (isQuestionLike(txt)) return txt;
          }
          psib = psib.previousElementSibling;
        }
        for (const child of Array.from(parent.children)) {
          if (child === container) break;
          if (child.querySelector?.('input, select, textarea')) continue;
          const txt = cleanLabel(child.textContent || '');
          if (isQuestionLike(txt)) return txt;
        }
      }
    }
    container = container.parentElement;
  }
  return null;
}

function contextFor(field: Element): string | undefined {
  const ph = field.getAttribute('placeholder');
  if (ph) {
    const t = cleanLabel(ph);
    if (t) return t;
  }
  const hintId = field.getAttribute('aria-describedby');
  if (hintId) {
    const root = field.getRootNode() as ParentNode & { querySelector?: typeof Document.prototype.querySelector };
    const hint = (root.querySelector as unknown as (sel: string) => Element | null)?.(`#${escapeCss(hintId)}`);
    if (hint) {
      const t = cleanLabel(hint.textContent || '');
      if (t) return t;
    }
  }
  return undefined;
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

  // Filter: only visible and inside a likely form region + scoped to the
  // "Answer employer questions" step (user decision: not hardcoded strings).
  // JobStreet employer questions have id/name containing "_Q_" (e.g.
  // PH_Q_7791_V86_A151031, PH_Q_7288…). Stepper, job header
  // ("Applying for…"), profile card, and Choose-documents radios have ids
  // like _r_2p / _r_7d_ with no _Q_ — filtering by that is site-generic.
  // Exception: the single "Write a cover letter" textarea in Choose
  // documents (draftable per posting) is kept even without _Q_.
  const fields = rawFields.filter((el) => {
    if (!isVisible(el)) return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'password' || type === 'file') {
      if (type === 'file') return false;
    }
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (['q', 'search', 'keyword'].includes(name) && !(el.closest('form'))) return false;

    // Site-generic step scoping: when the page has real employer
    // questions (PH_Q_ / _Q_ — e.g. PH_Q_7791, PH_Q_7288), keep only those
    // plus the single cover-letter draftable. This automatically excludes
    // stepper, job header (Applying for…), profile card, etc. without
    // hardcoding any company name. Test fixtures have no _Q_ and no
    // apply stepper, so we fall back to keeping everything there.
    const id = el.getAttribute('id') || '';
    const rawName = el.getAttribute('name') || '';
    const hasEmployerQOnPage = rawFields.some(
      (f) => /_Q_/.test(f.getAttribute('id') || '') || /_Q_/.test(f.getAttribute('name') || ''),
    );
    const isCoverLetterDraftable =
      el.tagName.toLowerCase() === 'textarea' &&
      (el.getAttribute('aria-label') === 'Write a cover letter' ||
        (el.getAttribute('placeholder') || '').includes('Introduce yourself'));
    if (hasEmployerQOnPage) {
      const isEmployerQ = /_Q_/.test(id) || /_Q_/.test(rawName) || /question-.*_Q_/.test(id);
      if (!isEmployerQ && !isCoverLetterDraftable) return false;
    } else {
      // No employer Q on page — could be Choose-documents step (has stepper)
      // or a test fixture. Only filter if we're on a real Apply flow
      // (stepper text present) — then keep only the cover-letter draftable.
      const bodyText = (root as Document).body?.textContent || (root as Document).textContent || '';
      const isApplyFlow = bodyText.includes('Answer employer questions') && bodyText.includes('Choose documents');
      if (isApplyFlow && !isCoverLetterDraftable) return false;
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
