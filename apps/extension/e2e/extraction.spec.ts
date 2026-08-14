import { test, expect } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './helpers/server';
import { launchExtensionContext, openSidepanel, seedSession, getAtsUrl, type TestExtensionContext } from './helpers/extension';

test.describe('Extraction & Sidepanel Display', () => {
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

  test('JobStreet: extracts employer questions and displays in sidepanel with confidence badges', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await expect(sidepanel.locator('text=Signed in as beta-tester@example.com')).toBeVisible({ timeout: 5000 });

    // Open JobStreet application page
    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('jobstreet', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Why do you want to work at TechCorp?')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=Describe your experience with TypeScript and React')).toBeVisible();
    await expect(sidepanel.locator('text=What are your salary expectations?')).toBeVisible();

    // Verify confidence badges
    await expect(sidepanel.locator('text=high · 1.00')).toBeVisible();
    await expect(sidepanel.locator('text=medium · 0.85')).toBeVisible();
    await expect(sidepanel.locator('text=low · 0.50')).toBeVisible();
  });

  test('Indeed: extracts SmartApply questions module and displays in sidepanel', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await expect(sidepanel.locator('text=Signed in as beta-tester@example.com')).toBeVisible({ timeout: 5000 });

    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('indeed', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=How many years of work experience do you have with Playwright?')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=What is your desired monthly salary?')).toBeVisible();
  });

  test('LinkedIn Easy Apply: extracts modal questions and displays in sidepanel', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await expect(sidepanel.locator('text=Signed in as beta-tester@example.com')).toBeVisible({ timeout: 5000 });

    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('linkedin', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=Tell us about a time you improved test suite reliability.')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=What is your expected annual salary?')).toBeVisible();
  });

  test('Generic ATS: extracts form questions via fallback adapter', async () => {
    const sidepanel = await openSidepanel(ext.context, ext.extensionId);
    await seedSession(sidepanel, { isBetaTester: true });
    await sidepanel.reload();
    await sidepanel.waitForLoadState('domcontentloaded');

    await expect(sidepanel.locator('text=Signed in as beta-tester@example.com')).toBeVisible({ timeout: 5000 });

    const atsPage = await ext.context.newPage();
    const url = getAtsUrl('generic', server.port);
    await atsPage.goto(url);
    await atsPage.waitForLoadState('domcontentloaded');

    await sidepanel.bringToFront();
    await expect(sidepanel.locator('text=What is your experience with distributed systems?')).toBeVisible({ timeout: 7000 });
    await expect(sidepanel.locator('text=Describe your proudest engineering accomplishment')).toBeVisible();
  });
});
