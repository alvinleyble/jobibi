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
          <label for="b">Why are you a good fit for this role?</label>
          <textarea id="b" name="fit"></textarea>
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

  // S7B — detection scoping

  it('scopes to Easy Apply dialog: nav/filter outside modal is ignored', () => {
    const doc = dom(`
      <html><body>
        <nav>
          <input name="search" placeholder="Search jobs" />
          <label for="nav-filter">Filter by location</label>
          <input id="nav-filter" name="filter" type="text" />
        </nav>
        <div class="jobs-search-results">
          <input name="keyword" placeholder="Keyword filter" />
        </div>
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
  });

  it('returns no questions when no Easy Apply dialog is present (search page only)', () => {
    const doc = dom(`
      <html><body>
        <nav><input name="search" placeholder="Search" /></nav>
        <div class="jobs-search-results">
          <label for="kw">Keyword</label>
          <input id="kw" name="keyword" type="text" />
        </div>
        <h1 class="jobs-unified-top-card__job-title">Backend Engineer</h1>
      </body></html>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
    expect(res.jobContext.roleTitle).toBe('Backend Engineer');
  });

  it('skips contact-info step: phone/email/city fields alone produce no questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Contact info</h3>
        <form>
          <label for="phone">Mobile phone number</label>
          <input id="phone" name="phone" type="tel" />
          <label for="email">Email address</label>
          <input id="email" name="email" type="email" />
          <label for="city">City</label>
          <input id="city" name="city" type="text" />
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('skips resume step: file input alone produces no questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Resume</h3>
        <form>
          <label for="resume">Upload resume</label>
          <input id="resume" name="resume" type="file" />
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('skips review step: no fields or only summary produces no questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Review</h3>
        <div>Please review your application</div>
        <button>Submit application</button>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('detects only Additional Questions step: header plus employer questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <div class="fb-dash-form-element">
          <label for="aq1">Have you completed the following level of education: Bachelor's Degree?</label>
          <select id="aq1" name="education"><option>Yes</option><option>No</option></select>
        </div>
        <div class="fb-dash-form-element">
          <label for="aq2">How many years of QA experience do you have?</label>
          <input id="aq2" name="years" type="text" />
        </div>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('cover-letter field alone is NOT detected (S8 carve-out)', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <label for="cover">Cover letter</label>
          <textarea id="cover" name="coverLetter" placeholder="Write a cover letter"></textarea>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('cover-letter co-located with employer questions IS detected', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <div class="fb-dash-form-element">
            <label for="q1">Why do you want to work at this company?</label>
            <textarea id="q1" name="why"></textarea>
          </div>
          <div class="fb-dash-form-element">
            <label for="cover">Cover letter</label>
            <textarea id="cover" name="coverLetter"></textarea>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    const cover = res.questions.find((q) => q.label.toLowerCase().includes('cover letter'));
    expect(cover).toBeDefined();
    expect(res.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('cover-letter co-located via presence signal without header still detected (same step)', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <div class="fb-dash-form-element">
            <label for="q1">What is your greatest achievement?</label>
            <textarea id="q1" name="achieve"></textarea>
          </div>
          <label for="cover2">Cover letter</label>
          <textarea id="cover2" name="coverLetter2"></textarea>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    const cover = res.questions.find((q) => q.label.toLowerCase().includes('cover letter'));
    expect(cover).toBeDefined();
  });

  it('detects employer question via modern fb-dash marker even without header', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <form>
          <div class="fb-dash-form-element jobs-easy-apply-form-element">
            <label for="fb1">Do you have a valid work permit for this location?</label>
            <select id="fb1" name="permit"><option>Yes</option><option>No</option></select>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toContain('work permit');
  });
});
