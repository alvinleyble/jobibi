#!/usr/bin/env node
/**
 * Mint a Supabase session for the fixed verification user.
 *
 * Uses the anon key only (signInWithPassword, falling back to signUp if the
 * user does not yet exist). Derives the storageKey live via
 * createClient(url, anonKey).auth.storageKey so the caller never hardcodes
 * the project ref.
 *
 * Inputs (env):
 *   WXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
 *   WXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
 *   JOBIBI_E2E_USER        (default: jobibi-verify-fixed@example.com)
 *   JOBIBI_E2E_PASSWORD    (required)
 *
 * Outputs JSON to stdout: { session, storageKey, userId, email }
 * Also writes session JSON to --out file if given.
 *
 * Standalone: node scripts/verify-chrome-lane/mint-session.mjs
 * Lane usage: verify.sh inlines the same logic via
 *   corepack pnpm --filter @jobibi/extension exec node --input-type=module -e
 * so pnpm isolation does not matter. This file's file:// fallback keeps the
 * standalone path working regardless of how it is invoked.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

let createClient;
try {
  ({ createClient } = await import('@supabase/supabase-js'));
} catch {
  const mjsPath = join(repoRoot, 'apps', 'extension', 'node_modules', '@supabase', 'supabase-js', 'dist', 'index.mjs');
  const mod = await import('file://' + mjsPath);
  createClient = mod.createClient;
}

function getEnv(name, fallback) {
  return process.env[name] ?? fallback;
}

const url = getEnv('WXT_PUBLIC_SUPABASE_URL', getEnv('SUPABASE_URL', ''));
const anonKey = getEnv('WXT_PUBLIC_SUPABASE_ANON_KEY', getEnv('SUPABASE_ANON_KEY', ''));
const email = getEnv('JOBIBI_E2E_USER', 'jobibi-verify-fixed@example.com');
const password = getEnv('JOBIBI_E2E_PASSWORD', '');

if (!url || !anonKey) {
  console.error('[mint-session] Missing WXT_PUBLIC_SUPABASE_URL / WXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY).');
  console.error('  The lane reads these from .env via WXT_PUBLIC_*; ensure .env is present or the env vars are exported.');
  process.exit(2);
}
if (!password) {
  console.error('[mint-session] Missing JOBIBI_E2E_PASSWORD env var.');
  console.error('  Set JOBIBI_E2E_PASSWORD to the password for the fixed test user (jobibi-verify-fixed@example.com).');
  console.error('  This value is never committed; a dispatcher must supply it as a CI secret.');
  process.exit(2);
}

const supabase = createClient(url, anonKey);
const storageKey = supabase.auth['storageKey'] ?? `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;

async function mint() {
  let { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = (error.message || '').toLowerCase();
    const notFound = msg.includes('invalid login') || msg.includes('invalid') || msg.includes('not found') || error.status === 400;
    if (notFound) {
      console.error(`[mint-session] signInWithPassword failed (${error.message}); trying signUp for ${email} ...`);
      const signUp = await supabase.auth.signUp({ email, password });
      if (signUp.error) {
        console.error(`[mint-session] signUp failed: ${signUp.error.message}`);
        process.exit(1);
      }
      if (signUp.data.session) {
        data = signUp.data;
        error = null;
      } else {
        const retry = await supabase.auth.signInWithPassword({ email, password });
        if (retry.error) {
          console.error(`[mint-session] retry signIn after signUp failed: ${retry.error.message}`);
          process.exit(1);
        }
        data = retry.data;
        error = null;
      }
    } else {
      console.error(`[mint-session] signInWithPassword failed: ${error.message}`);
      process.exit(1);
    }
  }

  if (!data?.session) {
    console.error('[mint-session] No session returned after auth.');
    process.exit(1);
  }

  const out = {
    session: data.session,
    storageKey,
    userId: data.session.user.id,
    email: data.session.user.email,
  };

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    const outPath = process.argv[outIdx + 1];
    writeFileSync(outPath, JSON.stringify(data.session), 'utf8');
    console.error(`[mint-session] Wrote session JSON to ${outPath} (storageKey=${storageKey}, user=${out.email})`);
  }

  console.log(JSON.stringify(out));
}

await mint();
