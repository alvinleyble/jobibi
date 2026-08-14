import { chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveExtensionPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'apps/extension/.output/chrome-mv3'),
    path.resolve(process.cwd(), '.output/chrome-mv3'),
    path.resolve(__dirname, '../../.output/chrome-mv3'),
    path.resolve(__dirname, '../../../apps/extension/.output/chrome-mv3'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'manifest.json'))) {
      return c;
    }
  }

  throw new Error(
    `Built extension manifest.json not found in candidates: ${candidates.join(', ')}. Run 'pnpm --filter @jobibi/extension build' first.`,
  );
}

export const EXTENSION_PATH = resolveExtensionPath();

export interface TestExtensionContext {
  context: BrowserContext;
  extensionId: string;
  userDataDir: string;
  close: () => Promise<void>;
}

export interface SeedSessionOptions {
  isBetaTester?: boolean;
  email?: string;
  userId?: string;
}

export async function launchExtensionContext(options?: {
  userDataDir?: string;
}): Promise<TestExtensionContext> {
  const userDataDir = options?.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'jobibi-pw-e2e-'));
  const extPath = resolveExtensionPath();

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--host-resolver-rules=MAP * 127.0.0.1',
      '--no-sandbox',
      '--disable-gpu',
    ],
  });

  let extensionId = '';

  // 1. Check existing service workers
  for (const worker of context.serviceWorkers()) {
    const match = worker.url().match(/chrome-extension:\/\/([a-z0-9_-]+)\//i);
    if (match && match[1]) {
      extensionId = match[1];
      break;
    }
  }

  // 2. Wait for service worker if not ready yet
  if (!extensionId) {
    const worker = await context.waitForEvent('serviceworker', { timeout: 4000 }).catch(() => null);
    if (worker) {
      const match = worker.url().match(/chrome-extension:\/\/([a-z0-9_-]+)\//i);
      if (match && match[1]) {
        extensionId = match[1];
      }
    }
  }

  // 3. Fallback via CDP targets
  if (!extensionId) {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const t of targetInfos) {
      const match = (t.url || '').match(/chrome-extension:\/\/([a-z0-9_-]+)\//i);
      if (match && match[1]) {
        extensionId = match[1];
        break;
      }
    }
    await page.close();
  }

  if (!extensionId) {
    throw new Error('Failed to discover Chrome extension ID in Playwright Chromium context');
  }

  return {
    context,
    extensionId,
    userDataDir,
    close: async () => {
      await context.close().catch(() => {});
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

export async function openSidepanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

export async function seedSession(
  sidepanelPage: Page,
  options: SeedSessionOptions = {},
): Promise<void> {
  const isBeta = options.isBetaTester ?? true;
  const email = options.email || 'beta-tester@example.com';
  const userId = options.userId || 'test-user-e2e-id';

  const mockSession = {
    access_token: 'mock-access-token-e2e',
    refresh_token: 'mock-refresh-token-e2e',
    expires_at: 9999999999,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      email,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-08-14T00:00:00Z',
    },
  };

  // Intercept profile query for is_beta_tester
  await sidepanelPage.route('**/rest/v1/profiles*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: userId,
        is_beta_tester: isBeta,
        email,
      }),
    });
  });

  // Also intercept any storage / documents / facts REST calls with empty/valid responses
  await sidepanelPage.route('**/rest/v1/documents*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await sidepanelPage.route('**/rest/v1/sensitive_facts*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await sidepanelPage.route('**/rest/v1/memory_chunks*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Inject session into chrome.storage.local
  await sidepanelPage.evaluate(
    ({ session }) => {
      return new Promise<void>((resolve) => {
        const sessionStr = JSON.stringify(session);
        const data: Record<string, string> = {
          'sb-kbpojtjemftqwgmrnbdq-auth-token': sessionStr,
          'sb-127-auth-token': sessionStr,
          'sb-localhost-auth-token': sessionStr,
        };
        const chromeObj = (globalThis as unknown as { chrome?: { storage?: { local?: { set: (d: any, cb: () => void) => void } } } }).chrome;
        if (chromeObj?.storage?.local) {
          chromeObj.storage.local.set(data, () => resolve());
        } else {
          resolve();
        }
      });
    },
    { session: mockSession },
  );

  // Allow storage watcher in useSession to trigger
  await sidepanelPage.waitForTimeout(200);
}

export type AtsType = 'jobstreet' | 'indeed' | 'linkedin' | 'generic';

export function getAtsUrl(atsType: AtsType, port: number): string {
  switch (atsType) {
    case 'jobstreet':
      return `http://ph.jobstreet.com:${port}/apply/jobstreet-apply.html`;
    case 'indeed':
      return `http://smartapply.indeed.com:${port}/beta/indeedapply/form/questions-module/questions/1`;
    case 'linkedin':
      return `http://www.linkedin.com:${port}/jobs/view/123`;
    case 'generic':
      return `http://localhost:${port}/generic-apply.html`;
  }
}
