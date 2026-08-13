import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractLinkedInQuestions } from './linkedin.ts';

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

describe('extractLinkedInQuestions', () => {
  it('extracts textarea inside Easy Apply modal with label-for (confidence 1.0)', () => {
    const doc = dom(`
      <html><body>
        <h1 class="jobs-unified-top-card__job-title">QA Engineer</h1>
        <a class="jobs-unified-top-card__company-name">Acme Corp</a>
        <div class="jobs-easy-apply-modal">
          <form>
            <label for="q1">Why do you want this role?</label>
            <textarea id="q1" name="motivation"></textarea>
          </form>
        </div>
      </body></html>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toBe('Why do you want this role?');
    expect(res.questions[0].labelSource).toBe('label-for');
    expect(res.questions[0].confidence).toBe(1.0);
    expect(res.questions[0].fieldType).toBe('textarea');
    expect(res.adapter).toBe('linkedin');
    expect(res.jobContext.roleTitle).toBe('QA Engineer');
    expect(res.jobContext.company).toBe('Acme Corp');
  });

  it('extracts wrapping label (confidence 0.95)', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <label>Tell us about yourself <textarea name="about"></textarea></label>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('label-wrap');
    expect(res.questions[0].confidence).toBe(0.95);
  });

  it('extracts aria-label (0.8) and aria-labelledby (0.85)', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <textarea aria-label="What is your expected salary?" name="salary"></textarea>
          <span id="lbl">Describe a challenge you overcame</span>
          <textarea aria-labelledby="lbl" name="challenge"></textarea>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(2);
    const salary = res.questions.find((q) => q.label === 'What is your expected salary?');
    expect(salary?.labelSource).toBe('aria-label');
    expect(salary?.confidence).toBe(0.8);
    const challenge = res.questions.find((q) => q.label === 'Describe a challenge you overcame');
    expect(challenge?.labelSource).toBe('aria-labelledby');
    expect(challenge?.confidence).toBe(0.85);
  });

  it('uses proximity fallback (0.5) for LinkedIn-like structure', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <div>
            <span>Why should we hire you?</span>
            <textarea name="hire"></textarea>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('proximity');
    expect(res.questions[0].confidence).toBe(0.5);
  });

  it('skips fields with no resolvable label', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <textarea name="orphan"></textarea>
          <input type="hidden" name="csrf" value="123" />
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('opportunistically captures JD text when present behind modal (D11)', () => {
    const doc = dom(`
      <html><body>
        <h1 class="jobs-unified-top-card__job-title">Senior QA</h1>
        <div class="jobs-description-content__text">We are looking for a QA engineer to build automation frameworks for our fintech product. Responsibilities include test planning, automation scripting, and mentoring junior QA.</div>
        <div class="jobs-easy-apply-modal">
          <form>
            <label for="a">Why are you a good fit?</label>
            <textarea id="a" name="fit"></textarea>
          </form>
        </div>
      </body></html>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.jobContext.jobDescription).toBeDefined();
    expect(res.jobContext.jobDescription!.length).toBeGreaterThan(20);
    expect(res.jobContext.jobDescription).toContain('QA engineer');
  });

  it('does not require JD text — works without it', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <label for="b">Cover letter</label>
          <textarea id="b" name="cover"></textarea>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.jobContext.jobDescription).toBeUndefined();
  });

  it('handles LinkedIn fixture: multiple question types and radio groups', () => {
    const doc = dom(`
      <html><body>
        <h1 class="jobs-unified-top-card__job-title">QA Engineer</h1>
        <a class="jobs-unified-top-card__company-name">Acme Corp</a>
        <div class="jobs-easy-apply-modal">
          <form>
            <div class="form-group">
              <label for="cover">Cover letter</label>
              <textarea id="cover" name="coverLetter" placeholder="Tell us why you are a good fit"></textarea>
            </div>
            <div class="form-group">
              <span>What is your expected monthly salary? *</span>
              <input name="expectedSalary" type="text" placeholder="e.g. 50000" />
            </div>
            <fieldset>
              <legend>Are you willing to commute?</legend>
              <label><input type="radio" name="commute" value="yes" /> Yes</label>
              <label><input type="radio" name="commute" value="no" /> No</label>
            </fieldset>
          </form>
        </div>
      </body></html>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions.length).toBeGreaterThanOrEqual(2);
    expect(res.jobContext.roleTitle).toBe('QA Engineer');
    const cover = res.questions.find((q) => q.label === 'Cover letter');
    expect(cover).toBeDefined();
    expect(cover!.confidence).toBe(1.0);
  });

  it('each question carries selector and confidence', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <label for="a">Why this company?</label>
          <textarea id="a" name="why"></textarea>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    const q = res.questions[0];
    expect(q.field.selector).toBeDefined();
    expect(q.field.selector.length).toBeGreaterThan(0);
    expect(typeof q.confidence).toBe('number');
    expect(q.confidence).toBeGreaterThan(0);
    expect(q.confidence).toBeLessThanOrEqual(1);
  });

  it('placeholder-only becomes label when question-like', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <textarea name="q" placeholder="Why do you want to join us?"></textarea>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].labelSource).toBe('placeholder');
  });

  it('strips trailing * and : from labels', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <label for="x">Expected salary *</label>
          <input id="x" name="salary" type="text" />
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions[0].label).toBe('Expected salary');
  });
});
