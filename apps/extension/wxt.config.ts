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
    permissions: ['sidePanel', 'storage'],
  },
});
