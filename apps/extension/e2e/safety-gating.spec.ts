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

  test('Sensitive gating (D17): sensitive fact outcome renders confirm card and omits Insert button', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Mock suggest Edge function returning outcome: 'confirm'
    await sidepanel.route('**/functions/v1/suggest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'confirm',
          sensitiveKind: 'salary_expectation',
          sensitiveVia: 'rule',
          sensitiveFact: {
            id: 'fact-salary-1',
            kind: 'salary_expectation',
            value: '$130,000 - $140,000 USD',
            stated_at: '2026-08-14T00:00:00Z',
            confirmed_at: null,
            provenanceLine: 'Stated during sixty-second intake',
          },
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

    // Click Suggest on sensitive question
    await salaryCard.locator('[data-testid="suggest-btn"]').click();

    // Verify sensitive confirm card UI renders
    await expect(salaryCard.locator('text=Always-confirm — sensitive field')).toBeVisible({ timeout: 5000 });
    await expect(salaryCard.locator('text=$130,000 - $140,000 USD')).toBeVisible();
    await expect(salaryCard.locator('text=Stated during sixty-second intake')).toBeVisible();
    await expect(salaryCard.locator('button', { hasText: 'Confirm still true' })).toBeVisible();
    await expect(salaryCard.locator('text=This field is never drafted or auto-filled.')).toBeVisible();

    // Verify Insert button is NOT present
    await expect(salaryCard.locator('button', { hasText: 'Insert' })).toHaveCount(0);
  });
});
