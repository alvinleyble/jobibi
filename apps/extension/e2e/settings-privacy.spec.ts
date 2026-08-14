import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, seedSession, getAtsUrl, type TestExtensionContext } from './helpers/extension';

test.describe('Settings, Privacy Surface & Caps (S12)', () => {
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

  test('Settings panel: toggles via gear icon in header and displays 3 sections', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await expect(sidepanel.locator('text=Signed in as beta-tester@example.com')).toBeVisible({ timeout: 5000 });

    // Click Settings gear button
    const settingsBtn = sidepanel.locator('[data-testid="settings-btn"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Verify Settings view is rendered with 3 sections
    await expect(sidepanel.locator('text=Settings & Privacy')).toBeVisible();
    await expect(sidepanel.locator('text=Drafting Preferences')).toBeVisible();
    await expect(sidepanel.locator('text=Usage & Quotas')).toBeVisible();
    await expect(sidepanel.locator('text=Privacy Surface (D12)')).toBeVisible();

    // Click Back button to return to Main panel
    const backBtn = sidepanel.locator('[data-testid="settings-back-btn"]');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Verify Main view returns
    await expect(sidepanel.locator('text=Memory bank (debug)')).toBeVisible();
  });

  test('Drafting Preferences: non-beta users see Medium/Long locked, beta testers can toggle', async () => {
    // 1. Test as non-beta user
    const sidepanelNonBeta = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanelNonBeta, { isBetaTester: false });
    await sidepanelNonBeta.reload();
    await sidepanelNonBeta.waitForLoadState('domcontentloaded');

    await sidepanelNonBeta.locator('[data-testid="settings-btn"]').click();
    await expect(sidepanelNonBeta.locator('text=Drafting Preferences')).toBeVisible();

    const shortRadio = sidepanelNonBeta.locator('input[value="short"]');
    const mediumRadio = sidepanelNonBeta.locator('input[value="medium"]');
    const longRadio = sidepanelNonBeta.locator('input[value="long"]');

    await expect(shortRadio).toBeEnabled();
    await expect(mediumRadio).toBeDisabled();
    await expect(longRadio).toBeDisabled();
    await expect(sidepanelNonBeta.locator('text=🔒 Premium')).toHaveCount(2);

    await sidepanelNonBeta.close();

    // 2. Test as beta tester
    const sidepanelBeta = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanelBeta, { isBetaTester: true });
    await sidepanelBeta.reload();
    await sidepanelBeta.waitForLoadState('domcontentloaded');

    await sidepanelBeta.locator('[data-testid="settings-btn"]').click();
    const betaMediumRadio = sidepanelBeta.locator('input[value="medium"]');
    await expect(betaMediumRadio).toBeEnabled();

    // Click medium option
    await betaMediumRadio.click();
    await expect(betaMediumRadio).toBeChecked();
    await expect(sidepanelBeta.locator('text=Saved ✓')).toBeVisible({ timeout: 4000 });
  });

  test('Usage & Quotas: displays daily suggestions and cover letter quotas', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: false });

    // Mock gate_decisions query (5 decisions today)
    await sidepanel.route('**/rest/v1/gate_decisions*', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-range': '0-4/5' },
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'gd-1' }, { id: 'gd-2' }, { id: 'gd-3' }, { id: 'gd-4' }, { id: 'gd-5' }]),
      });
    });

    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await sidepanel.locator('[data-testid="settings-btn"]').click();

    // Check Daily quota indicator
    await expect(sidepanel.locator('[data-testid="daily-quota-status"]')).toBeVisible();
    await expect(sidepanel.locator('text=⚡ 10 / 15 remaining today')).toBeVisible();

    // Check Cover Letter quota indicator
    await expect(sidepanel.locator('[data-testid="weekly-cover-quota-status"]')).toBeVisible();
    await expect(sidepanel.locator('text=📄 1 / 1 remaining this week')).toBeVisible();
  });

  test('Privacy Surface: Delete Everything opens confirmation modal requiring "DELETE"', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await sidepanel.locator('[data-testid="settings-btn"]').click();

    // Click Delete Everything button
    await sidepanel.locator('[data-testid="delete-everything-btn"]').click();

    // Modal opens
    await expect(sidepanel.locator('text=Permanently Delete Everything?')).toBeVisible();
    const confirmBtn = sidepanel.locator('[data-testid="confirm-delete-everything-btn"]');
    await expect(confirmBtn).toBeDisabled();

    // Type incorrect text
    const confirmInput = sidepanel.locator('[data-testid="delete-confirm-input"]');
    await confirmInput.fill('DEL');
    await expect(confirmBtn).toBeDisabled();

    // Type DELETE
    await confirmInput.fill('DELETE');
    await expect(confirmBtn).toBeEnabled();
  });

  test('Memory Bank: displays stored Q&A answers and supports per-answer deletion (D12)', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });

    // Mock initial qa_pairs response
    let qaDeleted = false;
    await sidepanel.route('**/rest/v1/qa_pairs*', async (route) => {
      if (route.request().method() === 'DELETE') {
        qaDeleted = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      if (qaDeleted) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'qa-123',
              question_label: 'Tell us about your background with TypeScript',
              answer_text: 'I have 5 years building scalable web applications with TypeScript and React.',
              origin: 'user_written',
              created_at: '2026-08-14T00:00:00Z',
            },
          ]),
        });
      }
    });

    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Verify stored answer card is visible in Memory Bank
    await expect(sidepanel.locator('text=Stored Answers (Q&A) (1)')).toBeVisible({ timeout: 5000 });
    await expect(sidepanel.locator('text=Q: Tell us about your background with TypeScript')).toBeVisible();
    await expect(sidepanel.locator('text=A: I have 5 years building scalable web applications with TypeScript and React.')).toBeVisible();

    // Click trash button to delete the answer
    const deleteBtn = sidepanel.locator('[data-testid="delete-qa-btn-qa-123"]');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Verify answer is purged
    await expect(sidepanel.locator('text=Stored Answers (Q&A) (0)')).toBeVisible({ timeout: 5000 });
    await expect(sidepanel.locator('text=No stored Q&A answers yet.')).toBeVisible();
  });

  test('Media Branching: video questions render dedicated "Video Talking Points & Script" card', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Mock suggest Edge function returning video output
    await sidepanel.route('**/functions/v1/suggest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outcome: 'draft',
          isVideo: true,
          videoTalkingPoints: [
            'Lead with 6 years experience in web platforms',
            'Highlight TypeScript architecture leadership',
            'Close with enthusiasm for product mission',
          ],
          videoScript: 'Hi, I am excited to apply! Over the past 6 years, I have architected high-throughput web apps...',
          answer: 'Hi, I am excited to apply! Over the past 6 years, I have architected high-throughput web apps...',
          skeleton: [
            'Lead with 6 years experience in web platforms',
            'Highlight TypeScript architecture leadership',
            'Close with enthusiasm for product mission',
          ],
          sources: [{ kind: 'memory_chunk', label: 'Resume', ref: 'doc-1' }],
        }),
      });
    });

    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();

    const questionCard = sidepanel.locator('li', { hasText: 'Why do you want to work at TechCorp?' });
    await expect(questionCard).toBeVisible({ timeout: 7000 });

    // Click Suggest
    await questionCard.locator('button', { hasText: 'Suggest' }).click();

    // Verify dedicated Video Talking Points & Script card renders
    await expect(sidepanel.locator('[data-testid="video-script-card"]')).toBeVisible({ timeout: 5000 });
    await expect(sidepanel.locator('text=🎥 Video Talking Points & Script')).toBeVisible();
    await expect(sidepanel.locator('text=Key Talking Points')).toBeVisible();
    await expect(sidepanel.locator('text=Lead with 6 years experience in web platforms')).toBeVisible();
    await expect(sidepanel.locator('text=60-Second Speaking Script')).toBeVisible();
    await expect(sidepanel.locator('[data-testid="copy-talking-points-btn"]')).toBeVisible();
    await expect(sidepanel.locator('[data-testid="copy-video-script-btn"]')).toBeVisible();
  });
});
