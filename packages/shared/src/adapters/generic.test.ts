import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractGenericQuestions } from './generic.ts';

function dom(html: string) {
  const jsdom = new JSDOM(html);
  return jsdom.window.document;
}

const _css = (globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
if (!_css?.escape) {
  // @ts-expect-error global polyfill for test
  globalThis.CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  };
}

describe('extractGenericQuestions', () => {
  it('extracts textarea with label-for (confidence 1.0)', () => {
    const doc = dom(`
      <form>
        <label for="q1">Why do you want this role?</label>
        <textarea id="q1" name="motivation"></textarea>
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toBe('Why do you want this role?');
    expect(res.questions[0].labelSource).toBe('label-for');
    expect(res.questions[0].confidence).toBe(1.0);
    expect(res.adapter).toBe('generic');
  });

  it('extracts wrapping label (0.95)', () => {
    const doc = dom(`
      <form>
        <label>Tell us about yourself <textarea name="about"></textarea></label>
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('label-wrap');
  });

  it('extracts aria-label and aria-labelledby', () => {
    const doc = dom(`
      <form>
        <textarea aria-label="Expected salary?" name="salary"></textarea>
        <span id="lbl">Challenge you overcame</span>
        <textarea aria-labelledby="lbl" name="challenge"></textarea>
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(2);
  });

  it('uses proximity fallback (0.5) for generic structure', () => {
    const doc = dom(`
      <form>
        <div>
          <span>Why should we hire you?</span>
          <textarea name="hire"></textarea>
        </div>
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('proximity');
    expect(res.questions[0].confidence).toBe(0.5);
  });

  it('skips orphan fields with no label', () => {
    const doc = dom(`
      <form>
        <textarea name="orphan"></textarea>
        <input type="hidden" name="csrf" value="123" />
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('still detects unsupported site best-effort (generic value)', () => {
    // Simulate a custom ATS with unusual markup but still label-for
    const doc = dom(`
      <html><body>
        <h1>Product Manager</h1>
        <form>
          <div class="custom-field">
            <label for="custom-q">Describe your product philosophy</label>
            <textarea id="custom-q" name="philosophy"></textarea>
          </div>
          <div class="custom-field">
            <span>What is your notice period? *</span>
            <input name="notice" type="text" />
          </div>
        </form>
      </body></html>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions.length).toBe(2);
    expect(res.questions.map((q) => q.label)).toContain('Describe your product philosophy');
    expect(res.questions.map((q) => q.label)).toContain('What is your notice period?');
  });

  it('each question carries selector, confidence, and fieldType', () => {
    const doc = dom(`
      <form>
        <label for="a">Why this company?</label>
        <textarea id="a" name="why"></textarea>
      </form>
    `);
    const res = extractGenericQuestions(doc);
    const q = res.questions[0];
    expect(q.field.selector.length).toBeGreaterThan(0);
    expect(typeof q.confidence).toBe('number');
    expect(q.confidence).toBeGreaterThan(0);
    expect(q.fieldType).toBe('textarea');
  });

  it('placeholder question-like becomes label', () => {
    const doc = dom(`
      <form>
        <textarea name="q" placeholder="Why do you want to join us?"></textarea>
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('placeholder');
  });

  it('handles generic fixture with selects and text', () => {
    const doc = dom(`
      <form>
        <label for="exp">Years of experience</label>
        <select id="exp" name="exp"><option>1</option></select>
        <label for="city">Preferred location</label>
        <input id="city" name="city" type="text" />
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(2);
    expect(res.questions.map((q) => q.fieldType)).toEqual(['select', 'text']);
  });

  it('de-duplicates radio groups', () => {
    const doc = dom(`
      <form>
        <fieldset>
          <legend>Willing to relocate?</legend>
          <label><input type="radio" name="relocate" value="yes" /> Yes</label>
          <label><input type="radio" name="relocate" value="no" /> No</label>
        </fieldset>
      </form>
    `);
    const res = extractGenericQuestions(doc);
    expect(res.questions).toHaveLength(1);
  });

  it('uses same CONFIDENCE_BY_SOURCE values as JobStreet (generalized)', () => {
    // Verify confidence table parity — labels must be >=4 chars to pass guard
    const docLabelFor = dom(`<form><label for="a">Why this role?</label><textarea id="a"></textarea></form>`);
    const docProx = dom(`<form><div><span>Why this role?</span><textarea name="x"></textarea></div></form>`);
    const r1 = extractGenericQuestions(docLabelFor);
    const r2 = extractGenericQuestions(docProx);
    expect(r1.questions[0].confidence).toBe(1.0);
    expect(r2.questions[0].confidence).toBe(0.5);
  });
});
