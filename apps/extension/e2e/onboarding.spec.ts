import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, seedSession, type TestExtensionContext } from './helpers/extension';

test.describe('Streamlined Onboarding Flow', () => {
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

  test('New user sign-in: immediately shows Resume Upload step without 4-facts questionnaire', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true, onboardingCompleted: false });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Verify Onboarding Step 1 is rendered
    await expect(sidepanel.locator('[data-testid="onboarding-resume-step"]')).toBeVisible({ timeout: 5000 });
    await expect(sidepanel.getByRole('heading', { name: 'Upload your resume' })).toBeVisible();

    // Verify 4-facts intake is completely absent
    await expect(sidepanel.locator('text=Sixty-second intake')).toHaveCount(0);
    await expect(sidepanel.locator('text=Salary expectation')).toHaveCount(0);
    await expect(sidepanel.locator('text=Notice period')).toHaveCount(0);
    await expect(sidepanel.locator('text=Work authorization')).toHaveCount(0);
  });

  test('Resume upload error handling: unextractable PDF displays clear human-readable error', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true, onboardingCompleted: false });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    const unextractableError =
      "We couldn't find any selectable text in this PDF. If your resume is a scanned image or photo, please upload a text-based PDF, DOCX, or copy-paste the text.";

    // Intercept storage upload
    await sidepanel.route('**/storage/v1/object/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'ok' }) });
    });

    // Intercept ingest function to simulate unextractable PDF error
    await sidepanel.route('**/functions/v1/ingest', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: unextractableError }),
      });
    });

    // Set file on file input
    const fileInput = sidepanel.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'scanned_resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 mock scanned image without text'),
    });

    // Verify error message is rendered
    await expect(sidepanel.locator(`text=${unextractableError}`)).toBeVisible({ timeout: 5000 });
  });

  test('Successful resume upload advances to optional Voice Seeding step with Save & Continue and Skip', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true, onboardingCompleted: false });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    let ingestCallBody: any = null;

    // Intercept storage upload
    await sidepanel.route('**/storage/v1/object/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'ok' }) });
    });

    // Intercept ingest function
    await sidepanel.route('**/functions/v1/ingest', async (route) => {
      ingestCallBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documentId: 'doc-123', chunkCount: 4 }),
      });
    });

    // Upload resume
    const fileInput = sidepanel.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'valid_resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 resume content'),
    });

    // Verify transition to Voice Seeding step
    await expect(sidepanel.locator('[data-testid="onboarding-voice-step"]')).toBeVisible({ timeout: 5000 });
    await expect(sidepanel.locator('text=Career highlights & writing style')).toBeVisible();
    await expect(
      sidepanel.locator('text=In a few sentences, describe your career highlights or writing style in your own words (or skip).'),
    ).toBeVisible();

    // Verify buttons are present
    const saveBtn = sidepanel.locator('[data-testid="voice-seed-save-btn"]');
    const skipBtn = sidepanel.locator('[data-testid="voice-seed-skip-btn"]');
    await expect(saveBtn).toBeVisible();
    await expect(skipBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled(); // Disabled when empty

    // Enter career summary
    const voiceInput = sidepanel.locator('[data-testid="voice-seed-input"]');
    const voiceSummary =
      'Senior full-stack engineer with 6+ years experience in TypeScript, React, and distributed cloud systems.';
    await voiceInput.fill(voiceSummary);
    await expect(saveBtn).toBeEnabled();

    // Click Save & Continue
    await saveBtn.click();

    // Verify ingest called with origin: 'user_written'
    await expect(sidepanel.locator('text=Memory bank (debug)')).toBeVisible({ timeout: 5000 });
    expect(ingestCallBody).not.toBeNull();
    expect(ingestCallBody.text).toBe(voiceSummary);
    expect(ingestCallBody.origin).toBe('user_written');
  });

  test('Voice seeding: clicking Skip proceeds directly to main app entry', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true, onboardingCompleted: false });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Intercept storage upload & ingest for Step 1
    await sidepanel.route('**/storage/v1/object/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'ok' }) });
    });
    await sidepanel.route('**/functions/v1/ingest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documentId: 'doc-123', chunkCount: 3 }),
      });
    });

    // Upload resume
    const fileInput = sidepanel.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 content'),
    });

    // Voice step appears
    await expect(sidepanel.locator('[data-testid="onboarding-voice-step"]')).toBeVisible({ timeout: 5000 });

    // Click Skip
    const skipBtn = sidepanel.locator('[data-testid="voice-seed-skip-btn"]');
    await skipBtn.click();

    // Verify main view is rendered smoothly
    await expect(sidepanel.locator('text=Memory bank (debug)')).toBeVisible({ timeout: 5000 });
  });
});
