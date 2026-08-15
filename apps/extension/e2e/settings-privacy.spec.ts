import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, seedSession, getAtsUrl, type TestExtensionContext } from './helpers/extension';

test.describe('Settings, Privacy Surface & Caps (S12 & S13)', () => {
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

  test('3-Tab Navigation & Sub-screens: pill switcher and Account / Usage & Quotas drill-ins work', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    // Verify header wordmark and avatar
    await expect(sidepanel.locator('text=Jobibi')).toBeVisible({ timeout: 5000 });
    const avatarBtn = sidepanel.locator('[data-testid="avatar-btn"]');
    await expect(avatarBtn).toBeVisible();

    // 1. Test Account drill-in via header avatar
    await avatarBtn.click();
    await expect(sidepanel.locator('text=beta-tester@example.com')).toBeVisible();
    await expect(sidepanel.locator('text=BETA TESTER')).toBeVisible();
    await expect(sidepanel.locator('[data-testid="sign-out-btn"]')).toBeVisible();

    // Back to root
    const backBtn = sidepanel.locator('[data-testid="settings-back-btn"]');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // 2. Test Settings tab
    const settingsTab = sidepanel.locator('[data-testid="tab-settings-btn"]');
    await expect(settingsTab).toBeVisible();
    await settingsTab.click();

    await expect(sidepanel.locator('text=Drafting length')).toBeVisible();
    await expect(sidepanel.locator('[data-testid="settings-usage-btn"]')).toBeVisible();
    await expect(sidepanel.locator('[data-testid="export-data-btn"]')).toBeVisible();
    await expect(sidepanel.locator('[data-testid="delete-everything-btn"]')).toBeVisible();

    // 3. Drill into Usage & Quotas sub-screen
    await sidepanel.locator('[data-testid="settings-usage-btn"]').click();
    await expect(sidepanel.locator('text=Usage & quotas')).toBeVisible();
    await expect(sidepanel.locator('[data-testid="daily-quota-status"]')).toBeVisible();

    // Back from Usage & Quotas to Settings
    await sidepanel.locator('[data-testid="settings-back-btn"]').click();
    await expect(sidepanel.locator('text=Drafting length')).toBeVisible();

    // 4. Switch to Memory tab
    await sidepanel.locator('[data-testid="tab-memory-btn"]').click();
    await expect(sidepanel.locator('text=Upload a document')).toBeVisible();
    await expect(sidepanel.locator('text=Draft a cover letter')).toBeVisible();

    // 5. Switch to Suggest tab
    await sidepanel.locator('[data-testid="tab-suggest-btn"]').click();
    await expect(sidepanel.locator('[data-screen-label="Suggest"]')).toBeVisible();
  });

  test('Drafting Preferences: non-beta users see Medium/Long locked, beta testers can toggle', async () => {
    // 1. Test as non-beta user
    const sidepanelNonBeta = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanelNonBeta, { isBetaTester: false });
    await sidepanelNonBeta.reload();
    await sidepanelNonBeta.waitForLoadState('domcontentloaded');

    await sidepanelNonBeta.locator('[data-testid="tab-settings-btn"]').click();
    await expect(sidepanelNonBeta.locator('text=Drafting length')).toBeVisible();

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

    await sidepanelBeta.locator('[data-testid="tab-settings-btn"]').click();
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

    // Go to Settings -> Usage & quotas
    await sidepanel.locator('[data-testid="tab-settings-btn"]').click();
    await sidepanel.locator('[data-testid="settings-usage-btn"]').click();

    // Check Daily quota indicator
    await expect(sidepanel.locator('[data-testid="daily-quota-status"]')).toBeVisible();
    await expect(sidepanel.locator('text=⚡ 5 of 15 used today (10 remaining)')).toBeVisible();

    // Check Cover Letter quota indicator
    await expect(sidepanel.locator('[data-testid="weekly-cover-quota-status"]')).toBeVisible();
    await expect(sidepanel.locator('text=📄 0 of 1 used this week (1 remaining)')).toBeVisible();
  });

  test('Privacy Surface: Delete Everything opens confirmation modal requiring "DELETE"', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await sidepanel.locator('[data-testid="tab-settings-btn"]').click();

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

    // Go to Memory tab
    await sidepanel.locator('[data-testid="tab-memory-btn"]').click();

    // Verify stored answer card is visible in Memory Bank
    await expect(sidepanel.locator('text=Stored answers · 1')).toBeVisible({ timeout: 5000 });
    await expect(sidepanel.locator('text=Q: Tell us about your background with TypeScript')).toBeVisible();
    await expect(sidepanel.locator('text=A: I have 5 years building scalable web applications with TypeScript and React.')).toBeVisible();

    // Click delete button to delete the answer
    const deleteBtn = sidepanel.locator('[data-testid="delete-qa-btn-qa-123"]');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Verify answer is purged
    await expect(sidepanel.locator('text=Stored answers · 0')).toBeVisible({ timeout: 5000 });
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

    const questionCard = sidepanel.locator('[data-testid="question-card"]', {
      hasText: 'Why do you want to work at TechCorp?',
    });
    await expect(questionCard).toBeVisible({ timeout: 7000 });

    // Click Suggest
    await questionCard.locator('[data-testid="suggest-btn"]').click();

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
