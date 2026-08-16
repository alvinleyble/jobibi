# Jobibi — Decision Log

One entry per decision. Statuses: **accepted** (locked, revisit only with cause), **proposed** (default direction, expected grill target), **open** (undecided — needs an answer).

D1–D4 were accepted before the design grill. D5 was split by it. D10–D17 are its outcomes.

---

## D1 — Platform: Chrome extension — **accepted** (2026-08-09)

**Decision:** v1 is a Chrome extension (Manifest V3), side panel + content scripts.
**Why:** The only platform that can both read application forms reliably (direct DOM access) and write into them (premium Auto-Fill). Edge compatibility comes free.
**Rejected:** Screen-aware desktop app — needs OCR, cannot fill fields (kills the premium feature), worse privacy optics, much more work.

## D2 — Memory bank lives in the cloud — **superseded by D20** (2026-08-15)

**Decision:** Memory is stored in Supabase Postgres with per-user row-level security, plus export and delete-my-data endpoints.
**Why:** Syncs across devices, simplest to build well, and the isolation claim is enforced by the database itself.
**Rejected:** Local-only browser storage — strongest privacy claim but no sync, fragile (cleared browser data = lost memory), significantly more work. A local-only mode remains a possible future premium differentiator.
**Superseded (2026-08-15):** D20 accepts local-first (PGlite) as the production default. See D20 for the full rationale and rejected alternatives.

## D3 — Payments deferred — **accepted** (2026-08-09)

**Decision:** No payment rails in v1. Beta is free with premium (Auto-Fill) behind a waitlist / manual flag for testers.
**Why:** Fastest path to real users; rails chosen once demand is visible.
**Rejected for now:** GCash-first via PayMongo/Xendit (needs a registered business entity + weeks of integration); merchant-of-record (weak GCash support — real friction for the PH market).

## D4 — v1 first-class sites: JobStreet, LinkedIn Easy Apply, Indeed — **accepted** (2026-08-09)

**Decision:** Dedicated adapters for these three; generic label-proximity fallback for everything else.
**Why:** JobStreet dominates PH; LinkedIn Easy Apply is big, growing, and well-structured; Indeed adds breadth for later scaling.
**Deferred:** Workday — powers many corporate/BPO portals but is the hardest DOM for the least early coverage.

## D5a — Stack details — **accepted** (2026-08-09, was D5)

- Extension: WXT + React + TypeScript + Tailwind; Chrome Side Panel API for the Sidekick.
- Backend: Supabase (Singapore) — Auth, Postgres + pgvector, Storage, Edge Functions.
- Monorepo: pnpm — `apps/extension`, `supabase/`, `packages/shared`.
- Structured outputs for copy cards; prompt caching for the style profile.

## D5b — Model vendor: OpenAI GPT-5.6 Luna — **accepted** (2026-08-09)

**Decision:** One vendor, committed, using its native features. Luna handles drafting, gap-question wording, and classification alike. No provider abstraction layer.

**Why:** Cheapest of the four candidates evaluated at $0.20/$1.20 per MTok (following OpenAI's 30 July cut), best-in-class strict JSON schema output — which matters now that copy cards carry both an answer and a skeleton — ephemeral prompt caching that costs nothing while a user is idle, a half-price batch tier that suits style-profile distillation, 1.05M context, and rate limits far beyond beta scale. No training on API traffic; Asia data residency available.

**Why not a provider abstraction:** the expensive part of switching models is prompts and thresholds, not the SDK. "Swappable" was buying less than it looked like.

**Rejected:**
- **Claude Sonnet 5** ($0.107/application on intro pricing) — strongest voice and tone fidelity of the four, which is the product's core risk, but roughly 9× the cost.
- **Mistral Large 3** ($0.021/application) — best privacy posture (French entity, GDPR-native, Zero Data Retention available), but the weakest writing of the serious candidates.
- **Gemini 3.6 Flash** ($0.080/application) — its context caching bills hourly storage per cached object, which is structurally wrong for one style profile per user with bursty, mostly-idle usage: the bill would scale with signups rather than activity.
- **Kimi K3** — the best writer reachable, but its August 2026 terms grant model-optimisation rights absent an opt-out and a negotiated DPA.
- **Claude Fable 5** — top-ranked writer overall, but requires 30-day data retention and cannot run under zero retention.

**Accepted risk:** Luna's writing and instruction-following are unmeasured on public benchmarks (its strong ranking is in coding), and voice fidelity is precisely the axis this product turns on. **Revisit trigger:** a bake-off of ~20 genuinely user-written answers, same questions, side by side against Sonnet 5 and Mistral Large 3. Also: Luna runs ~2× the median output length, so drafting must constrain length explicitly.

## D5c — Embeddings: gte-small, in-process — **accepted** (2026-08-09)

**Decision:** Supabase's built-in gte-small, running inside Edge Functions.
**Why:** Free, no network hop, and the memory bank is never sent anywhere to be embedded — only retrieved snippets leave at draft time. On a cold-start corpus of 20–100 chunks the quality gap against a dedicated embedding API barely shows; gate calibration dominates behaviour.
**Revisit trigger:** the two-axis gate misfiring on real data. The fix is then to re-embed on a stronger model rather than to keep tuning cutoffs. Because `memory_chunks` stores source text, this is a batch job per user, not data loss.
**Rejected:** dropping vectors entirely for keyword + trigram matching — role-match is inherently semantic and cannot be computed from keywords, which would break the ask path (D10).

## D6 — GitHub remote — **accepted** (2026-08-09)

**Decision:** Private repository at `https://github.com/alvinleyble/jobibi`, owned by the `alvinleyble` account. Delivery posture `no-mistakes-prod-only` — product-facing work runs the full validation pipeline before a PR; internal tooling, scripts, and contributor process ship straight to a PR.
**Done:** repository created, design docs pushed to `main`, validation gate initialized.

## D7 — Supabase project — **accepted** (2026-08-09)

**Decision:** Project created. Ref `kbpojtjemftqwgmrnbdq`, Free plan.

**Approach:** schema is managed **only** through the Supabase CLI in this repo — `supabase init`, `supabase link --project-ref <ref>`, migrations as committed files under `supabase/migrations/`. Never through an ambient database connection.

**Why that matters:** the operator's environment has database tooling bound to a *different* production project holding real users' financial data. Keeping Jobibi's schema in CLI-managed migration files walls the two apart permanently, makes every schema change a reviewable file in git, and is what S2 already assumes.

**Credential handling:** the CLI authenticates with a personal access token via `supabase login`. The database password is *not* needed for the migration workflow — only for direct `psql`-style connections. Keep the project URL and anon key in `.env` (gitignored); never commit either the database password or a full connection string.

**Wiring completed in S2**: `profiles` and its RLS policies are committed migrations under `supabase/migrations/`, pushed to the linked remote project via the CLI.

## D8 — Beta AI budget: $5 starter — **accepted** (2026-08-09)

**Decision:** $5 of existing OpenAI credit funds the beta.

At ≈$0.012 per full 20-question application (D5b), that is roughly **416 applications** — about 8,300 questions, or ten testers doing forty applications each.

**Free-tier daily cap:** ~25 questions per user per day (about one application). Keeps ten testers inside the budget for roughly ten weeks. The cap is a fairness and abuse control, not a cost control.

**Set a hard $5 usage limit on the OpenAI account.** It is a fixed pot with no refill, and a runaway retry loop should not be how that gets discovered.

**Budget risk:** D5b's verbosity finding is now a budget finding. Luna runs ~2× the median output length, output is the dominant cost line, and unconstrained drafting would cost ≈$0.024 per application — halving the runway to ~208 applications. The explicit length cap in the drafting call is what makes $5 last.

## D9 — Business entity — **open** (blocking only for payments)

Whether/when a registered business entity exists. Irrelevant until D3 is revisited; determines GCash rail options (PayMongo/Xendit require one).

---

## D10 — The gate has three outcomes, decided by code — **accepted** (2026-08-09)

**Decision:** For each question the gate chooses **draft**, **ask**, or **refuse**. Two axes are scored — question-match and role-match — and code alone picks the outcome. The model is never called on a refusal, and on an ask it is called only to word the question after code has decided.

**Why the third outcome:** the product's founding scenario is a good story told for the wrong role. That case scores *high* on question-relevance, so a single-score gate would draft it thin rather than catching it. Asking one anchored question converts the product's hardest case — a thin memory bank — into its growth mechanism.

**Why two axes:** question-match alone cannot distinguish "great story, right role" from "great story, wrong role"; they score identically.

**Why code decides:** the honesty promise is only as strong as its enforcement. Keeping refusal in code, not model discretion, keeps that promise literally true and makes the gate unit-testable.

**Consequence:** interview machinery moves from Phase 4 into Phase 2; a new stored type (`gap_answers`) exists that is not a `qa_pair`.

## D11 — Job context is role title + company — **accepted** (2026-08-09)

**Decision:** The angle Jobibi tailors against is the role title and company, with full job-description text taken opportunistically when already present in the DOM. No listing-page adapters, no extra host permissions, no user action.
**Why:** Title alone separates QA from automation, which is the distinction the product exists to handle. JD-keyword targeting is second-order.
**Rejected:** background capture on listing pages (doubles adapter surface, broader permissions, ambient collection at odds with the privacy stance); asking the user to paste the JD (per-application friction in a product about removing it).

## D12 — Capture: watch the mapped fields, read all identified questions — **accepted** (2026-08-09)

**Decision:** The content script watches the fields it mapped and reads their final values at submit. It reads every field identified as an application question, including ones Jobibi did not help with.
**Why watching, not asking:** without seeing what the user actually submitted, edit distance and origin (D13) are unmeasurable and `qa_pairs` fills with Jobibi's own drafts. A manual "I'm done" click has too little compliance to carry the growth loop.
**Why all questions:** limiting capture to fields Jobibi helped with makes every refusal a permanent dead end, and discards the purest voice material in the product.
**Consequence:** the privacy surface widens from "reads the questions" to "reads what you type into application questions". This must be stated plainly at onboarding, and per-answer delete becomes mandatory, not just bulk delete.

## D13 — Stored answers record their origin — **accepted** (2026-08-09)

**Decision:** Every stored answer records how it was produced — `user_written`, `user_edited`, or `accepted_verbatim` — derived by diffing the offered draft against what was submitted. The style profile learns voice **only** from the first two.
**Why:** by application 15 most of `qa_pairs` would otherwise be Jobibi's own prose, so the style profile would distil model tone rather than the user's, drifting further from them every cycle while claiming the opposite.
**Bonus:** edit distance is a per-answer quality signal available immediately, with no callbacks and no extra user action.

## D14 — Output: draft and skeleton on every copy card — **accepted** (2026-08-09)

**Decision:** Structured output carries both the finished answer and the bullet skeleton behind it. The user copies whichever they want.
**Why:** grounding makes an answer factually the user's, but a model-written answer is still stylistically the model's — so the anti-detection claim as originally written does not hold. Rather than settle that from a desk, ship both and observe which users pick. Skeleton users hand-write their prose, which feeds the voice corpus (D13) exactly what it is short of.
**Consequence:** PRODUCT.md's anti-detection framing softens to authenticity of substance.

## D15 — Gate calibration: relative scoring, absolute floor, golden set — **accepted** (2026-08-09)

**Decision:** The primary signal is relative — how far the top match stands above that user's own score distribution — with a single absolute floor underneath for the genuinely-nothing case. Both tuned against ~50 hand-written (question, memory, expected outcome) triples, which double as the unit-test fixture. Every decision is logged from day one for later retuning.
**Why relative:** absolute cosine thresholds mean different things for a 5-chunk user and a 200-chunk user, and gte-small (D5c) makes raw values noisier still. Fixed cutoffs behave well in tests and erratically in production.
**Why a hand-built fixture:** it unblocks the core-loop slice without users, and makes "unit tests for gate thresholds" actually possible.
**Tuning bias:** toward asking. A wrong ask costs one question; a wrong draft costs trust.

## D16 — Adapter safety: re-derive the mapping at capture — **accepted** (2026-08-09)

**Decision:** The question→field mapping is independently re-derived at capture time and compared against the mapping used at suggestion time. Agreement writes; disagreement drops the write and logs it. The same confidence signal gates Auto-Fill, which degrades to read-only when uncertain.
**Why:** an adapter that mis-binds a label to the wrong field produces a panel that looks entirely correct while writing wrong answers into memory permanently and invisibly — then citing them with provenance and distilling them into the style profile. Extraction failures are cheap and self-announcing; mis-mapping is expensive and self-concealing, so the design forces failure toward the cheap kind.

## D17 — Sensitive detection is a union, deliberately over-inclusive — **accepted** (2026-08-09)

**Decision:** Two independent signals — keyword/field-type rules, and retrieval matching the question against the user's typed `sensitive_facts` — and **either** one firing routes to always-confirm. A model classification may be added as a third net; it can add caution but never remove it.
**Why:** keyword matching alone has false negatives on a long tail ("What compensation range are you targeting?"), and a miss means a wrong salary figure typed into a real application. The cost asymmetry is extreme: a false positive is one extra click. Because the four core facts are seeded at install (D18), the retrieval signal works from the first session.
**S7A extension (2026-08-13):** the same gate now also runs at storage time, before every insert of user-typed text (`gap-answer`, `capture`, and the refuse card's manual-input path) — not only ahead of drafting. Rejected alternative: silently reclassify a flagged sentence into `sensitive_facts` in the background; rejected because it writes into the typed-fact table without the user ever confirming the value, defeating the point of the confirm/update lifecycle. Instead the insert is rejected and the user is routed to the existing sensitive-confirm card, so a value only ever enters `sensitive_facts` through that one screen.
**Retired (2026-08-15):** `sensitive_facts`, the union gate, the always-confirm card, and the sensitive-confirm Edge Function are removed entirely. Salary and notice-period questions are now a static, keyword-matched refusal in `suggest` requiring direct user input in the moment — no fact is stored, retrieved, or auto-suggested. Work authorisation and location are no longer specially handled; they run through the ordinary gate like any other question. Reason: the confirm/update lifecycle added a full table, an Edge Function, and a union-of-two-signals detector to protect four fields, and in practice a plain refusal for the two fields that actually carry a wrong-answer cost (salary, notice) is cheaper and no less safe.

## D18 — Cold start: front-load facts, fold stories into the first application — **accepted** (2026-08-09)

**Decision:** Onboarding is a sixty-second intake of four facts only — salary expectation, notice period, work authorisation, location. Stories are never asked in the abstract; they surface as anchored one-line gap questions during a real application the user needs to submit.
**Why:** resumes contain almost no stories, so a new user's first form is mostly asks. Asking in-flight puts each question at the moment of maximum motivation, and every answer goes into the form they needed to fill anyway. A ten-question cold interview before the product has proven anything loses people at install.
**Rejected:** mining resume bullets into draft stories for one-tap approval — that is the model writing the user's history, and rubber-stamped stories are exactly the low-quality voice material D13 exists to exclude.
**Streamlined-onboarding revision (2026-08-14):** the four-fact form is dropped from onboarding itself. Sign-in now goes straight to resume upload, followed by an optional one-box "career highlights / writing style" step (paste-only, `origin: user_written`, seeds the style corpus early) with a prominent Skip. The `sensitive_facts` table and D17's union gate are unchanged — salary/notice/authorisation/location are still collected, just via the existing runtime always-confirm card the first time each is needed, rather than pre-collected at install. This keeps D17's retrieval signal cold for brand-new users until their first sensitive question, which was the original cost this decision was written to avoid; accepted because a shorter install-to-first-draft path outweighs it, and the always-confirm card still fires reliably off the rules signal alone.
**Retired (2026-08-15):** superseded by D17's 2026-08-15 retirement. There is no fact left to front-load or collect on first need — salary/notice are a direct-input refusal, and work authorisation/location are ordinary questions through the gate.

## D19 — Style-profile distillation: voice-corpus scope, trigger, and batch tier — **accepted** (2026-08-14)

**Decision:** The **voice corpus** is the union of `qa_pairs` with `origin in (user_written, user_edited)`, `documents` with `origin in (user_written, user_edited)`, and all `gap_answers` rows — all scoped to the current user, ordered by `created_at` descending, capped at the most recent 100 items with no recency weighting beyond that cap. `accepted_verbatim` rows from either table are never included (D13). The distillation job produces `profile_md`: 5–8 bullets of observations about *how* the person writes (sentence length, formality, recurring phrasing/habits, opening/closing style), explicitly not facts about career or what they've said — that is the rest of the memory bank's job. The job runs as a **direct chat completion** and carries an explicit output-length cap (`max_completion_tokens 400`, `profile_md ≤2000 chars`) per invariant 8 — the cap is not skipped because this is a background job rather than a user-facing draft. Batch tier (half-price, asynchronous) is deferred: the Edge Function's synchronous lifetime cannot wait out a real batch job, and without a poller wired to reconcile the result, a batch call would only add cost on top of the direct completion that still has to run to produce a profile this cycle. The `batch_job_id` column stays on `style_profile` for the deferred batch path but is always `null` today. On completion the `style_profile` row is overwritten (`profile_md`, `generated_at`, `corpus_size` = current qualifying count); no version history in this slice.

**Trigger:** every write path (`capture`, `gap-answer`, `manual-input`, `ingest`) only counts the current qualifying total and compares it delta-wise against `style_profile.corpus_size` (the count at last successful rebuild); if `current - corpus_size >= 10` it fires a fire-and-forget POST to `style-profile` with `trigger: 'auto'` and does not touch `style_profile.rebuilding` itself — a shared helper (`supabase/functions/_shared/styleProfileTrigger.ts`) implements this check-and-fire so the four callers can't drift out of sync. `style-profile` is the sole owner of the in-flight claim: it re-checks the delta, and if no rebuild is already in flight for this user, claims the row with a conditional `update ... where rebuilding = false` (or a first-row `insert`, relying on the `user_id` primary key) so two near-simultaneous triggers can't both win the claim. If a rebuild is already in flight, skip — do not queue a second one; the next qualifying write after the in-flight one completes will re-check and can trigger again. The "in flight" signal is a real row-level marker (`rebuilding` boolean + `rebuilding_started_at` + `batch_job_id` on `style_profile`), with a 30-minute staleness guard so a crashed job does not block future rebuilds forever.

**Failure:** on API error, timeout, or malformed output, do nothing special: leave the existing `style_profile` row as-is (or absent, for a first-ever failed attempt) and let the next natural trigger try again. No retry loop, no alerting.

**Why this shape:**
- *Union, D13-filtered:* `qa_pairs` alone would miss accepted/edited cover-letter drafts (S8) and the anchored gap answers that are the purest voice material; `documents` without the origin filter would re-learn `accepted_verbatim` drafts (D13). The union keeps the style profile from converging on model tone while claiming to capture the user's voice.
- *Delta-since-last-rebuild, not total or modulo:* a total-ever threshold fires once; a modulo fires on every 10th item regardless of whether the last rebuild actually succeeded or included those items. Delta against `corpus_size` ties the next rebuild to the last *successful* distillation and survives silent failures.
- *Skip-if-in-flight, no queue:* the job is batch-async and idempotent; queuing a second job while the first is still distilling wastes batch spend and risks overwriting a fresher profile with a staler one. A single in-flight marker is cheaper than a job queue and sufficient because the next qualifying write re-checks.
- *Silent-fail-and-retry-next-cycle:* distillation is not on the user's critical path — drafting omits the style block when no profile exists and works normally. A retry loop or alert would add operator surface for a background job whose failure costs one missed voice refinement, not a broken application.
- *Direct completion for now, batch deferred, 100-item cap:* batch tier's 0.5× cost only pays off once a poller reconciles its async result; shipping a batch call the function can't wait on and would run a direct completion for anyway pays double for the same job, not half. Direct-only keeps this slice correct and avoids that double-spend; the cap keeps the job within Luna's context and cost envelope while the 10-item delta keeps rebuild frequency proportional to user activity.
- *No UI:* the profile is invisible in this slice — no view or edit surface — so it cannot be mis-edited into a prompt injection and the distillation quality can be observed via drafting before exposing it.

**Rejected:**
- Absolute count threshold (e.g. "rebuild at 10, 20, 30 total") — fails after a silent failure at 10, since the next write at 11 would not re-trigger.
- Hardcoded cosine threshold for corpus inclusion — same reason as D15's relative scoring: corpus sizes vary widely across users.
- Intersection of the three sources (require a document *and* a qa_pair, etc.) — would starve new users who have only gap answers.
- Immediate retry loop or alerting on distillation failure — over-instrumentation for a non-critical background job; the next natural trigger is the retry.
- Exposing a view/edit UI in this slice — adds prompt-injection surface and scope before drafting with the profile is observed; tracked as future work.
- Training on `accepted_verbatim` to "grow the corpus faster" — reintroduces the D13 drift the product exists to avoid, invisible and compounding.

**Out of scope, folded into this record's rationale:** the "10 answers" delta, "100-item cap," and "no UI" choices are parameters of this same distillation design, not separate decisions warranting their own records. Freshness clocks, proactive grilling, intake-flow changes, and style-profile viewing/editing UI remain explicitly out of scope.

## D20 — Local-first architecture (supersedes D2) — **superseded by D23** (2026-08-16)

**Decision:** Memory storage moves from Supabase Postgres to PGlite (in-process Postgres WASM, running inside the extension's service worker). This is the new production default for all new users. Cloud mode is removed / becomes legacy-only. The Supabase project is reduced to Auth-only (email OTP, no application-data tables). AI calls (suggest, gap-answer, draft-cover-letter, etc.) continue to flow through a Jobibi-managed proxy endpoint that holds the OpenAI key — the extension itself still ships zero secrets.

**Why:**
- *Privacy-first motivation:* the most common objection to Jobibi is that résumé and answer history leave the device. A local-only memory bank eliminates that objection entirely. Embeddings already run in-process (D5c); moving the DB completes the on-device story.
- *PGlite over SQLite or native sidecar:* PGlite is in-process Postgres WASM, meaning the existing schema, migrations, RLS logic, and pgvector queries carry over with minimal rewriting. SQLite would require rewriting every Postgres-dialect query and reimplementing vector search. A native companion app adds a mandatory install step that kills adoption. The ~10MB one-time WASM download is acceptable for an extension.
- *Supabase Auth retained:* quota enforcement and billing require knowing who the user is. Supabase Auth (email OTP, PKCE) already works; stripping only the DB tables gives us account identity with zero new infrastructure.
- *Jobibi-managed AI proxy:* the extension must never bundle a secret. A lightweight proxy (e.g. Cloudflare Worker) forwards the OpenAI call and streams the response — it persists nothing. The user's memory data is assembled locally and included in the prompt transiently; it is not stored by us. This is the correct privacy claim: *your history never leaves your device persistently*.
- *No sync:* purely local. Two-separate-worlds is the right first design — conflict resolution for a privacy-first product adds complexity and cloud surface that contradicts the motivation.

**Rejected:**
- *Keeping Supabase DB + adding local toggle:* two storage backends in parallel are expensive to maintain and create subtle divergence bugs. Committing to local-first is cleaner.
- *SQLite via OPFS:* significant query rewrite cost, vector search reimplementation, no benefit over PGlite for this schema.
- *Native companion app:* breaks "just install the extension" UX; too high a setup barrier.
- *User-supplied OpenAI key in chrome.storage.local:* adds friction at setup, exposes key management complexity to the user, and shifts blame for API errors. Proxy keeps UX identical to today.
- *Fully offline (no AI):* removes the core value proposition. The privacy promise is about *stored data*, not about *ephemeral API calls*.
- *Bi-directional cloud sync:* conflict resolution complexity, contradicts the privacy motivation, deferred indefinitely.

**Revisit trigger:** If PGlite's WASM bundle size or service-worker memory limits prove prohibitive on low-end devices in beta testing, reconsider SQLite WASM (OPFS) with a pgvector-compatible vector search shim.

**Scope of this slice:** PGlite integration + storage abstraction layer. Auth model, AI call path, and business model are refined in D21.

## D21 — Two-posture architecture + BYO-Key model — **superseded by D23** (2026-08-16)

**Decision:** Jobibi ships as a single extension with two selectable operating postures chosen at first launch via a clear mode picker: **Local BYO-Key** (default/focus) and **Cloud SaaS** (turnkey with sync). Local LLM (Ollama/LM Studio) is dropped from scope to avoid onboarding complexity and model degradation.

| Posture | Storage | AI Calls | Auth | Privacy Rating | Monetisation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Local BYO-Key** | PGlite (on-device) | Direct to OpenAI, Gemini, or Claude | None | *High Privacy (Local Memory)* | Free & Open Source |
| **Cloud SaaS** | Supabase Postgres | Jobibi Proxy (`gpt-5.6-luna`) | Supabase Auth | *Standard SaaS Privacy* | Monthly Pro Subscription |

**Why Local LLM (Mode 3) was dropped:**
- *High onboarding barrier:* Requiring non-technical job applicants to install Ollama/LM Studio, download multi-gigabyte models, and manage local GPU memory creates immense UX friction.
- *Draft quality & schema reliability:* 3B–7B parameter local models often struggle with complex JSON schema adherence and structured draft formatting compared to modern cloud APIs.
- *Local BYO-Key achieves 95% of privacy goals:* User memory, resumes, and vector embeddings remain 100% on-device; only the ephemeral drafting prompt leaves the machine directly to their provider of choice with zero intermediary storage.

**Supported BYO-Key Providers:** OpenAI, Google Gemini, Anthropic Claude (all support structured JSON outputs).

**Build order:** (1) Storage abstraction + PGlite, (2) Client AI abstraction + Provider adapters, (3) Posture picker UI & settings, (4) Cloud subscription billing (later).

## D22 — Local-First Runtime Guardrails, Concurrency & Data Isolation — **superseded by D23** (2026-08-16)

**Decision:** The implementation of Local BYO-Key Mode is bound by five strict runtime, privacy, and architectural guardrails:

1. **Centralized PGlite Host (Zero Lock Contention):** A single PGlite database instance is hosted strictly in the Extension Background Service Worker / Offscreen context. The Side Panel UI and Content Scripts never open PGlite directly; all database reads, writes, and vector hybrid searches are mediated via extension message passing (`browser.runtime.sendMessage`).
2. **On-Demand Embedding Model Delivery:** The `gte-small` ONNX vector embedding model (~30MB) is downloaded on-demand from HuggingFace CDN when the user first selects Local Mode, displaying clear progress in the UI, and cached permanently in browser CacheStorage/IndexedDB. Extension install bundle remains lightweight (~1MB).
3. **Storage Persistence Guarantee:** Upon initializing Local Mode, the extension explicitly requests `navigator.storage.persist()` to prevent Chromium from automatically evicting IndexedDB during low-disk cleanup.
4. **Transparent Background Distillation:** Style profile rebuilding (D19) runs automatically after every 10 qualifying user answers, with a subtle UI indicator in the Memory Tab ("✨ Updating your writing style profile...") so users are aware of background token usage on their personal API key.
5. **Zero-Outbound Telemetry Boundary:** In Local Mode, all `gate_decisions`, `extraction_failures`, and `capture_mismatches` are stored strictly in local PGlite tables. All outbound network requests to Supabase or remote analytics are hard-disabled at the client transport layer.
6. **Isolated Silos with 1-Click Cloud Import:** Cloud and Local storage remain distinct isolated databases. Users switching from Cloud to Local in Settings are offered an optional one-time "Import Cloud Memory to Local" copy step to avoid starting from scratch without establishing continuous sync.

## D23 — Cloud SaaS only; Local BYO-Key and Local LLM dropped — **accepted** (2026-08-16)

**Decision:** Jobibi ships Cloud SaaS (Mode 1) only. The two-posture architecture of D21 is withdrawn: the Local BYO-Key posture ("hybrid" / Mode 2) and Local LLM (Mode 3) are dropped.

**Supersedes:** D20 (local-first default), D21 (two-posture), D22 (local runtime guardrails). The S14A storage-abstraction slice (PGlite + StorageAdapter, PR #38) is unused by the single-mode product, and S14 (the Local-posture UI/UX spec: BYO-Key entry, cloud import, ONNX download UX) is deferred indefinitely.

**Unchanged for Cloud SaaS Mode 1 (D5b/D5c/D7):** Supabase Postgres + Supabase Auth, AI calls routed through the Jobibi proxy (OpenAI key held in Edge Function secrets; the extension ships zero secrets), and gte-small embeddings running in-process inside Edge Functions. No BYO-Key entry, no in-browser ONNX download, no cloud-to-local import.
