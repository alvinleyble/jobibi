import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  AUTOFILL_CONFIDENCE_THRESHOLD,
  isSupportedInputType,
  validateFillableElement,
  fillElementValue,
  executeAutofill,
} from './autofill.ts';

function dom(html: string) {
  const jsdom = new JSDOM(html);
  return jsdom.window.document;
}

describe('autofill helpers', () => {
  describe('isSupportedInputType', () => {
    it('supports text, email, tel, number, url, and empty/default', () => {
      expect(isSupportedInputType('text')).toBe(true);
      expect(isSupportedInputType('email')).toBe(true);
      expect(isSupportedInputType('tel')).toBe(true);
      expect(isSupportedInputType('number')).toBe(true);
      expect(isSupportedInputType('url')).toBe(true);
      expect(isSupportedInputType('')).toBe(true);
      expect(isSupportedInputType('TEXT')).toBe(true);
    });

    it('rejects unsupported input types', () => {
      expect(isSupportedInputType('checkbox')).toBe(false);
      expect(isSupportedInputType('radio')).toBe(false);
      expect(isSupportedInputType('file')).toBe(false);
      expect(isSupportedInputType('submit')).toBe(false);
      expect(isSupportedInputType('password')).toBe(false);
      expect(isSupportedInputType('hidden')).toBe(false);
    });
  });

  describe('validateFillableElement', () => {
    it('accepts textarea elements', () => {
      const doc = dom('<textarea id="t1"></textarea>');
      const el = doc.getElementById('t1')!;
      const res = validateFillableElement(el);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.target).toBe(el);
      }
    });

    it('accepts supported input elements (text, email, tel, number, url)', () => {
      const doc = dom(`
        <input id="i-text" type="text" />
        <input id="i-email" type="email" />
        <input id="i-tel" type="tel" />
        <input id="i-num" type="number" />
        <input id="i-url" type="url" />
        <input id="i-default" />
      `);
      for (const id of ['i-text', 'i-email', 'i-tel', 'i-num', 'i-url', 'i-default']) {
        const el = doc.getElementById(id)!;
        const res = validateFillableElement(el);
        expect(res.ok).toBe(true);
      }
    });

    it('rejects select and multi-choice radio/checkbox inputs', () => {
      const doc = dom(`
        <select id="s1"><option>A</option></select>
        <input id="r1" type="radio" />
        <input id="c1" type="checkbox" />
      `);
      const s1 = validateFillableElement(doc.getElementById('s1')!);
      expect(s1.ok).toBe(false);
      if (!s1.ok) {
        expect(s1.error).toContain('Multi-choice');
      }

      const r1 = validateFillableElement(doc.getElementById('r1')!);
      expect(r1.ok).toBe(false);
      if (!r1.ok) {
        expect(r1.error).toContain('Multi-choice');
      }

      const c1 = validateFillableElement(doc.getElementById('c1')!);
      expect(c1.ok).toBe(false);
      if (!c1.ok) {
        expect(c1.error).toContain('Multi-choice');
      }
    });

    it('rejects non-input elements and unsupported input types', () => {
      const doc = dom(`
        <div id="d1">Content</div>
        <input id="f1" type="file" />
      `);
      const d1 = validateFillableElement(doc.getElementById('d1')!);
      expect(d1.ok).toBe(false);
      if (!d1.ok) {
        expect(d1.error).toContain('not a supported text input');
      }

      const f1 = validateFillableElement(doc.getElementById('f1')!);
      expect(f1.ok).toBe(false);
      if (!f1.ok) {
        expect(f1.error).toContain('Unsupported input type');
      }
    });
  });

  describe('fillElementValue', () => {
    it('sets value and fires input, change, and blur events on textarea', () => {
      const doc = dom('<textarea id="t1"></textarea>');
      const el = doc.getElementById('t1') as HTMLTextAreaElement;

      const eventsFired: string[] = [];
      el.addEventListener('input', (e) => {
        expect(e.bubbles).toBe(true);
        expect(e.composed).toBe(true);
        eventsFired.push('input');
      });
      el.addEventListener('change', (e) => {
        expect(e.bubbles).toBe(true);
        eventsFired.push('change');
      });
      el.addEventListener('blur', (e) => {
        expect(e.bubbles).toBe(true);
        eventsFired.push('blur');
      });

      fillElementValue(el, 'Hello world');
      expect(el.value).toBe('Hello world');
      expect(eventsFired).toEqual(['input', 'change', 'blur']);
    });

    it('sets value and fires input, change, and blur events on text input', () => {
      const doc = dom('<input id="i1" type="text" />');
      const el = doc.getElementById('i1') as HTMLInputElement;

      const eventsFired: string[] = [];
      el.addEventListener('input', () => eventsFired.push('input'));
      el.addEventListener('change', () => eventsFired.push('change'));
      el.addEventListener('blur', () => eventsFired.push('blur'));

      fillElementValue(el, 'My typed answer');
      expect(el.value).toBe('My typed answer');
      expect(eventsFired).toEqual(['input', 'change', 'blur']);
    });

    it('invokes native property descriptor setter on prototype', () => {
      const doc = dom('<textarea id="t1"></textarea>');
      const el = doc.getElementById('t1') as HTMLTextAreaElement;
      const win = doc.defaultView!;

      const setterSpy = vi.fn();
      const origDescriptor = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value');

      Object.defineProperty(win.HTMLTextAreaElement.prototype, 'value', {
        set(val: string) {
          setterSpy(val);
          origDescriptor?.set?.call(this, val);
        },
        get() {
          return origDescriptor?.get?.call(this);
        },
        configurable: true,
      });

      try {
        fillElementValue(el, 'Testing setter hook');
        expect(setterSpy).toHaveBeenCalledWith('Testing setter hook');
        expect(el.value).toBe('Testing setter hook');
      } finally {
        if (origDescriptor) {
          Object.defineProperty(win.HTMLTextAreaElement.prototype, 'value', origDescriptor);
        }
      }
    });
  });

  describe('executeAutofill', () => {
    it('rejects sensitive/refused fields (salary/notice legacy isSensitive guard)', () => {
      const doc = dom('<textarea id="t1"></textarea>');
      const el = doc.getElementById('t1')!;
      const res = executeAutofill({
        el,
        text: '₱120,000 / month',
        confidence: 1.0,
        isSensitive: true,
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Sensitive fields cannot be auto-filled');
    });

    it('gates low confidence mapping < 0.75 (D16 safety gate)', () => {
      const doc = dom('<textarea id="t1"></textarea>');
      const el = doc.getElementById('t1')!;

      const resLow = executeAutofill({
        el,
        text: 'Some answer',
        confidence: 0.5,
      });
      expect(resLow.ok).toBe(false);
      expect(resLow.error).toContain('Low confidence mapping (< 0.75)');

      const resEdge = executeAutofill({
        el,
        text: 'Some answer',
        confidence: 0.74,
      });
      expect(resEdge.ok).toBe(false);
      expect(resEdge.error).toContain('Low confidence mapping (< 0.75)');
    });

    it('allows confidence >= 0.75 and fills element', () => {
      const doc = dom('<textarea id="t1"></textarea>');
      const el = doc.getElementById('t1') as HTMLTextAreaElement;

      const resMedium = executeAutofill({
        el,
        text: 'Medium confidence fill',
        confidence: AUTOFILL_CONFIDENCE_THRESHOLD, // 0.75
      });
      expect(resMedium.ok).toBe(true);
      expect(el.value).toBe('Medium confidence fill');

      const resHigh = executeAutofill({
        el,
        text: 'High confidence fill',
        confidence: 0.95,
      });
      expect(resHigh.ok).toBe(true);
      expect(el.value).toBe('High confidence fill');
    });

    it('returns error when target element is null/missing', () => {
      const res = executeAutofill({
        el: null,
        text: 'No element',
        confidence: 1.0,
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('not found in DOM');
    });

    it('returns error when target element is multi-choice', () => {
      const doc = dom('<select id="s1"><option>1</option></select>');
      const el = doc.getElementById('s1')!;
      const res = executeAutofill({
        el,
        text: 'Option 1',
        confidence: 1.0,
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Multi-choice');
    });
  });
});
