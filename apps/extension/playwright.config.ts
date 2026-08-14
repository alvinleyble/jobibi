import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    actionTimeout: 10000,
  },
});
