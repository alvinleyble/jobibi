/**
 * S11: Auto-Fill behind the beta flag
 *
 * Provides shared DOM fill logic, field type validation, D16 confidence gating,
 * and D17 sensitive field exclusion.
 */

export const AUTOFILL_CONFIDENCE_THRESHOLD = 0.75;

export const SUPPORTED_AUTOFILL_INPUT_TYPES = [
  'text',
  'email',
  'tel',
  'number',
  'url',
] as const;

export type SupportedAutofillInputType = (typeof SUPPORTED_AUTOFILL_INPUT_TYPES)[number];

export interface InsertFieldPayload {
  questionId?: string;
  selector?: string;
  fieldId?: string;
  text: string;
  confidence?: number;
  isSensitive?: boolean;
}

export interface InsertFieldResult {
  ok: boolean;
  error?: string;
}

/**
 * Checks if a given HTMLInputElement type is supported for auto-fill.
 */
export function isSupportedInputType(type: string): boolean {
  const normalized = type.toLowerCase().trim();
  if (!normalized) return true;
  return (SUPPORTED_AUTOFILL_INPUT_TYPES as readonly string[]).includes(normalized);
}

/**
 * Validates whether an element is an editable text field that Jobibi can auto-fill.
 * Excludes multi-choice fields (select, radio, checkbox, etc.) and unsupported input types.
 */
export function validateFillableElement(
  el: Element,
): { ok: true; target: HTMLInputElement | HTMLTextAreaElement } | { ok: false; error: string } {
  const win = el.ownerDocument?.defaultView ?? globalThis;
  const isTextArea = win.HTMLTextAreaElement ? el instanceof win.HTMLTextAreaElement : el.tagName.toLowerCase() === 'textarea';
  const isSelect = win.HTMLSelectElement ? el instanceof win.HTMLSelectElement : el.tagName.toLowerCase() === 'select';
  const isInput = win.HTMLInputElement ? el instanceof win.HTMLInputElement : el.tagName.toLowerCase() === 'input';

  if (isTextArea) {
    return { ok: true, target: el as HTMLTextAreaElement };
  }

  if (isSelect) {
    return { ok: false, error: 'Multi-choice fields (select) require manual selection.' };
  }

  if (isInput) {
    const inputEl = el as HTMLInputElement;
    const inputType = (inputEl.type || 'text').toLowerCase();
    if (inputType === 'checkbox' || inputType === 'radio') {
      return { ok: false, error: 'Multi-choice fields (radio/checkbox) require manual selection.' };
    }
    if (!isSupportedInputType(inputType)) {
      return {
        ok: false,
        error: `Unsupported input type "${inputType}". Only text, email, tel, number, and url are supported.`,
      };
    }
    return { ok: true, target: inputEl };
  }

  return { ok: false, error: 'Target element is not a supported text input or textarea.' };
}

/**
 * Executes native property value setting and dispatches synthetic input, change, and blur events.
 * Uses Object.getOwnPropertyDescriptor on the element prototype to trigger framework (React/Vue/Angular) state updates.
 */
export function fillElementValue(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  // Focus the element first
  if (typeof el.focus === 'function') {
    try {
      el.focus();
    } catch {}
  }

  const win = el.ownerDocument?.defaultView ?? globalThis;
  const proto = el instanceof (win.HTMLTextAreaElement ?? HTMLTextAreaElement)
    ? (win.HTMLTextAreaElement ?? HTMLTextAreaElement).prototype
    : (win.HTMLInputElement ?? HTMLInputElement).prototype;

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, text);
  } else {
    el.value = text;
  }

  // Dispatch synthetic events with bubbles: true and composed: true
  const EventConstructor = win.Event ?? Event;
  el.dispatchEvent(new EventConstructor('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new EventConstructor('change', { bubbles: true }));
  el.dispatchEvent(new EventConstructor('blur', { bubbles: true }));
}

/**
 * High-level autofill handler with D16 confidence gating, D17 sensitive exclusions,
 * and element type validation.
 */
export function executeAutofill(options: {
  el: Element | null;
  text: string;
  confidence?: number;
  isSensitive?: boolean;
}): InsertFieldResult {
  if (options.isSensitive) {
    return { ok: false, error: 'Auto-fill disabled: Sensitive fields cannot be auto-filled.' };
  }

  if (options.confidence != null && options.confidence < AUTOFILL_CONFIDENCE_THRESHOLD) {
    return {
      ok: false,
      error: `Auto-fill disabled: Low confidence mapping (< ${AUTOFILL_CONFIDENCE_THRESHOLD}). Please copy and paste manually.`,
    };
  }

  if (!options.el) {
    return { ok: false, error: 'Target field element not found in DOM.' };
  }

  const validation = validateFillableElement(options.el);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  try {
    fillElementValue(validation.target, options.text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
