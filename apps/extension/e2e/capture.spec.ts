import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, seedSession, getAtsUrl, type TestExtensionContext } from './helpers/extension';

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
});
