import type { ExtractedQuestion, FieldType, JobContext, LabelSource } from './types.ts';

// ---------------------------------------------------------------------------
// Confidence table (D16) — shared across all adapters.
// Higher = more certain the label belongs to the field. Used both at
// suggestion time and re-derived at capture.
// ---------------------------------------------------------------------------
export const CONFIDENCE_BY_SOURCE: Record<LabelSource, number> = {
  'label-for': 1.0,
  'label-wrap': 0.95,
  'aria-labelledby': 0.85,
  'aria-label': 0.8,
  placeholder: 0.6,
  proximity: 0.5,
  none: 0,
};

export const FIELD_SELECTOR =
  'textarea, input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input:not([type]), select, input[type="radio"], input[type="checkbox"]';

// ---------------------------------------------------------------------------
// Helpers — pure, DOM-agnostic where possible, mirrors jobstreet.ts exactly
// ---------------------------------------------------------------------------

export function fieldTypeFor(el: Element): FieldType {
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

export function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = (el.getAttribute('style') || '').toLowerCase();
  if (/display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style)) return false;
  return true;
}

export function escapeCss(s: string): string {
  const c = (globalThis as unknown as { CSS?: { escape: (v: string) => string } }).CSS;
  if (c?.escape) return c.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export function cleanLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[\*:：:]\s*$/, '')
    .replace(/\s*\(required\)\s*$/i, '')
    .trim();
}

export function fieldSelector(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return `#${escapeCss(id)}`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
  const parent = el.parentElement;
  if (!parent) return el.tagName.toLowerCase();
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  const idx = sameTag.indexOf(el);
  if (sameTag.length > 1 && idx >= 0) {
    return `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
  }
  return el.tagName.toLowerCase();
}

export function fieldId(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return id;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}:${name}`;
  return fieldSelector(el);
}

// ---------------------------------------------------------------------------
// Label resolution (ordered by confidence) — generalized from jobstreet.ts
// ---------------------------------------------------------------------------

export function resolveLabel(
  field: Element,
  root: ParentNode,
): { label: string; source: LabelSource; context?: string } {
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

  const id = field.getAttribute('id');
  if (id) {
    const lbl = root.querySelector(`label[for="${escapeCss(id)}"]`);
    if (lbl) {
      const t = cleanLabel(lbl.textContent || '');
      if (t) return { label: t, source: 'label-for' };
    }
  }

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
    const clone = wrap.cloneNode(true) as HTMLElement;
    const inner = clone.querySelector(field.tagName.toLowerCase());
    if (inner) inner.remove();
    const t = cleanLabel(clone.textContent || '');
    if (t) return { label: t, source: 'label-wrap' };
  }

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

  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) {
    const t = cleanLabel(ariaLabel);
    if (t) return { label: t, source: 'aria-label' };
  }

  const placeholder = field.getAttribute('placeholder');
  if (placeholder) {
    const t = cleanLabel(placeholder);
    if (t && (t.includes('?') || t.length > 8)) {
      return { label: t, source: 'placeholder', context: t };
    }
  }

  const prox = findProximityLabel(field);
  if (prox) return { label: prox, source: 'proximity' };

  return { label: '', source: 'none' };
}

export function findProximityLabel(field: Element): string | null {
  let cur: Element | null = field;
  for (let depth = 0; depth < 3 && cur; depth++) {
    let sib: Element | null = cur.previousElementSibling;
    while (sib) {
      const tag = sib.tagName.toLowerCase();
      if (['label', 'span', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'legend', 'strong', 'b'].includes(tag)) {
        const txt = cleanLabel(sib.textContent || '');
        if (txt.length >= 4 && txt.length <= 300) {
          return txt;
        }
      }
      sib = sib.previousElementSibling;
    }
    cur = cur.parentElement;
    if (!cur) break;
    const parentPrev = cur.previousElementSibling;
    if (parentPrev) {
      const txt = cleanLabel(parentPrev.textContent || '');
      if (txt.length >= 4 && txt.length <= 300 && txt.length < 500) {
        const words = txt.split(/\s+/).length;
        if (words <= 30) return txt;
      }
    }
  }

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

export function findGroupHeaderForGroupedField(field: Element, root: ParentNode, name: string): string | null {
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
      for (const child of Array.from(container.children)) {
        if (child.contains(first)) continue;
        if (child.querySelector?.('input, select, textarea') && child.textContent?.includes('JIRA')) continue;
        if (child.querySelector?.('input, select, textarea')) continue;
        const txt = cleanLabel(child.textContent || '');
        if (isQuestionLike(txt)) return txt;
        const inner = child.querySelector?.('strong, span, p, h3, h4');
        if (inner) {
          const innerTxt = cleanLabel(inner.textContent || '');
          if (isQuestionLike(innerTxt)) return innerTxt;
        }
      }
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

export function contextFor(field: Element): string | undefined {
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
