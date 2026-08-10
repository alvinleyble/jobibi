# Chrome verification lane (headless, dispatched-worker)

Builds the Jobibi extension, launches it in a real **extension-capable** headless Chrome-for-Testing instance, signs in via a seeded test session, and drives + verifies the S3 UI (pre-sign-in gate through post-sign-in upload/intake/memory-bank) via `chrome-devtools-axi`. This is internal verification tooling, not product code.

Based on the two scout reports:

- `data/jobibi-chrome-verification-lane-scout/report.md` — base lane mechanics (per-dispatch `chrome` binary fetch, `--headless=new --load-extension`, `CHROME_DEVTOOLS_AXI_BROWSER_URL`, runtime ID by title, per-dispatch `SESSION`/port).
- `data/jobibi-verification-lane-status-scout/report.md` — seeded-session gap closure (anon-key `signInWithPassword` → `signUp` fallback + `chrome.storage.local` injection under the `sb-<ref>-auth-token` key derived live).
- `data/jobibi-verification-lane-status-scout/captain-decision.md` — ship headless-only (Option A), fixed test user, password from env.

## What it verifies

1. **Pre-sign-in:** sidepanel at `chrome-extension://<id>/sidepanel.html` renders "Sign in to Jobibi", the email textbox, and "Send sign-in link".
2. **Post-sign-in:** after injecting a minted session, the same panel flips (via the `sb-` storage watcher in `useSession.ts`) to "Signed in as …" plus the S3 headings "Upload a document", "Sixty-second intake", and "Memory bank (debug)" — the scout report §1.3 snapshot is the oracle.
3. **Live S3 flow:** fills the four intake fields and clicks Save, asserting "Saved." (or the facts appearing in the memory bank / Supabase) to prove the lane exercises real UI, not just a label check.

## Required env vars

Supabase URL/anon key come from `.env` per existing conventions (`WXT_PUBLIC_SUPABASE_URL`, `WXT_PUBLIC_SUPABASE_ANON_KEY`) — the lane sources `.env` automatically if present, or reads them from the environment. These are public values already baked into the extension bundle.

New for this lane:

| Var | Required | Default | Notes |
|---|---|---|---|
| `JOBIBI_E2E_PASSWORD` | **yes** | — | Password for the fixed test user `jobibi-verify-fixed@example.com` (`b82a30c2-c4b2-40f6-9f34-5beb7d2fd149`) in project `kbpojtjemftqwgmrnbdq`. Never committed. A dispatcher must supply it as a CI secret. |
| `JOBIBI_E2E_USER` | no | `jobibi-verify-fixed@example.com` | Override if the test user email ever changes. |

Per-dispatch collision avoidance (for concurrent workers on one host) is handled automatically, but can be pinned:

| Var | Default | Purpose |
|---|---|---|
| `JOBIBI_VERIFY_PORT` | random free 9300–9899 | `--remote-debugging-port` for the launched Chrome |
| `CHROME_DEVTOOLS_AXI_SESSION` | `jobibi-verify-<worktree>-<pid>` | `chrome-devtools-axi` bridge session (isolates the `9224`-style bridge port per dispatch) |
| `JOBIBI_VERIFY_SKIP_BUILD` | `0` | Set `1` to skip `pnpm build` when iterating on a prior build at `apps/extension/.output/chrome-mv3` |

## Usage

```bash
# One-time: ensure deps are installed
corepack pnpm install

# Run the lane (headless-only, per the ship decision)
JOBIBI_E2E_PASSWORD='...' ./scripts/verify-chrome-lane/verify.sh

# Or with an explicit per-worktree identity (how a dispatcher invokes it per worktree):
JOBIBI_E2E_PASSWORD='...' CHROME_DEVTOOLS_AXI_SESSION="jobibi-verify-$WORKTREE_ID" JOBIBI_VERIFY_PORT=9342 ./scripts/verify-chrome-lane/verify.sh

# Quick iteration without rebuilding the extension:
JOBIBI_E2E_PASSWORD='...' JOBIBI_VERIFY_SKIP_BUILD=1 ./scripts/verify-chrome-lane/verify.sh
```

Exit code `0` means the lane passed (both S3 surfaces and at least the intake flow). Non-zero means a gate failed; the script prints the snapshot that caused the failure.

## What the lane does

1. `corepack pnpm --filter @jobibi/extension build` (unless `SKIP_BUILD=1`).
2. `npx puppeteer browsers install chrome` — idempotent, uses the Chrome-for-Testing binary (system `Google Chrome.app` ignores `--load-extension`).
3. `node scripts/verify-chrome-lane/mint-session.mjs` — `signInWithPassword` with the anon key, falling back to `signUp` if the user does not yet exist; derives `storageKey` live via `createClient(url, anonKey).auth['storageKey']`.
4. Launches: `Google Chrome for Testing --headless=new --remote-debugging-port=<port> --user-data-dir=<scratch> --load-extension=<abs .output/chrome-mv3> about:blank`.
5. Resolves the extension runtime ID by opening each `chrome-extension://<id>/sidepanel.html` and checking the page title/snapshot (never hardcodes an ID).
6. Opens the sidepanel, asserts the pre-sign-in gate, then injects the session via `chrome-devtools-axi eval` → `chrome.storage.local.set({[storageKey]: JSON.stringify(session)})`.
7. Re-opens the sidepanel, snapshots, and asserts the signed-in S3 UI; then drives the intake form.
8. Tears down: `chrome-devtools-axi stop`, kills Chrome, removes the scratch profile dir and any minted session temp files. Never commits secrets.

## Headed mode

Out of scope for this task per the captain's decision — the lane ships headless-only. A headed/on-request flag can be added later if a real debugging need comes up (on Linux it would also require `Xvfb`).

## Mint helper standalone

`mint-session.mjs` can be run outside the lane:

```bash
JOBIBI_E2E_PASSWORD='...' node scripts/verify-chrome-lane/mint-session.mjs
# → { "session": {...}, "storageKey": "sb-kbpojtjemftqwgmrnbdq-auth-token", ... }

JOBIBI_E2E_PASSWORD='...' node scripts/verify-chrome-lane/mint-session.mjs --out /tmp/session.json
```
