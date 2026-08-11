# Jobibi — Project Build Progress

**Current state:** Phase 2 — S4.5 shipped (S1–S4.5 on `main`). S5a (suggest endpoint) is next.

- 2026-08-09 — Product vision received; stack locked (DECISIONS D1–D4: Chrome extension, cloud memory on Supabase, payments deferred, JobStreet/LinkedIn/Indeed first).
- 2026-08-09 — Documentation drafted (PRODUCT, ARCHITECTURE, DECISIONS, build plan v0.1).
- 2026-08-09 — **Design grill completed. 15 decisions taken; docs revised throughout.** Added CONTEXT.md (shared vocabulary). DECISIONS gained D10–D18 and D5 split into D5a/D5b/D5c. Build plan reordered.

## What the grill changed

**The gate has three outcomes, not two** (D10). Draft / **ask** / refuse, decided by code — the model is never consulted on refusal, and is only used to word a gap question after code has decided to ask. This is the largest change: it moves interview machinery from Phase 4 into Phase 2 and turns the cold-start problem into the growth mechanism.

**Model vendor decided: OpenAI GPT-5.6 Luna** (D5b), after evaluating Claude Sonnet 5, Mistral Large 3, Gemini 3.6 Flash, Kimi K3, and Claude Fable 5. Cost per 20-question application drops from the estimated $0.20–0.30 to **≈$0.012**, which effectively unblocks D8.

**Capture became central and got a safety guard** (D12, D13, D16). Field values are read back at submit; every stored answer records how it was produced, so the style profile never learns Jobibi's own prose back from itself; and the question→field mapping is re-derived at capture to stop a broken adapter from silently corrupting memory.

**Copy cards carry a skeleton as well as a draft** (D14), and the anti-detection claim in PRODUCT.md softened to authenticity of substance — grounding defeats cross-applicant correlation, which is largely not what detection tooling reads.

**Gate calibration has a plan** (D15): relative scoring against each user's own distribution, an absolute floor underneath, tuned against a hand-built 50-case fixture that also serves as the unit test — which unblocks the core-loop slice without needing users.

- 2026-08-09 — **Repository created.** Private at `alvinleyble/jobibi`, posture `no-mistakes-prod-only`, design docs pushed to `main`, validation gate initialized and healthy. D6 closed.
- 2026-08-09 — **Beta budget set at $5** (existing OpenAI credit) ≈ 416 applications. D8 closed.

- 2026-08-09 — **Supabase project created**, ref `kbpojtjemftqwgmrnbdq`. D7 closed. CLI wiring happens in S2.
- 2026-08-10 — **S1 completed.** Repo scaffolded (pnpm monorepo with apps/extension and packages/shared). Hello-world side panel verified.
- 2026-08-10 — **S2 completed.** `profiles` table + RLS migrated via the Supabase CLI to the linked remote project (`kbpojtjemftqwgmrnbdq`); side panel sign-in via email-OTP magic-link + PKCE, completed on a dedicated callback page. A build bug (WXT's Vite `envDir` defaulting to `apps/extension` instead of the monorepo root, so real Supabase credentials never reached the bundle) was caught by manual testing and fixed. Two-user RLS test re-run today against the fully-migrated remote project: each user sees only their own row; a direct cross-user `SELECT` and `UPDATE` (by id) are rejected by RLS itself — empty result sets, not merely absent from the app UI; cross-user `INSERT` is rejected with a `42501 permission denied for table profiles` grant-level error (the branch's trailing migrations revoke the `authenticated` role's INSERT grant on `profiles`, so this now fails before RLS is evaluated rather than on an RLS policy check); self-promotion to `tier=premium` is separately rejected by the protect-tier trigger; anon access returns nothing.

- 2026-08-10 — **S3 completed.** `documents`, `memory_chunks`, and `sensitive_facts` tables migrated via the Supabase CLI (RLS-enabled from creation, matching the S2 pattern), plus a private `documents` Storage bucket scoped per-user by folder. A new `ingest` Edge Function extracts text (txt directly, docx via a hand-rolled zip+XML text-run parser, pdf via `unpdf`), chunks it (`packages/shared/src/ingestion/chunk.ts`), embeds each chunk in-process with the Edge Runtime's built-in gte-small model (D5c — no network call), and writes `documents` + `memory_chunks` rows, all under the caller's own JWT (no service-role writes). The side panel gained an upload flow, the sixty-second four-fact intake (writing directly to `sensitive_facts` under RLS), and a debug list showing documents/chunk counts/facts. Chunking and extraction are unit-tested (21 cases, including a programmatically-built minimal PDF fixture so no binary fixture is checked in). Verified against the real linked project: a scripted two-user check confirmed cross-user Storage RLS rejects writes into another user's folder, upload→ingest produced a resume's chunks with 384-dim embeddings, and the four facts round-tripped — then the test data was deleted.

- 2026-08-10 — **S3b completed.** Cover letters can now be pasted as freetext instead of uploaded (resumes and transcripts stay upload-only). `documents.storage_path` is now nullable to represent a pasted document; the `ingest` Edge Function accepts a `{ text, kind }` request shape that skips download/extract and feeds validated text straight into the existing chunk→embed pipeline. Validation and provenance logic live in `packages/shared/src/ingestion/paste.ts`, unit-tested (8 cases).

- 2026-08-11 — **S4 completed.** JobStreet question extraction + confident mapping merged to `main` as `e423139` (`8480c81`). Content script scoped to `*://*.jobstreet.com*/*apply*` (`apps/extension/entrypoints/jobstreet.content.ts`); adapter in `packages/shared/src/adapters/jobstreet.ts` reads live questions, binds each to its field with `confidence` via `CONFIDENCE_BY_SOURCE` (D16) — `label-for 1.0` … `proximity 0.5` + blob/PII guards — unit-tested with 12 fixture-HTML cases. Step-scoped reading via site-generic `/_Q_/` ids drops stepper/profile/job-header noise; grouped checkbox/radio collapsed by `name` dedupe. Side panel (`apps/extension/entrypoints/sidepanel/JobStreetQuestions.tsx`) lists questions live with `high/medium/low` badges, is tab-aware (`tabs.onActivated` + `tabs.onUpdated`) and shows `Open a JobStreet application…` off-apply pages. Paste lane redeployed (`supabase functions deploy ingest --use-api`) and `documents.storage_path` made nullable on remote via Dashboard SQL (migration `20260810001300_documents_storage_path_nullable.sql`); `Add pasted text` → `Added 1 chunk`. Verified: `packages/shared` 41 passed, `apps/extension` 5 passed, `tsc --noEmit` 0, `wxt build` ok, plus live manual pass on a real JobStreet application (homepage `0`, Choose documents `1` cover letter, Employer questions `4` with confident mappings, tab flip clears).

- 2026-08-11 — **S4.5 completed.** Gate fixture — the golden set merged to `main` as `f1ff005`. Fifty hand-written `(question × memory → draft/ask/refuse)` triples in `packages/shared/src/gate/goldenSet.ts` (18 draft `q-high+r-high`, 16 ask `q-high+r-low` strong-story-wrong-family, 16 refuse `q-low`/absolute floor), each justified by the two axes per the ARCHITECTURE gate table and D15. Schema `goldenSetSchema` (zod `50–60`) enforces shape; `goldenSet.test.ts` covers uniqueness, sorted ids `G001–G050`, distribution `18/16/16`, justification axis check, `q-high+r-low → ask` hard-case, and empty-memory absolute floor. Verified: `packages/shared` 50 passed (6 files), `tsc --noEmit` 0. No pipeline code — hard prerequisite for S5a.

## Still open

- **D9** — business entity, blocking only for payments.
- Philippine Data Privacy Act review before public launch.

## All build blockers are now clear

D6, D7, and D8 are closed. Phase 1 authorized.

## Current state of the repo

S1, S2, S3, S3b, S4, and S4.5 shipped (S4 `e423139`, S4.5 `f1ff005`). The extension has auth, document upload or paste (cover letters only), four-fact intake, a memory-bank debug list, and live JobStreet question extraction with confident field mapping; Supabase has `profiles`, `documents`, `memory_chunks`, `sensitive_facts` (all RLS-enabled), a private `documents` Storage bucket, and the `ingest` Edge Function (redeployed for pasted cover letters). Shared has the 50-case golden set as the gate tuning target (`packages/shared/src/gate/goldenSet.ts`).

**Next step:** S5a. Suggest endpoint — gate, draft, refuse (needs `OPENAI_API_KEY` in Edge Function secrets).
