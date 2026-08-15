import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, seedSession, getAtsUrl, type TestExtensionContext } from './helpers/extension';

test.describe('Safety & Confidence Gating (D16 & D17)', () => {
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

  test('Confidence gating: fields with confidence < 0.75 have Insert button disabled with explanatory tooltip', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Mock suggest Edge function
    await sidepanel.route('**/functions/v1/suggest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'draft',
          answer: 'Around $120,000 annually.',
          skeleton: ['Target salary'],
          sources: [],
        }),
      });
    });

    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();

    // Locate the low confidence question card (confidence = 0.50 via proximity)
    const lowConfCard = sidepanel.locator('[data-testid="question-card"]', {
      hasText: 'What are your salary expectations?',
    });
    await expect(lowConfCard).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('span[title="Low match quality"]')).toBeVisible();

    // Click Suggest on the low confidence field
    await lowConfCard.locator('[data-testid="suggest-btn"]').click();

    // Wait for draft card to appear
    await expect(lowConfCard.locator('text=Around $120,000 annually.')).toBeVisible({ timeout: 5000 });

    // Verify Insert button is disabled for confidence < 0.75
    const insertBtn = lowConfCard.locator('button', { hasText: 'Insert' });
    await expect(insertBtn).toBeVisible();
    await expect(insertBtn).toBeDisabled();

    // Verify explanatory tooltip is present
    const titleAttr = await insertBtn.getAttribute('title');
    expect(titleAttr).toContain('Auto-fill disabled: Low confidence mapping (< 0.75)');
  });

  test('Salary/notice dynamic refusal: salary questions return refuse outcome requiring direct input', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Mock suggest Edge function returning outcome: 'refuse' for salary (dynamic refusal, no stored fact)
    await sidepanel.route('**/functions/v1/suggest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'refuse',
          questionNorm: 'what are your salary expectations',
          questionMatch: 0,
          roleMatch: 0,
          refuseMessage: 'This asks for your salary expectation — please enter it directly. We don’t auto-suggest for salary.',
        }),
      });
    });

    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();

    const salaryCard = sidepanel.locator('[data-testid="question-card"]', {
      hasText: 'What are your salary expectations?',
    });
    await expect(salaryCard).toBeVisible({ timeout: 7000 });

    // Click Suggest on salary question
    await salaryCard.locator('[data-testid="suggest-btn"]').click();

    // Verify refusal card renders with salary-specific message
    await expect(salaryCard.locator('text=This asks for your salary expectation')).toBeVisible({ timeout: 5000 });
    await expect(salaryCard.locator('text=please enter it directly')).toBeVisible();

    // Verify Insert button is NOT present on refusal cards
    await expect(salaryCard.locator('button', { hasText: 'Insert' })).toHaveCount(0);
    // Verify no Always-Confirm violet card
    await expect(salaryCard.locator('text=Always-confirm')).toHaveCount(0);
  });
});
