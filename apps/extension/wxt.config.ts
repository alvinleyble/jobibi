import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    // .env lives at the monorepo root (see .env.example there), not in
    // apps/extension — Vite's default envDir is the project root WXT runs
    // from, so without this WXT_PUBLIC_* vars silently don't load.
    envDir: fileURLToPath(new URL('../..', import.meta.url)),
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Jobibi',
    description: 'Draft job-application answers grounded in your own history.',
    permissions: ['sidePanel', 'storage', 'tabs'],
    // The Supabase magic-link email redirects here as a top-level navigation
    // from outside the extension (the user's mail client/webmail). Chrome and
    // Edge block that navigation with ERR_BLOCKED_BY_CLIENT unless the page is
    // declared web-accessible — this isn't about embedding/fetching, it's what
    // makes the external redirect itself resolve.
    web_accessible_resources: [
      {
        resources: ['callback.html'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
