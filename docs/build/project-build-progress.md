# Jobibi — Project Build Progress

**Current state:** BUILDING Phase 1 (S2 completed).

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
- 2026-08-10 — **S2 completed.** `profiles` table + RLS migrated via the Supabase CLI to the linked remote project; side panel sign-in via email-OTP magic-link + PKCE, completed on a dedicated callback page. Two-user RLS test passed.

## Still open

- **D9** — business entity, blocking only for payments.
- Philippine Data Privacy Act review before public launch.

## All build blockers are now clear

D6, D7, and D8 are closed. Phase 1 authorized.

## Current state of the repo

S1 and S2 shipped. `main` now holds the WXT + React extension skeleton, Supabase auth + `profiles` schema with RLS, and design documentation.

**Next step:** S3. Document upload + ingestion + four-fact intake.
