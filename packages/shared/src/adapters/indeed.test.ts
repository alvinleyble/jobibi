import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractIndeedQuestions } from './indeed.ts';

function dom(html: string, url?: string) {
  const jsdom = new JSDOM(html, url ? { url } : undefined);
  return jsdom.window.document;
}

const QUESTIONS_MODULE_URL = 'https://smartapply.indeed.com/beta/indeedapply/form/questions-module/questions/1';
const QUESTIONS_MODULE_URL_PAGE_2 = 'https://smartapply.indeed.com/beta/indeedapply/form/questions-module/questions/2';
const HOMEPAGE_URL = 'https://www.indeed.com/jobs?q=engineer';
const RESUME_SELECTION_URL = 'https://smartapply.indeed.com/beta/indeedapply/form/resume-selection-module';

const _css = (globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
if (!_css?.escape) {
  // @ts-expect-error global polyfill for test
  globalThis.CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  };
}

describe('extractIndeedQuestions', () => {
  it('extracts textarea with label-for (confidence 1.0)', () => {
    const doc = dom(`
      <form data-testid="application-form">
        <label for="q1">Why do you want this role?</label>
        <textarea id="q1" name="motivation"></textarea>
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toBe('Why do you want this role?');
    expect(res.questions[0].labelSource).toBe('label-for');
    expect(res.questions[0].confidence).toBe(1.0);
    expect(res.adapter).toBe('indeed');
  });

  it('extracts wrapping label (confidence 0.95)', () => {
    const doc = dom(`
      <form>
        <label>Tell us about yourself <textarea name="about"></textarea></label>
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('label-wrap');
    expect(res.questions[0].confidence).toBe(0.95);
  });

  it('extracts aria-labelledby (0.85) and aria-label (0.8)', () => {
    const doc = dom(`
      <form>
        <span id="lbl">Describe a challenge you overcame</span>
        <textarea aria-labelledby="lbl" name="challenge"></textarea>
        <textarea aria-label="What is your expected salary?" name="salary"></textarea>
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(2);
    const challenge = res.questions.find((q) => q.label === 'Describe a challenge you overcame');
    expect(challenge?.labelSource).toBe('aria-labelledby');
    const salary = res.questions.find((q) => q.label === 'What is your expected salary?');
    expect(salary?.labelSource).toBe('aria-label');
  });

  it('uses proximity fallback (0.5)', () => {
    const doc = dom(`
      <form>
        <div>
          <span>Why should we hire you?</span>
          <textarea name="hire"></textarea>
        </div>
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('proximity');
    expect(res.questions[0].confidence).toBe(0.5);
  });

  it('skips fields with no resolvable label', () => {
    const doc = dom(`
      <form>
        <textarea name="orphan"></textarea>
        <input type="hidden" name="csrf" value="123" />
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('de-duplicates radio groups', () => {
    const doc = dom(`
      <form>
        <fieldset>
          <legend>Are you willing to relocate?</legend>
          <label><input type="radio" name="relocate" value="yes" /> Yes</label>
          <label><input type="radio" name="relocate" value="no" /> No</label>
        </fieldset>
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].fieldType).toBe('radio');
  });

  it('handles Indeed fixture: multiple question types with job context', () => {
    const doc = dom(`
      <html><body>
        <h1 data-testid="jobTitle">QA Engineer</h1>
        <div data-testid="companyName">Acme Corp</div>
        <form data-testid="application-form">
          <div class="ia-Questions">
            <label for="cover">Cover letter</label>
            <textarea id="cover" name="coverLetter"></textarea>
          </div>
          <div>
            <span>What is your expected monthly salary? *</span>
            <input name="expectedSalary" type="text" />
          </div>
          <div>
            <span>How many years of QA experience do you have?</span>
            <select name="qaYears"><option>0-1</option></select>
          </div>
        </form>
      </body></html>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions.length).toBeGreaterThanOrEqual(3);
    expect(res.jobContext.roleTitle).toBe('QA Engineer');
    expect(res.jobContext.company).toBe('Acme Corp');
  });

  it('each question carries selector and confidence', () => {
    const doc = dom(`
      <form>
        <label for="a">Why this company?</label>
        <textarea id="a" name="why"></textarea>
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    const q = res.questions[0];
    expect(q.field.selector).toBeDefined();
    expect(typeof q.confidence).toBe('number');
    expect(q.confidence).toBeGreaterThan(0);
  });

  it('placeholder-only becomes label when question-like', () => {
    const doc = dom(`
      <form>
        <textarea name="q" placeholder="Why do you want to join us?"></textarea>
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('placeholder');
  });

  it('strips trailing markers', () => {
    const doc = dom(`
      <form>
        <label for="x">Notice period:</label>
        <input id="x" name="notice" type="text" />
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions[0].label).toBe('Notice period');
  });

  it('extracts select and text inputs', () => {
    const doc = dom(`
      <form>
        <label for="exp">Years of experience</label>
        <select id="exp" name="exp"><option>1</option></select>
        <label for="city">Location</label>
        <input id="city" name="city" type="text" />
      </form>
    `);
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(2);
    expect(res.questions.map((q) => q.fieldType)).toEqual(['select', 'text']);
  });

  it('S7C: extracts questions on smartapply questions-module step', () => {
    const doc = dom(
      `
      <form data-testid="application-form">
        <label for="q1">Why do you want this role?</label>
        <textarea id="q1" name="motivation"></textarea>
      </form>
    `,
      QUESTIONS_MODULE_URL,
    );
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(1);
  });

  it('S7C: extracts questions on a later multi-page questions-module step', () => {
    const doc = dom(
      `
      <form data-testid="application-form">
        <label for="q1">What is your notice period?</label>
        <input id="q1" name="notice" type="text" />
      </form>
    `,
      QUESTIONS_MODULE_URL_PAGE_2,
    );
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(1);
  });

  it('S7C: excludes the homepage/search-results page', () => {
    const doc = dom(
      `
      <form data-testid="application-form">
        <label for="q1">Why do you want this role?</label>
        <textarea id="q1" name="motivation"></textarea>
      </form>
    `,
      HOMEPAGE_URL,
    );
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('S7C: excludes the resume-selection-module page', () => {
    const doc = dom(
      `
      <form data-testid="application-form">
        <label for="q1">Why do you want this role?</label>
        <textarea id="q1" name="motivation"></textarea>
      </form>
    `,
      RESUME_SELECTION_URL,
    );
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('S7C: excludes an unaccompanied cover letter field', () => {
    const doc = dom(
      `
      <form data-testid="application-form">
        <label for="cover">Cover letter</label>
        <textarea id="cover" name="coverLetter"></textarea>
      </form>
    `,
      QUESTIONS_MODULE_URL,
    );
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('S7C: includes cover letter when co-located with an employer question', () => {
    const doc = dom(
      `
      <form data-testid="application-form">
        <label for="cover">Cover letter</label>
        <textarea id="cover" name="coverLetter"></textarea>
        <label for="q1">Why do you want this role?</label>
        <textarea id="q1" name="motivation"></textarea>
      </form>
    `,
      QUESTIONS_MODULE_URL,
    );
    const res = extractIndeedQuestions(doc);
    expect(res.questions).toHaveLength(2);
    expect(res.questions.some((q) => q.label === 'Cover letter')).toBe(true);
  });

  it('matches all Indeed submit and continue button variants with click-submit selector', () => {
    const SUBMIT_SELECTOR =
      'button[type="submit"], input[type="submit"], button[data-automation*="submit" i], [class*="submit" i], [data-testid*="submit" i], button[aria-label*="Submit" i], button[aria-label*="Continue" i], button[data-testid*="continue" i], [class*="continue" i]';

    const doc = dom(`
      <div>
        <button id="btn-aria-continue" type="button" aria-label="Continue to next step"><span>Next</span></button>
        <button id="btn-testid-continue" data-testid="continue-button">Continue</button>
        <button id="btn-class-continue" class="ia-continueButton">Continue</button>
        <button id="btn-type-submit" type="submit">Submit application</button>
        <button id="btn-other" type="button">Back</button>
      </div>
    `);

    const spanInsideAria = doc.querySelector('#btn-aria-continue span')!;
    expect(spanInsideAria.closest(SUBMIT_SELECTOR)).toBe(doc.querySelector('#btn-aria-continue'));

    const testIdBtn = doc.querySelector('#btn-testid-continue')!;
    expect(testIdBtn.matches(SUBMIT_SELECTOR)).toBe(true);

    const classBtn = doc.querySelector('#btn-class-continue')!;
    expect(classBtn.matches(SUBMIT_SELECTOR)).toBe(true);

    const submitBtn = doc.querySelector('#btn-type-submit')!;
    expect(submitBtn.matches(SUBMIT_SELECTOR)).toBe(true);

    const backBtn = doc.querySelector('#btn-other')!;
    expect(backBtn.matches(SUBMIT_SELECTOR)).toBe(false);
  });
});
