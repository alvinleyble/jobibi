import { cleanLabel, escapeCss } from '../adapters/helpers.ts';

/**
 * Resolve the human-readable label text for a form element's current value.
 * - <select>: selected <option> textContent (human) rather than .value (opaque token).
 * - radio/checkbox: associated <label for> then wrapping <label> text, falling back to el.value.
 * - unchecked checkboxes/radios return ''.
 * - other inputs/textarea return .value directly.
 */
export function readHumanValue(el: Element, root: ParentNode): string {
  const tagName = el.tagName.toLowerCase();
  if (el instanceof HTMLSelectElement || tagName === 'select') {
    const sel = el as HTMLSelectElement;
    // multi-select: join all selected option texts
    if (sel.multiple) {
      const texts = Array.from(sel.selectedOptions || [])
        .map((o) => (o.textContent ?? '').trim())
        .filter(Boolean);
      if (texts.length) return texts.join(', ');
      // fallback to raw value if no text (should be rare)
      return sel.value ?? '';
    }
    // single select
    if (sel.selectedOptions && sel.selectedOptions.length) {
      const opt = sel.selectedOptions[0]!;
      const txt = (opt.textContent ?? '').trim();
      if (txt) return txt;
    }
    // fallback: no selected option or empty text
    return sel.value ?? '';
  }

  if (el instanceof HTMLInputElement || tagName === 'input') {
    const inputEl = el as HTMLInputElement;
    const t = (inputEl.type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio') {
      if (t === 'radio') {
        const name = inputEl.getAttribute('name');
        if (name) {
          try {
            const selector = `input[type="radio"][name="${escapeCss(name)}"]:checked`;
            const checked = (root as unknown as Document).querySelector?.(selector) as HTMLInputElement | null;
            if (!checked) return '';
            const labelText = resolveInputLabelText(checked, root);
            if (labelText) return labelText;
            return checked.value ?? '';
          } catch {
            // fall through to single-element handling
          }
        }
      }
      if (!inputEl.checked) return '';
      const labelText = resolveInputLabelText(inputEl, root);
      if (labelText) return labelText;
      return inputEl.value ?? '';
    }
    return inputEl.value ?? '';
  }

  if (el instanceof HTMLTextAreaElement || tagName === 'textarea') {
    return (el as HTMLTextAreaElement).value ?? '';
  }

  // Fallback for unknown elements
  return (el as HTMLElement).innerText ?? (el as HTMLInputElement).value ?? '';
}

function resolveInputLabelText(input: HTMLInputElement, root: ParentNode): string | null {
  const id = input.getAttribute('id');
  if (id) {
    try {
      const lbl = (root as unknown as Document).querySelector?.(`label[for="${escapeCss(id)}"]`);
      if (lbl) {
        const t = cleanLabel(lbl.textContent || '');
        if (t) return t;
      }
    } catch {
      // ignore selector errors
    }
  }
  const wrap = input.closest('label');
  if (wrap) {
    const clone = wrap.cloneNode(true) as HTMLElement;
    // remove all input elements inside clone so their value doesn't pollute label text
    const innerInputs = clone.querySelectorAll('input');
    for (const inner of Array.from(innerInputs)) inner.remove();
    const t = cleanLabel(clone.textContent || '');
    if (t) return t;
  }
  return null;
}

/**
 * Resolve every checked checkbox in a group (identified by firstEl's name) and join label texts with ", ".
 * Returns '' if none checked.
 */
export function readHumanCheckboxGroupValue(firstEl: Element, root: ParentNode): string {
  const tagName = firstEl.tagName.toLowerCase();
  const inputEl = firstEl as HTMLInputElement;
  const isCheckbox = (firstEl instanceof HTMLInputElement || tagName === 'input') && (inputEl.type || '').toLowerCase() === 'checkbox';
  if (!isCheckbox) {
    return readHumanValue(firstEl, root);
  }
  const name = firstEl.getAttribute('name');
  if (!name) {
    return readHumanValue(firstEl, root);
  }
  let checkedBoxes: HTMLInputElement[] = [];
  try {
    const selector = `input[type="checkbox"][name="${escapeCss(name)}"]:checked`;
    const list = (root as unknown as Document).querySelectorAll?.(selector);
    if (list) checkedBoxes = Array.from(list) as HTMLInputElement[];
  } catch {
    // fallback: manual filter
    checkedBoxes = [];
  }
  if (!checkedBoxes.length) return '';
  const texts = checkedBoxes
    .map((cb) => {
      const labelText = resolveInputLabelText(cb, root);
      if (labelText) return labelText;
      return cb.value ?? '';
    })
    .filter(Boolean);
  return texts.join(', ');
}
