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

  test('Form submission captures entered answers, verifies mappings (D16), and reports capture status', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let captureRequestBody: any = null;

    // Intercept capture Edge function
    await sidepanel.route('**/functions/v1/capture', async (route) => {
      const postData = route.request().postDataJSON();
      captureRequestBody = postData;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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

    // Verify sidepanel receives capture and invokes edge function with correct payload
    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Capture: 2 saved')).toBeVisible({ timeout: 7000 });

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
});
