import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

function getPrSuffix(): string {
  const envSuffix = process.env.JOBIBI_NAME_SUFFIX;
  if (envSuffix) return envSuffix.startsWith(' ') ? envSuffix : ` ${envSuffix}`;
  const prEnv = process.env.JOBIBI_PR || process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER;
  if (prEnv) {
    const n = prEnv.replace(/[^0-9]/g, '');
    if (n) return ` [PR#${n}]`;
  }
  try {
    const n = execSync('gh pr view --json number --jq .number', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    })
      .toString()
      .trim();
    if (n && /^\d+$/.test(n)) return ` [PR#${n}]`;
  } catch {}
  try {
    const branch = execSync('git branch --show-current', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    })
      .toString()
      .trim();
    if (branch && branch !== 'main' && branch !== 'HEAD' && branch !== '') {
      const last = branch.split('/').pop() || branch;
      const short = last.slice(0, 24).replace(/[^a-zA-Z0-9._-]/g, '-');
      if (short) return ` [${short}]`;
    }
  } catch {}
  return '';
}

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
    name: `Jobibi${getPrSuffix()}`,
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
