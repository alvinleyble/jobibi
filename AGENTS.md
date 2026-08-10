# Project agent memory

Jobibi is a Chrome extension that drafts job-application answers grounded in the user's own history.

## Where things are

| | |
|---|---|
| Vocabulary — read first | [CONTEXT.md](CONTEXT.md) |
| Why anything is the way it is | [docs/DECISIONS.md](docs/DECISIONS.md) — D1–D18, each with rejected alternatives and a revisit trigger |
| What to build, in order | [docs/build/v0.1.md](docs/build/v0.1.md) |
| Current state | [docs/build/project-build-progress.md](docs/build/project-build-progress.md) |
| System design, data model, costs | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Product intent and trust stance | [docs/PRODUCT.md](docs/PRODUCT.md) |

Use the terms in CONTEXT.md exactly. They were chosen deliberately and the `_Avoid_` lists exist because the near-synonyms mean different things here.

## Invariants — violating these is silent and expensive

These are the decisions a reasonable engineer would get wrong by instinct. Each traces to a decision record.

1. **The gate is code. The model never decides to refuse.** (D10) On a refusal the model is not called at all. On an *ask* it is called only to word the question, after code has already decided. Moving this decision into a prompt breaks the product's core promise and is not a refactor.
2. **The gate has three outcomes, not two.** Draft / **ask** / refuse. Code that treats it as a binary confidence check has reintroduced the bug the product exists to fix.
3. **Gate scoring is relative, never absolute.** (D15) Compare the top match against *that user's own* score distribution. A hardcoded cosine threshold behaves well in tests and erratically across real users with different corpus sizes.
4. **Sensitive detection is a union and runs before drafting.** (D17) Rules **or** typed-fact retrieval firing is enough. Never narrow it to an intersection to reduce false positives — a false positive costs one click, a miss puts a wrong salary figure into someone's real job application.
5. **Never train the style profile on `accepted_verbatim` answers.** (D13) They are Jobibi's own prose. Including them makes the profile converge on model tone while claiming to capture the user's voice. This failure is invisible and compounds.
6. **Re-derive the question→field mapping at capture and drop the write on mismatch.** (D16) A mis-bound adapter produces a correct-looking panel while writing wrong answers into memory permanently.
7. **Capture reads every identified question field, and only question fields.** (D12) Including questions Jobibi did not help with — otherwise every refusal is a permanent dead end. Never read fields not identified as application questions.
8. **Every drafting call carries an explicit length cap.** (D8) The chosen model runs ~2× the median output length, output dominates cost, and the beta budget is a fixed $5. This is a budget control, not styling.
9. **Log every gate decision** — both scores, the outcome, what the user did next. (D15) Calibration depends on this existing from the first shipped slice.

## Stack and tooling

- **Monorepo, pnpm:** `apps/extension` (WXT + React + TS + Tailwind), `supabase/`, `packages/shared` (types + zod schemas shared end-to-end).
- **AI:** OpenAI GPT-5.6 Luna for every model call, via strict JSON schema output. Key lives in Edge Function secrets only — the extension ships zero secrets.
- **Embeddings:** gte-small, in-process inside Edge Functions. Not a network call.
- **Database:** Supabase Postgres + pgvector, RLS on every table from table zero.
- **Extension pages reachable from outside the extension** (e.g. `callback.html`, the magic-link redirect target) must be declared under `web_accessible_resources` in `apps/extension/wxt.config.ts`. Without it, Chrome and Edge block the top-level navigation with `ERR_BLOCKED_BY_CLIENT` — this is a platform restriction on cross-origin navigation into extension pages, not a bug in the redirect itself. `apps/extension/scripts/check-manifest.mjs` runs as a `postbuild` step to catch a regression.

## Supabase — read before touching schema

Schema is managed **only** through the Supabase CLI in this repo: `supabase init`, `supabase link`, migrations committed under `supabase/migrations/`. (D7)

**Do not apply migrations or run SQL through an ambient database connection.** The operator's environment has tooling bound to a *different* production project holding real users' financial data. Migration files in git are the wall between the two. If you find yourself about to run a schema command against a connection you did not create in this repo, stop.

**Edge Functions that import shared code:** functions importing from `packages/shared` (e.g. `ingest`) resolve their npm dependencies (like `unpdf`, `fflate`) through `supabase/functions/deno.json`, wired per-function via `[functions.<name>] import_map` in `supabase/config.toml` — without that wiring, deploy fails with a "not prefixed with / or ./ or ../" bundling error. Relative imports of local `.ts` files must include the `.ts` extension (Deno requires it; `packages/shared/tsconfig.json` sets `allowImportingTsExtensions` so the same source typechecks under both Deno and `tsc`). Deploy with `supabase functions deploy <name> --use-api` — this environment has no Docker, and `--use-api` bundles server-side without it. Embeddings use the Edge Runtime's built-in `Supabase.ai.Session('gte-small')` global (no import, no network call — D5c).

Extraction/chunking logic for uploaded documents lives in `packages/shared/src/ingestion/` and is deliberately **not** re-exported from `packages/shared/src/index.ts` — that barrel is what `apps/extension` imports, and barrel-exporting pdf/docx parsing would drag `unpdf`/`fflate` into the browser bundle for a codepath that only ever runs in the `ingest` Edge Function.

## Delivery

Posture is `no-mistakes-prod-only`: product-facing work runs the full validation pipeline before a PR; internal tooling, scripts, and contributor process ship straight to a PR. Push through the gate with `git push no-mistakes <branch>`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
