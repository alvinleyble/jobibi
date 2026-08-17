import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  extractLinkedInQuestions,
  isReviewStep,
  isContactInfoStep,
  isConsentOrFollowLabel,
  isAdditionalQuestionsStep,
} from './linkedin.ts';

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

  // Regression: ProSource live shape - 6 required text inputs with artdeco markup
  // Captain reported Additional Questions header with 6 text inputs like
  // "How many years is your QA experience?" etc. were missed (panel showed 0).
  // This fixture mimics LinkedIn's artdeco-text-input + fb-dash wrapper where
  // the label text lives in a container's textContent (not always <label for>),
  // and inputs are generic <input> without explicit label[for] in some variants.
  it('regression: ProSource 6 QA years questions with artdeco/fb-dash markup', () => {
    const doc = dom(`
      <html><body>
        <div id="artdeco-modal-outlet">
          <div class="artdeco-modal artdeco-modal--is-open" role="dialog" data-test-modal-id="easy-apply-modal">
            <div class="jobs-easy-apply-content">
              <h3 class="t-16">Additional Questions</h3>
              <form>
                <div class="fb-dash-form-element jobs-easy-apply-form-element">
                  <div class="artdeco-text-input artdeco-text-input--container">
                    <label for="single-line-text-form-component-formElement-1">How many years is your QA experience? *</label>
                    <input id="single-line-text-form-component-formElement-1" type="text" />
                  </div>
                </div>
                <div class="fb-dash-form-element">
                  <div class="artdeco-text-input">
                    <span class="artdeco-text-input--label">How many years is your Manual QA experience? *</span>
                    <input name="manualQa" type="text" />
                  </div>
                </div>
                <div class="fb-dash-form-element">
                  <div class="artdeco-text-input">
                    <span>How many years is your experience with Playwright? *</span>
                    <input name="playwrightYears" type="text" />
                  </div>
                </div>
                <div class="fb-dash-form-element">
                  <label for="q4">How many years is your experience with automation testing? *</label>
                  <input id="q4" name="autoYears" type="text" />
                </div>
                <div class="fb-dash-form-element">
                  <label for="q5">How many years is your experience with API testing? *</label>
                  <input id="q5" name="apiYears" type="text" />
                </div>
                <div class="fb-dash-form-element">
                  <div class="artdeco-text-input">
                    <div class="fb-form-element-label">How many years is your experience with Agile? *</div>
                    <input name="agileYears" type="text" />
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </body></html>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions.length).toBeGreaterThanOrEqual(6);
    const labels = res.questions.map((q) => q.label);
    expect(labels.some((l) => l.includes('QA experience'))).toBe(true);
    expect(labels.some((l) => l.includes('Playwright'))).toBe(true);
    expect(labels.some((l) => l.includes('Agile'))).toBe(true);
  });

  it('regression: artdeco container textContent fallback without label[for]', () => {
    const doc = dom(`
      <div class="artdeco-modal artdeco-modal--is-open" role="dialog">
        <h3>Additional Questions</h3>
        <div class="jobs-easy-apply-content">
          <form>
            <div class="artdeco-text-input">
              <div>How many years is your QA experience? *</div>
              <input name="q1" type="text" />
            </div>
          </form>
        </div>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toContain('QA experience');
  });

  // Regression: real LinkedIn Easy Apply modal lives inside an OPEN Shadow DOM
  // under #interop-outlet (and #shadow-host-companion). Plain
  // document.querySelectorAll never crosses that boundary — every selector-variant
  // fix found 0 questions until the adapter pierced the shadow root.
  // These fixtures use JSDOM's attachShadow to prevent regression.
  function domWithInteropShadow(shadowHtml: string, outerHtml = ''): Document {
    const doc = dom(`<html><body><div id="interop-outlet"></div>${outerHtml}</body></html>`);
    const host = doc.getElementById('interop-outlet') as unknown as { attachShadow: (o: { mode: string }) => ShadowRoot };
    const sr = host.attachShadow({ mode: 'open' }) as unknown as Document;
    // ShadowRoot supports innerHTML in JSDOM
    (sr as unknown as { innerHTML: string }).innerHTML = shadowHtml;
    return doc;
  }

  it('shadow: detects Additional Questions inside #interop-outlet open shadowRoot (ProSource shape)', () => {
    const doc = domWithInteropShadow(
      `
      <div role="dialog" class="artdeco-modal artdeco-modal--layer-default jobs-easy-apply-modal">
        <div class="jobs-easy-apply-modal__content">
          <h3>Additional Questions</h3>
          <form>
            <div class="fb-dash-form-element">
              <label for="single-line-text-form-component-formElement-1">How many years is your QA experience?</label>
              <input id="single-line-text-form-component-formElement-1" type="text" />
            </div>
            <div class="fb-dash-form-element">
              <label for="q2">How many years is your Manual QA experience?</label>
              <input id="q2" type="text" />
            </div>
            <div class="fb-dash-form-element">
              <label for="q3">How many years is your experience with Playwright?</label>
              <input id="q3" type="text" />
            </div>
          </form>
        </div>
      </div>
      `,
      `<nav><input name="search" placeholder="Search jobs" /></nav>
       <div class="jobs-search-results"><label for="kw">Keyword</label><input id="kw" name="keyword" type="text" /></div>
       <h1 class="jobs-unified-top-card__job-title">QA Engineer</h1>`,
    );
    const res = extractLinkedInQuestions(doc);
    // Without shadow piercing this is 0 — that was the entire S7B bug on the real page.
    expect(res.questions.length).toBeGreaterThanOrEqual(3);
    const labels = res.questions.map((q) => q.label);
    expect(labels.some((l) => l.includes('QA experience'))).toBe(true);
    expect(labels.some((l) => l.includes('Playwright'))).toBe(true);
    // Nav/filter chrome outside shadow must not leak in
    expect(labels.some((l) => l.toLowerCase().includes('search jobs'))).toBe(false);
  });

  it('shadow: generic host with open shadowRoot is also pierced (not just #interop-outlet)', () => {
    const doc = dom(`<html><body><div id="my-host"></div></body></html>`);
    const host = doc.getElementById('my-host') as unknown as { attachShadow: (o: { mode: string }) => ShadowRoot };
    const sr = host.attachShadow({ mode: 'open' }) as unknown as { innerHTML: string };
    sr.innerHTML = `
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <label for="q1">Why do you want this role?</label>
          <textarea id="q1" name="motivation"></textarea>
        </form>
      </div>
    `;
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toBe('Why do you want this role?');
  });

  it('shadow: cover-letter carve-out still holds inside shadow (alone excluded, co-located included)', () => {
    const alone = domWithInteropShadow(`
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <label for="cover">Cover letter</label>
          <textarea id="cover" name="coverLetter"></textarea>
        </form>
      </div>
    `);
    expect(extractLinkedInQuestions(alone).questions).toHaveLength(0);

    const colocated = domWithInteropShadow(`
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <label for="q1">Why do you want this role?</label>
          <textarea id="q1"></textarea>
          <label for="cover">Cover letter</label>
          <textarea id="cover"></textarea>
        </form>
      </div>
    `);
    const res2 = extractLinkedInQuestions(colocated);
    expect(res2.questions.some((q) => q.label.toLowerCase().includes('cover letter'))).toBe(true);
    expect(res2.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('shadow: contact-info step inside shadow is still skipped', () => {
    const doc = domWithInteropShadow(`
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <h3>Contact info</h3>
        <form>
          <label for="phone">Mobile phone number</label><input id="phone" type="tel" />
          <label for="email">Email address</label><input id="email" type="email" />
        </form>
      </div>
    `);
    expect(extractLinkedInQuestions(doc).questions).toHaveLength(0);
  });

  // Regression: real Contact Info step doublings — container textContent concatenates
  // two identical label nodes without separator (e.g. "Email addressEmail address")
  // from LinkedIn's artdeco markup; previously classified as employer question because
  // doubled string length >=12 triggered hasEmployerQuestionSignal.
  it('regression: doubled-label Contact Info step does not become Additional Questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Contact info</h3>
        <form>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <!-- LinkedIn can render label text twice in container textContent -->
              <div>Email addressEmail address</div>
              <input name="email" type="text" />
            </div>
          </div>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <div>Mobile phone numberMobile phone number</div>
              <input name="phone" type="text" />
            </div>
          </div>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <div>CityCity</div>
              <input name="city" type="text" />
            </div>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('regression: doubled-label Contact Info inside shadow is still skipped', () => {
    const doc = domWithInteropShadow(`
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <h3>Contact info</h3>
        <form>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <div>Email addressEmail address</div>
              <input name="email" type="text" />
            </div>
          </div>
          <label for="phone">Mobile phone number</label><input id="phone" type="tel" />
        </form>
      </div>
    `);
    expect(extractLinkedInQuestions(doc).questions).toHaveLength(0);
  });

  // Regression: Documents / resume-picker step — LinkedIn shows resume selection UI
  // with long labels like "Select a resume" or file names containing .pdf.
  // Previously misclassified as Additional Questions because label length >=12.
  it('regression: Documents resume-picker step is not Additional Questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Documents</h3>
        <form>
          <div class="fb-dash-form-element">
            <label for="resume">Select a resume *</label>
            <select id="resume" name="resume"><option>Resume - John Doe.pdf</option></select>
          </div>
          <div class="fb-dash-form-element">
            <label for="resume2">Resume</label>
            <input id="resume2" name="resume" type="text" value="MyResume.pdf" />
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('regression: resume-picker inside shadow is still skipped', () => {
    const doc = domWithInteropShadow(`
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <h3>Resume</h3>
        <form>
          <div class="fb-dash-form-element">
            <label>Resume *</label>
            <select name="resume"><option>John Doe Resume.pdf</option></select>
          </div>
        </form>
      </div>
    `);
    expect(extractLinkedInQuestions(doc).questions).toHaveLength(0);
  });

  it('regression: resume fields are never surfaced even if step header is Additional Questions but only resume signal present', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <!-- Edge: malformed step where only resume picker appears but header says Additional Questions — still filtered -->
          <label for="r">Select resume</label>
          <input id="r" name="resume" type="text" />
        </form>
      </div>
    `);
    // Header would normally pass isAdditionalQuestionsStep, but hasEmployerQuestionSignal
    // should now reject resume-only content, so whole step yields 0.
    // If it did pass, the loop filter would still drop the resume field, yielding 0.
    const res = extractLinkedInQuestions(doc);
    // Either outcome is 0 — the key invariant is resume not surfaced as question.
    expect(res.questions).toHaveLength(0);
  });

  it('regression: no-separator doubled contact info (Phone country code, Location (city)) does not trigger Additional Questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Contact info</h3>
        <form>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <label for="pcc">Phone country codePhone country code</label>
              <select id="pcc" name="phoneCountryCode"><option>United States (+1)</option></select>
            </div>
          </div>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <label for="loc">Location (city)Location (city)</label>
              <input id="loc" name="city" type="text" />
            </div>
          </div>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <div>Mobile phone numberMobile phone number Required</div>
              <input name="phone" type="tel" />
            </div>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('regression: no-separator doubled contact info inside shadow root is skipped', () => {
    const doc = domWithInteropShadow(`
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <h3>Contact info</h3>
        <form>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <div>Phone country codePhone country code</div>
              <select name="countryCode"><option>Philippines (+63)</option></select>
            </div>
          </div>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <div>Location (city)Location (city)\nRequired</div>
              <input name="location" type="text" />
            </div>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('regression: doubled question text with trailing Required marker in Additional Questions is correctly extracted and deduped', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <div class="fb-dash-form-element">
            <div class="artdeco-text-input">
              <label for="tools">What are the testing tools and methods have you worked with?What are the testing tools and methods have you worked with? Required</label>
              <textarea id="tools" name="tools"></textarea>
            </div>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].label).toBe(
      'What are the testing tools and methods have you worked with?',
    );
  });

  it('regression: various spacing and tiling variations in questions are deduped properly', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <div class="fb-dash-form-element">
            <label for="q1">Tell us about your background Tell us about your background *</label>
            <textarea id="q1" name="q1"></textarea>
          </div>
          <div class="fb-dash-form-element">
            <label for="q2">Why do you want to join our team?Why do you want to join our team?\nRequired</label>
            <textarea id="q2" name="q2"></textarea>
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(2);
    expect(res.questions[0].label).toBe('Tell us about your background');
    expect(res.questions[1].label).toBe('Why do you want to join our team?');
  });

  // ---------------------------------------------------------------------------
  // Review Step & Contact Info Step Guards (Decisions Q4 & Q5)
  // ---------------------------------------------------------------------------

  describe('isReviewStep & isContactInfoStep detectors', () => {
    it('isReviewStep detects review headings and markers', () => {
      const doc1 = dom('<div class="jobs-easy-apply-modal"><h3>Review your application</h3></div>');
      expect(isReviewStep(doc1.querySelector('.jobs-easy-apply-modal')!)).toBe(true);

      const doc2 = dom('<div class="jobs-easy-apply-modal"><h3 class="t-16">Review</h3></div>');
      expect(isReviewStep(doc2.querySelector('.jobs-easy-apply-modal')!)).toBe(true);

      const doc3 = dom('<div class="jobs-easy-apply-modal" data-test-easy-apply-review-step></div>');
      expect(isReviewStep(doc3.querySelector('.jobs-easy-apply-modal')!)).toBe(true);

      const doc4 = dom('<div class="jobs-easy-apply-modal" data-easy-apply-step="review"></div>');
      expect(isReviewStep(doc4.querySelector('.jobs-easy-apply-modal')!)).toBe(true);

      const doc5 = dom('<div class="jobs-easy-apply-modal"><h3>Additional Questions</h3></div>');
      expect(isReviewStep(doc5.querySelector('.jobs-easy-apply-modal')!)).toBe(false);
    });

    it('isContactInfoStep detects contact info headings and markers', () => {
      const doc1 = dom('<div class="jobs-easy-apply-modal"><h3>Contact info</h3></div>');
      expect(isContactInfoStep(doc1.querySelector('.jobs-easy-apply-modal')!)).toBe(true);

      const doc2 = dom('<div class="jobs-easy-apply-modal"><h3 class="t-16">Contact information</h3></div>');
      expect(isContactInfoStep(doc2.querySelector('.jobs-easy-apply-modal')!)).toBe(true);

      const doc3 = dom('<div class="jobs-easy-apply-modal" data-easy-apply-step="contact-info"></div>');
      expect(isContactInfoStep(doc3.querySelector('.jobs-easy-apply-modal')!)).toBe(true);

      const doc4 = dom('<div class="jobs-easy-apply-modal"><h3>Additional Questions</h3></div>');
      expect(isContactInfoStep(doc4.querySelector('.jobs-easy-apply-modal')!)).toBe(false);
    });

    it('isConsentOrFollowLabel matches follow company and consent labels', () => {
      expect(isConsentOrFollowLabel('Follow Conjointly to stay up to date with their page')).toBe(true);
      expect(isConsentOrFollowLabel('Follow Acme Corp to stay up to date with their page')).toBe(true);
      expect(isConsentOrFollowLabel('Follow Acme to stay up to date')).toBe(true);
      expect(isConsentOrFollowLabel('Follow Acme Inc.')).toBe(true);
      expect(isConsentOrFollowLabel('I agree to the terms and conditions')).toBe(true);
      expect(isConsentOrFollowLabel('I consent to the collection and processing of my personal data')).toBe(true);
      expect(isConsentOrFollowLabel('By submitting, you agree to the privacy policy')).toBe(true);
      expect(isConsentOrFollowLabel('I acknowledge all entries are accurate')).toBe(true);

      // Does not match genuine screening questions
      expect(isConsentOrFollowLabel('Why do you want to work at Conjointly?')).toBe(false);
      expect(isConsentOrFollowLabel('How many years of QA experience do you have?')).toBe(false);
      expect(isConsentOrFollowLabel('Cover letter')).toBe(false);
      expect(isConsentOrFollowLabel('Do you have experience with Playwright?')).toBe(false);
    });

    it('isAdditionalQuestionsStep returns false on review or contact info step', () => {
      const reviewDoc = dom(`
        <div class="jobs-easy-apply-modal">
          <h3>Review your application</h3>
          <div class="fb-dash-form-element">
            <label for="follow">Follow Conjointly to stay up to date with their page</label>
            <input id="follow" type="checkbox" checked />
          </div>
        </div>
      `);
      expect(isAdditionalQuestionsStep(reviewDoc.querySelector('.jobs-easy-apply-modal')!)).toBe(false);

      const contactDoc = dom(`
        <div class="jobs-easy-apply-modal">
          <h3>Contact info</h3>
          <div class="fb-dash-form-element">
            <label for="phone">Phone number</label>
            <input id="phone" type="tel" />
          </div>
        </div>
      `);
      expect(isAdditionalQuestionsStep(contactDoc.querySelector('.jobs-easy-apply-modal')!)).toBe(false);
    });
  });

  it('Review step fixture with Follow Company checkbox returns 0 questions', () => {
    const doc = dom(`
      <html><body>
        <div id="artdeco-modal-outlet">
          <div class="artdeco-modal artdeco-modal--is-open jobs-easy-apply-modal" role="dialog">
            <div class="jobs-easy-apply-modal__content">
              <h3 class="t-16">Review your application</h3>
              <div class="jobs-easy-apply-form-section">
                <h4>Contact info</h4>
                <p>Jane Doe</p>
                <p>jane@example.com</p>
              </div>
              <div class="jobs-easy-apply-form-section">
                <div class="fb-dash-form-element">
                  <label for="follow-company">Follow Conjointly to stay up to date with their page</label>
                  <input id="follow-company" type="checkbox" checked />
                </div>
              </div>
              <button type="submit">Submit application</button>
            </div>
          </div>
        </div>
      </body></html>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('Review step fixture with consent checkbox returns 0 questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Review</h3>
        <div class="fb-dash-form-element">
          <label for="consent-check">I agree to the terms and data privacy policy</label>
          <input id="consent-check" type="checkbox" />
        </div>
        <button>Submit application</button>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('Review step inside open shadow DOM with Follow Company checkbox returns 0 questions', () => {
    const doc = domWithInteropShadow(`
      <div role="dialog" class="artdeco-modal jobs-easy-apply-modal">
        <div class="jobs-easy-apply-modal__content">
          <h3 class="t-16">Review your application</h3>
          <div class="fb-dash-form-element">
            <label for="follow-c">Follow Acme to stay up to date with their page</label>
            <input id="follow-c" type="checkbox" checked />
          </div>
          <button>Submit application</button>
        </div>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('Contact Info step fixture returns 0 questions (structural guard)', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Contact info</h3>
        <form>
          <div class="fb-dash-form-element">
            <label for="p">Phone number</label>
            <input id="p" name="phone" type="tel" />
          </div>
          <div class="fb-dash-form-element">
            <label for="e">Email address</label>
            <input id="e" name="email" type="email" />
          </div>
          <div class="fb-dash-form-element">
            <label for="custom">Something that looks like a question or long text</label>
            <input id="custom" name="custom" type="text" />
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('Contact Information step with marker returns 0 questions', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal" data-easy-apply-step="contact-info">
        <h3 class="t-16">Contact information</h3>
        <form>
          <label for="city">City</label>
          <input id="city" name="city" type="text" />
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(0);
  });

  it('Genuine employer screening questions containing ? on Additional Questions step are preserved and extracted', () => {
    const doc = dom(`
      <div class="jobs-easy-apply-modal">
        <h3>Additional Questions</h3>
        <form>
          <div class="fb-dash-form-element">
            <label for="q1">Why do you want to work at this company?</label>
            <textarea id="q1" name="whyCompany"></textarea>
          </div>
          <div class="fb-dash-form-element">
            <label for="q2">Do you consent to a background verification check?</label>
            <select id="q2" name="bgCheck">
              <option value="">Select an option</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div class="fb-dash-form-element">
            <label for="q3">How many years of QA automation experience do you have?</label>
            <input id="q3" name="qaYears" type="text" />
          </div>
        </form>
      </div>
    `);
    const res = extractLinkedInQuestions(doc);
    expect(res.questions).toHaveLength(3);
    const labels = res.questions.map((q) => q.label);
    expect(labels).toContain('Why do you want to work at this company?');
    expect(labels).toContain('Do you consent to a background verification check?');
    expect(labels).toContain('How many years of QA automation experience do you have?');
  });
});

