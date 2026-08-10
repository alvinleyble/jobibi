#!/usr/bin/env node
// Regression check for the magic-link sign-in flow: Supabase's email redirect
// navigates the browser to chrome-extension://<id>/callback.html from outside
// the extension (the user's mail client). Chrome and Edge block that
// top-level navigation with ERR_BLOCKED_BY_CLIENT unless callback.html is
// declared as a web-accessible resource. If this check fails, sign-in is broken.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('../.output/chrome-mv3/manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const resources = manifest.web_accessible_resources ?? [];
const exposesCallback = resources.some((entry) => entry.resources?.includes('callback.html'));

if (!exposesCallback) {
  console.error(
    'apps/extension/scripts/check-manifest.mjs: manifest.json is missing a ' +
      'web_accessible_resources entry for callback.html. Without it, clicking the ' +
      'magic-link sign-in email is blocked with ERR_BLOCKED_BY_CLIENT. Add it back ' +
      'to the `manifest` block in wxt.config.ts.',
  );
  process.exit(1);
}

console.log('check-manifest: callback.html is web-accessible — magic-link redirect will not be blocked.');
