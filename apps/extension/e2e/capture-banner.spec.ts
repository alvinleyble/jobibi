import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, getAtsUrl, seedSession, type TestExtensionContext } from './helpers/extension';

// What the sidepanel shows the user after a submit, driven by what the capture
// Edge Function answers. The pre-fix function let a slow style-profile rebuild
// blow the request budget and answered with a compute-resources error even
// though the answers were already in the database; the fixed function returns
// 200 with insertedIds. This spec renders both outcomes so the banner
// difference is visible.

const SHOT_DIR = process.env.CAPTURE_SHOT_DIR ?? path.resolve(process.cwd(), 'e2e-shots');

test.describe('Sidepanel capture banner', () => {
  let server: FixtureServer;
  let ext: TestExtensionContext;

  test.beforeAll(async () => {
    server = await startFixtureServer();
    fs.mkdirSync(SHOT_DIR, { recursive: true });
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

  async function submitApplication(captureResponse: { status: number; body: unknown }) {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await ext.context.route('**/functions/v1/capture', async (route) => {
      await route.fulfill({
        status: captureResponse.status,
        contentType: 'application/json',
        body: JSON.stringify(captureResponse.body),
      });
    });

    const atsPage = await ext.context.newPage();
    await atsPage.goto(getAtsUrl('jobstreet', server.port));
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Why do you want to work at TechCorp?')).toBeVisible({ timeout: 7000 });

    await atsPage.bringToFront();
    await atsPage.locator('#PH_Q_101_V1').fill('I want to work at TechCorp because of its strong engineering culture and mission.');
    await atsPage.locator('#PH_Q_102_V1').fill('Over 5 years of TypeScript and React production development with automated CI testing.');
    await atsPage.locator('button[data-automation="submit-application"]').click();

    await sidepanel.bringToFront();
    return sidepanel;
  }

  test('fixed capture 200 shows the saved toast, not an error banner', async () => {
    // Exactly what the fixed Edge Function returns (see capture.integration.test.ts transcript).
    const sidepanel = await submitApplication({
      status: 200,
      body: {
        ok: true,
        applicationId: 'app-int-1',
        inserted: 2,
        insertedIds: ['qa-1', 'qa-2'],
        droppedMismatched: 0,
        droppedSensitive: 0,
        memoryChunksFailed: 0,
        dedupSkipped: 0,
        failedItems: 0,
        sensitiveRejections: [],
        mismatchesLogged: 0,
      },
    });

    await expect(sidepanel.getByTestId('capture-toast')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.getByTestId('capture-toast')).toContainText('Saved 2 answers to memory');
    await expect(sidepanel.getByTestId('capture-error-toast')).toHaveCount(0);

    await sidepanel.screenshot({ path: path.join(SHOT_DIR, 'capture-banner-after-fix.png') });
  });

  test('pre-fix compute-resources failure is what the red error banner looks like', async () => {
    const sidepanel = await submitApplication({
      status: 546,
      body: { error: 'Function failed due to not having enough compute resources' },
    });

    await expect(sidepanel.getByTestId('capture-error-toast')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.getByTestId('capture-error-toast')).toContainText('Could not save application answers');

    await sidepanel.screenshot({ path: path.join(SHOT_DIR, 'capture-banner-before-fix.png') });
  });
});
