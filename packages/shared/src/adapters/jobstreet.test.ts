import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractJobStreetQuestions } from './jobstreet.ts';

function dom(html: string) {
  const jsdom = new JSDOM(html);
  return jsdom.window.document;
}

// Polyfill CSS.escape for JSDOM/node.
const _css = (globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
if (!_css?.escape) {
  // @ts-expect-error global polyfill for test
  globalThis.CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  };
}

describe('extractJobStreetQuestions', () => {
  it('extracts textarea with label-for (confidence 1.0)', () => {
    const doc = dom(`
      <form>
        <label for="q1">Why do you want this role?</label>
        <textarea id="q1" name="motivation"></textarea>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toBe('Why do you want this role?');
    expect(res.questions[0].labelSource).toBe('label-for');
    expect(res.questions[0].confidence).toBe(1.0);
    expect(res.questions[0].fieldType).toBe('textarea');
  });

  it('extracts wrapping label (confidence 0.95)', () => {
    const doc = dom(`
      <form>
        <label>Tell us about yourself <textarea name="about"></textarea></label>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('label-wrap');
    expect(res.questions[0].confidence).toBe(0.95);
  });

  it('extracts aria-label (0.8)', () => {
    const doc = dom(`
      <form>
        <textarea aria-label="What is your expected salary?" name="salary"></textarea>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('aria-label');
    expect(res.questions[0].confidence).toBe(0.8);
  });

  it('extracts aria-labelledby (0.85)', () => {
    const doc = dom(`
      <form>
        <span id="lbl">Describe a challenge you overcame</span>
        <textarea aria-labelledby="lbl" name="challenge"></textarea>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('aria-labelledby');
    expect(res.questions[0].confidence).toBe(0.85);
    expect(res.questions[0].label).toBe('Describe a challenge you overcame');
  });

  it('uses proximity fallback (0.5) for JobStreet-like div/span structure', () => {
    const doc = dom(`
      <form>
        <div>
          <span>Why should we hire you?</span>
          <textarea name="hire"></textarea>
        </div>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('proximity');
    expect(res.questions[0].confidence).toBe(0.5);
  });

  it('skips fields with no resolvable label (no false questions)', () => {
    const doc = dom(`
      <form>
        <textarea name="orphan"></textarea>
        <input type="hidden" name="csrf" value="123" />
        <input type="text" name="q" value="" />
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('de-duplicates radio groups to one question', () => {
    const doc = dom(`
      <form>
        <fieldset>
          <legend>Are you willing to relocate?</legend>
          <label><input type="radio" name="relocate" value="yes" /> Yes</label>
          <label><input type="radio" name="relocate" value="no" /> No</label>
        </fieldset>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    // Should keep only the first radio, with proximity picking up legend.
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].fieldType).toBe('radio');
  });

  it('extracts select and text inputs', () => {
    const doc = dom(`
      <form>
        <label for="exp">Years of experience</label>
        <select id="exp" name="exp"><option>1</option></select>
        <label for="city">Preferred location</label>
        <input id="city" name="city" type="text" />
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(2);
    expect(res.questions.map((q) => q.fieldType)).toEqual(['select', 'text']);
  });

  it('handles JobStreet fixture: multiple question types', () => {
    const doc = dom(`
      <html><body>
        <h1 data-automation="jobTitle">QA Engineer</h1>
        <a data-automation="jobCompany">Acme Corp</a>
        <form>
          <div class="form-group">
            <label for="q-cover">Cover letter</label>
            <textarea id="q-cover" name="coverLetter" placeholder="Tell us why you are a good fit"></textarea>
          </div>
          <div class="form-group">
            <span>What is your expected monthly salary? *</span>
            <input name="expectedSalary" type="text" placeholder="e.g. 50000" />
          </div>
          <div class="form-group">
            <span>How many years of QA experience do you have?</span>
            <select name="qaYears"><option>0-1</option><option>2-3</option></select>
          </div>
          <div class="form-group">
            <span>Are you willing to work on-site?</span>
            <label><input type="radio" name="onsite" value="yes" /> Yes</label>
            <label><input type="radio" name="onsite" value="no" /> No</label>
          </div>
        </form>
      </body></html>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions.length).toBeGreaterThanOrEqual(3);
    expect(res.jobContext.roleTitle).toBe('QA Engineer');
    expect(res.jobContext.company).toBe('Acme Corp');
    // Cover letter should be label-for with high confidence.
    const cover = res.questions.find((q) => q.label === 'Cover letter');
    expect(cover).toBeDefined();
    expect(cover!.confidence).toBe(1.0);
  });

  it('strips trailing * and : from labels', () => {
    const doc = dom(`
      <form>
        <label for="x">Expected salary *</label>
        <input id="x" name="salary" type="text" />
        <label for="y">Notice period:</label>
        <input id="y" name="notice" type="text" />
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions[0].label).toBe('Expected salary');
    expect(res.questions[1].label).toBe('Notice period');
  });

  it('each question carries selector and confidence', () => {
    const doc = dom(`
      <form>
        <label for="a">Why this company?</label>
        <textarea id="a" name="why"></textarea>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    const q = res.questions[0];
    expect(q.field.selector).toBeDefined();
    expect(q.field.selector.length).toBeGreaterThan(0);
    expect(typeof q.confidence).toBe('number');
    expect(q.confidence).toBeGreaterThan(0);
    expect(q.confidence).toBeLessThanOrEqual(1);
  });

  it('placeholder-only becomes label when it looks like a question', () => {
    const doc = dom(`
      <form>
        <textarea name="q" placeholder="Why do you want to join us?"></textarea>
      </form>
    `);
    const res = extractJobStreetQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('placeholder');
  });
});
