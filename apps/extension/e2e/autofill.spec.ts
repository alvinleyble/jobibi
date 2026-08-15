import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, seedSession, getAtsUrl, type TestExtensionContext } from './helpers/extension';

test.describe('Auto-Fill (S11) Injection', () => {
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

  test('Beta tester: clicking Insert fills DOM element via native setter and dispatches input/change/blur', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Mock suggest Edge function to return a drafted answer
    const draftAnswer = 'I have extensive full-stack experience building reliable web applications using TypeScript and React.';
    await sidepanel.route('**/functions/v1/suggest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'draft',
          answer: draftAnswer,
          skeleton: ['6 years full stack', 'TypeScript & React expertise'],
          sources: [{ kind: 'resume', label: 'Resume', ref: 'chunk-1' }],
        }),
      });
    });

    // Open JobStreet application page
    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    // Instrument DOM events on the target textarea in atsPage
    await atsPage.evaluate(() => {
      const target = document.querySelector('#PH_Q_101_V1') as HTMLTextAreaElement;
      (window as any).__EVENT_LOG__ = [];
      if (target) {
        target.addEventListener('input', (e) => {
          (window as any).__EVENT_LOG__.push({ type: 'input', value: (e.target as HTMLTextAreaElement).value });
        });
        target.addEventListener('change', (e) => {
          (window as any).__EVENT_LOG__.push({ type: 'change', value: (e.target as HTMLTextAreaElement).value });
        });
        target.addEventListener('blur', (e) => {
          (window as any).__EVENT_LOG__.push({ type: 'blur', value: (e.target as HTMLTextAreaElement).value });
        });
      }
    });

    // Bring sidepanel forward and verify question is extracted
    await sidepanel.bringToFront();
    const qCard = sidepanel.locator('[data-testid="question-card"]', {
      hasText: 'Why do you want to work at TechCorp?',
    });
    await expect(qCard).toBeVisible({ timeout: 7000 });

    // Click Suggest
    await qCard.locator('[data-testid="suggest-btn"]').click();

    // Verify draft appears
    await expect(qCard.locator(`text=${draftAnswer}`)).toBeVisible({ timeout: 5000 });

    // Verify Insert button exists for beta tester
    const insertBtn = qCard.locator('button', { hasText: 'Insert' });
    await expect(insertBtn).toBeVisible();

    // Click Insert
    await insertBtn.click();

    // Verify button state transitions to Inserted ✓
    await expect(qCard.locator('button', { hasText: 'Inserted ✓' })).toBeVisible({ timeout: 5000 });

    // Verify DOM value in ATS page
    const targetValue = await atsPage.locator('#PH_Q_101_V1').inputValue();
    expect(targetValue).toBe(draftAnswer);

    // Verify input, change, and blur events were dispatched
    const eventLog = await atsPage.evaluate(() => (window as any).__EVENT_LOG__);
    expect(eventLog.some((e: any) => e.type === 'input' && e.value === draftAnswer)).toBe(true);
    expect(eventLog.some((e: any) => e.type === 'change' && e.value === draftAnswer)).toBe(true);
    expect(eventLog.some((e: any) => e.type === 'blur')).toBe(true);
  });

  test('Non-beta tester: Insert 🔒 PRO button is rendered on draft cards and shows educational notice on click', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: false });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    const draftAnswer = 'Non-beta tester drafted answer text.';
    await sidepanel.route('**/functions/v1/suggest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'draft',
          answer: draftAnswer,
          skeleton: ['Points'],
          sources: [],
        }),
      });
    });

    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();
    const qCard = sidepanel.locator('[data-testid="question-card"]', {
      hasText: 'Why do you want to work at TechCorp?',
    });
    await expect(qCard).toBeVisible({ timeout: 7000 });

    await qCard.locator('[data-testid="suggest-btn"]').click();
    await expect(qCard.locator(`text=${draftAnswer}`)).toBeVisible({ timeout: 5000 });

    // Insert 🔒 PRO button should be present for non-beta users
    const lockedBtn = qCard.locator('button', { hasText: 'Insert' });
    await expect(lockedBtn).toBeVisible();
    await expect(lockedBtn.locator('text=🔒 PRO')).toBeVisible();

    // Clicking shows educational toast notice
    await lockedBtn.click();
    await expect(sidepanel.locator('text=1-Click Auto-Fill is a Pro feature (Included in Beta)')).toBeVisible({ timeout: 4000 });
  });
});
