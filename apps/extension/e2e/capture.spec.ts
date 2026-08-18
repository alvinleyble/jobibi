import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import {
  launchExtensionContext,
  openSidepanel,
  seedSession,
  getAtsUrl,
  getRoleRequirementsUrl,
  getLinkedInReviewUrl,
  getIndeedMultistepUrl,
  type TestExtensionContext,
} from './helpers/extension';

test.describe('Capture Flow (D12, D13, D16 & D17)', () => {
  let server: FixtureServer;
  let ext: TestExtensionContext;

  test.beforeAll(async () => {
    server = await startFixtureServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async () => {
    ext = await launchExtensionContext();
  });

  test.afterEach(async () => {
    await ext.close();
  });

  test('Form submission captures entered answers in background SW and shows toast across tabs', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let captureRequestBody: any = null;

    // Intercept capture Edge function across entire browser context (SW + sidepanel)
    await ext.context.route('**/functions/v1/capture', async (route) => {
      const postData = route.request().postDataJSON();
      captureRequestBody = postData;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          inserted: 2,
          droppedMismatched: 0,
          droppedSensitive: 0,
          sensitiveRejections: [],
        }),
      });
    });

    // Open JobStreet application page
    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Why do you want to work at TechCorp?')).toBeVisible({ timeout: 7000 });

    // Switch back to atsPage and type answers into the fields
    await atsPage.bringToFront();
    const answer1 = 'I want to work at TechCorp because of its strong engineering culture and mission.';
    const answer2 = 'Over 5 years of TypeScript and React production development with automated CI testing.';

    await atsPage.locator('#PH_Q_101_V1').fill(answer1);
    await atsPage.locator('#PH_Q_102_V1').fill(answer2);

    // Submit the form
    await atsPage.locator('button[data-automation="submit-application"]').click();

    // Verify sidepanel receives capture toast banner across tab
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Saved 2 answers to memory')).toBeVisible({ timeout: 7000 });

    // Verify capture request body structure and invariants
    expect(captureRequestBody).not.toBeNull();
    expect(captureRequestBody.answers).toBeInstanceOf(Array);
    expect(captureRequestBody.answers.length).toBeGreaterThanOrEqual(2);

    // Verify D16 mapping re-verification on answers
    const capturedQ1 = captureRequestBody.answers.find((a: any) =>
      a.questionLabel.includes('Why do you want to work at TechCorp?'),
    );
    expect(capturedQ1).toBeDefined();
    expect(capturedQ1.answerText).toBe(answer1);
    expect(capturedQ1.mappingVerified).toBe(true);
    expect(capturedQ1.fieldSelector).toBe('#PH_Q_101_V1');

    const capturedQ2 = captureRequestBody.answers.find((a: any) =>
      a.questionLabel.includes('Describe your experience with TypeScript and React'),
    );
    expect(capturedQ2).toBeDefined();
    expect(capturedQ2.answerText).toBe(answer2);
    expect(capturedQ2.mappingVerified).toBe(true);

    // Verify job context
    expect(captureRequestBody.application.roleTitle).toBe('Senior Software Engineer');
    expect(captureRequestBody.application.company).toBe('TechCorp Philippines');
  });

  test('JobStreet role-requirements: non-_Q_ questions detected and Continue captures human text (no PH_Q_ tokens)', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let captureRequestBody: any = null;

    // Intercept capture Edge function across the browser context
    await ext.context.route('**/functions/v1/capture', async (route) => {
      const postData = route.request().postDataJSON();
      captureRequestBody = postData;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          inserted: 3,
          droppedMismatched: 0,
          droppedSensitive: 0,
          sensitiveRejections: [],
        }),
      });
    });

    // Open JobStreet role-requirements page (stepper labels + non-_Q_ questions)
    const atsPage = await ext.context.newPage();
    const url = getRoleRequirementsUrl(server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    // Bug 1: the panel lists the employer questions even though none carry _Q_ ids
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=How many years of experience do you have?')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=Do you have experience automating tests?')).toBeVisible();
    await expect(sidepanel.locator('text=Which English skills do you have?')).toBeVisible();

    // Answer the fields explicitly, then click the non-submit Continue button
    await atsPage.bringToFront();
    await atsPage.locator('#years').selectOption({ label: '2 years' });
    await atsPage.locator('input[name="automate"][value="PH_Q_7254_V_4_A_7256"]').check();
    await atsPage.locator('input[name="english"][value="PH_Q_1_V_1_A_1"]').check();
    await atsPage.locator('input[name="english"][value="PH_Q_1_V_2_A_2"]').check();
    await atsPage.locator('#continue-btn').click();

    // Bug 3: Continue (a non-submit button) still triggers capture
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Saved 3 answers to memory')).toBeVisible({ timeout: 7000 });

    // Capture payload carries human text, never the opaque PH_Q_ tokens
    expect(captureRequestBody).not.toBeNull();
    expect(captureRequestBody.answers).toBeInstanceOf(Array);
    expect(captureRequestBody.answers.length).toBeGreaterThanOrEqual(3);

    const byLabel = (l: string) => captureRequestBody.answers.find((a: any) => a.questionLabel.includes(l));
    expect(byLabel('How many years of experience do you have?')).toBeDefined();
    expect(byLabel('How many years of experience do you have?').answerText).toBe('2 years');
    expect(byLabel('Do you have experience automating tests?').answerText).toBe('Yes');
    expect(byLabel('Which English skills do you have?').answerText).toBe('Speaks proficiently, Writes proficiently');

    // No PH_Q_ tokens leak into any answer text or field identity
    expect(JSON.stringify(captureRequestBody.answers)).not.toContain('PH_Q_');
  });

  test('LinkedIn: eager snapshot captures a multi-select checkbox group when Next navigates through the shadow root', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let captureRequestBody: any = null;

    await ext.context.route('**/functions/v1/capture', async (route) => {
      const postData = route.request().postDataJSON();
      captureRequestBody = postData;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          inserted: 2,
          droppedMismatched: 0,
          droppedSensitive: 0,
          sensitiveRejections: [],
        }),
      });
    });

    // Open the LinkedIn Easy Apply review fixture (questions step + Next → Review)
    const atsPage = await ext.context.newPage();
    const url = getLinkedInReviewUrl(server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    // The sidepanel lists both questions (extraction pierces the shadow root).
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=What are the testing tools and methods have you worked with?')).toBeVisible({
      timeout: 7000,
    });
    await expect(sidepanel.locator('text=Tell us about a time you improved test suite reliability.')).toBeVisible();

    // Answer the fields inside the shadow root (Playwright pierces open shadow DOM).
    await atsPage.bringToFront();
    await atsPage.locator('#tool-0').check(); // Automatic testing
    await atsPage.locator('#tool-1').check(); // Black-box testing
    // Attribute form: the LinkedIn id contains colons, which are not valid in a #id CSS selector.
    await atsPage.locator('[id="urn:li:fs_easyApplyFormElement:text"]').fill('I built a parallel CI lane that halved suite runtime.');

    // Click Next — the SPA swaps the questions step for Review before the
    // deferred capture runs, so only the eager click snapshot can save this step.
    await atsPage.locator('#next-btn').click();

    // Review step is now visible (SPA navigated in place)
    await expect(atsPage.locator('#review-step')).toBeVisible({ timeout: 5000 });

    // Capture payload still carries the answered step, merged from the snapshot.
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Saved 2 answers to memory')).toBeVisible({ timeout: 7000 });

    expect(captureRequestBody).not.toBeNull();
    expect(captureRequestBody.answers).toBeInstanceOf(Array);
    expect(captureRequestBody.answers.length).toBeGreaterThanOrEqual(2);

    const tools = captureRequestBody.answers.find((a: any) =>
      a.questionLabel.includes('testing tools and methods'),
    );
    expect(tools).toBeDefined();
    expect(tools.answerText).toBe('Automatic testing, Black-box testing');
    expect(tools.mappingVerified).toBe(true);

    const text = captureRequestBody.answers.find((a: any) =>
      a.questionLabel.includes('improved test suite reliability'),
    );
    expect(text).toBeDefined();
    expect(text.answerText).toBe('I built a parallel CI lane that halved suite runtime.');

    // Job context resolved from the light DOM behind the modal
    expect(captureRequestBody.application.roleTitle).toBe('Staff Automation Engineer');
    expect(captureRequestBody.application.company).toBe('InnoTech Solutions');
  });

  test('Memory tab reactively refreshes and shows captured answers immediately without reload (D-2)', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let capturedRows: any[] = [];

    // Intercept REST qa_pairs endpoint to serve dynamic rows
    await sidepanel.unroute('**/rest/v1/qa_pairs*');
    await sidepanel.route('**/rest/v1/qa_pairs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(capturedRows),
      });
    });

    // Intercept capture Edge function
    await ext.context.route('**/functions/v1/capture', async (route) => {
      // When capture completes, make the new row available to qa_pairs queries
      capturedRows = [
        {
          id: 'qa-indeed-react-1',
          question_label: 'How many years of work experience do you have with Playwright?',
          question_norm: 'how many years of work experience do you have with playwright',
          answer_text: '3 years of end-to-end testing with Playwright.',
          origin: 'user_written',
          created_at: new Date().toISOString(),
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          inserted: 1,
          droppedMismatched: 0,
        }),
      });
    });

    // Switch sidepanel to Memory tab
    await sidepanel.bringToFront();
    await sidepanel.click('[data-testid="tab-memory-btn"]');
    await expect(sidepanel.locator('text=Stored answers · 0')).toBeVisible({ timeout: 5000 });

    // Open Indeed apply page
    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('indeed', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    // Fill answer and click Continue button (D-4 selector coverage)
    await atsPage.locator('#q_indeed_1').fill('3 years of end-to-end testing with Playwright.');
    await atsPage.locator('button.ia-continueButton').click();

    // Verify sidepanel on Memory tab reactively refreshes and renders the newly captured answer
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Saved 1 answer to memory')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=Stored answers · 1')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=How many years of work experience do you have with Playwright?')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=3 years of end-to-end testing with Playwright.')).toBeVisible({ timeout: 7000 });
  });

  test('Indeed SmartApply: eager snapshot captures answers across SPA step transition (Continue -> Review step)', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let captureRequestBody: any = null;

    // Intercept capture Edge function
    await ext.context.route('**/functions/v1/capture', async (route) => {
      const postData = route.request().postDataJSON();
      captureRequestBody = postData;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          inserted: 3,
          droppedMismatched: 0,
          droppedSensitive: 0,
          sensitiveRejections: [],
        }),
      });
    });

    // Open the Indeed SmartApply multistep fixture
    const atsPage = await ext.context.newPage();
    const url = getIndeedMultistepUrl(server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    // The sidepanel lists the questions from questions-step-1
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=How many years of experience do you have with TypeScript?')).toBeVisible({
      timeout: 7000,
    });
    await expect(sidepanel.locator('text=Which frontend frameworks have you used in production?')).toBeVisible();
    await expect(sidepanel.locator('text=Are you comfortable with remote work?')).toBeVisible();

    // Answer the fields on Step 1
    await atsPage.bringToFront();
    await atsPage.locator('#q_years').fill('5 years of professional TypeScript.');
    await atsPage.locator('#fw-react').check();
    await atsPage.locator('#fw-vue').check();
    await atsPage.locator('#remote-yes').check();

    // Click Continue — the SPA immediately swaps Step 1 for Review Step in place
    await atsPage.locator('#continue-step-btn').click();

    // Review step is now visible
    await expect(atsPage.locator('#review-step')).toBeVisible({ timeout: 5000 });

    // Capture payload still carries the answered step, merged from the eager snapshot
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Saved 3 answers to memory')).toBeVisible({ timeout: 7000 });

    expect(captureRequestBody).not.toBeNull();
    expect(captureRequestBody.answers).toBeInstanceOf(Array);
    expect(captureRequestBody.answers.length).toBeGreaterThanOrEqual(3);

    const tsAnswer = captureRequestBody.answers.find((a: any) =>
      a.questionLabel.includes('years of experience do you have with TypeScript'),
    );
    expect(tsAnswer).toBeDefined();
    expect(tsAnswer.answerText).toBe('5 years of professional TypeScript.');
    expect(tsAnswer.mappingVerified).toBe(true);

    const fwAnswer = captureRequestBody.answers.find((a: any) =>
      a.questionLabel.includes('Which frontend frameworks have you used in production?'),
    );
    expect(fwAnswer).toBeDefined();
    expect(fwAnswer.answerText).toBe('React, Vue.js');
    expect(fwAnswer.mappingVerified).toBe(true);

    const remoteAnswer = captureRequestBody.answers.find((a: any) =>
      a.questionLabel.includes('Are you comfortable with remote work?'),
    );
    expect(remoteAnswer).toBeDefined();
    expect(remoteAnswer.answerText).toBe('Yes, 100% remote');
    expect(remoteAnswer.mappingVerified).toBe(true);

    // Job context resolved
    expect(captureRequestBody.application.roleTitle).toBe('Senior Frontend Engineer');
    expect(captureRequestBody.application.company).toBe('Indeed Solutions Inc.');
  });

  test('Persistent Capture Toast remains visible after 4+ seconds, Undo removes captured answers, and ✕ dismisses toast (Items 7 & 8)', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let capturedRows: any[] = [];
    let deleteQaCalled = false;

    await sidepanel.unroute('**/rest/v1/qa_pairs*');
    await sidepanel.route('**/rest/v1/qa_pairs*', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteQaCalled = true;
        capturedRows = [];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(capturedRows),
      });
    });

    await sidepanel.route('**/rest/v1/memory_chunks*', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Intercept capture Edge function returning insertedIds
    await ext.context.route('**/functions/v1/capture', async (route) => {
      capturedRows = [
        {
          id: 'qa-undo-test-1',
          question_label: 'Why do you want to work at TechCorp?',
          question_norm: 'why do you want to work at techcorp',
          answer_text: 'I want to work at TechCorp because of its strong engineering culture and mission.',
          origin: 'user_written',
          created_at: new Date().toISOString(),
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          inserted: 1,
          insertedIds: ['qa-undo-test-1'],
          droppedMismatched: 0,
        }),
      });
    });

    // Open JobStreet application page
    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await atsPage.locator('#PH_Q_101_V1').fill('I want to work at TechCorp because of its strong engineering culture and mission.');
    await atsPage.locator('button[data-automation="submit-application"]').click();

    // 1. Verify toast appears with Undo button
    await sidepanel.bringToFront();
    const toast = sidepanel.getByTestId('capture-toast');
    await expect(toast).toBeVisible({ timeout: 7000 });
    await expect(toast).toContainText('Saved 1 answer to memory');
    await expect(sidepanel.getByTestId('capture-undo-btn')).toBeVisible();

    // 2. Verify toast is PERSISTENT (remains visible after 4+ seconds, not auto-hidden)
    await sidepanel.waitForTimeout(4500);
    await expect(toast).toBeVisible();

    // Switch to Memory tab to see answer stored
    await sidepanel.click('[data-testid="tab-memory-btn"]');
    await expect(sidepanel.locator('text=Stored answers · 1')).toBeVisible({ timeout: 5000 });

    // 3. Click Undo button in persistent toast
    await sidepanel.getByTestId('capture-undo-btn').click();

    // Verify toast confirms "Capture undone" and Undo button is removed
    await expect(toast).toContainText('Capture undone');
    await expect(sidepanel.getByTestId('capture-undo-btn')).toHaveCount(0);

    // Verify memory bank reactively refreshes and reflects 0 stored answers
    await expect(sidepanel.locator('text=Stored answers · 0')).toBeVisible({ timeout: 5000 });
    expect(deleteQaCalled).toBe(true);

    // 4. Click dismiss '✕' button
    await sidepanel.getByTestId('capture-dismiss-btn').click();
    await expect(toast).toHaveCount(0);
  });
});

