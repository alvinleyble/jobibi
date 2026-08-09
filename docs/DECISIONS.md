# Jobibi — Decision Log

One entry per decision. Statuses: **accepted** (locked, revisit only with cause), **proposed** (default direction, expected grill target), **open** (undecided — needs an answer).

D1–D4 were accepted before the design grill. D5 was split by it. D10–D17 are its outcomes.

---

## D1 — Platform: Chrome extension — **accepted** (2026-08-09)

**Decision:** v1 is a Chrome extension (Manifest V3), side panel + content scripts.
**Why:** The only platform that can both read application forms reliably (direct DOM access) and write into them (premium Auto-Fill). Edge compatibility comes free.
**Rejected:** Screen-aware desktop app — needs OCR, cannot fill fields (kills the premium feature), worse privacy optics, much more work.

## D2 — Memory bank lives in the cloud — **accepted** (2026-08-09)

**Decision:** Memory is stored in Supabase Postgres with per-user row-level security, plus export and delete-my-data endpoints.
**Why:** Syncs across devices, simplest to build well, and the isolation claim is enforced by the database itself.
**Rejected:** Local-only browser storage — strongest privacy claim but no sync, fragile (cleared browser data = lost memory), significantly more work. A local-only mode remains a possible future premium differentiator.

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

## D6 — GitHub remote — **open**

Create a private GitHub repository for Jobibi? Awaiting project-owner approval (recommended: yes, private, under the existing account).

## D7 — Supabase account and project — **open**

Host the new Supabase project on the existing account? Region recommendation: Singapore (`ap-southeast-1`). Awaiting confirmation.

## D8 — Beta AI budget — **open, but no longer a constraint**

Monthly AI spend ceiling for the beta. At ≈ **$0.012 of AI cost per full 20-question application** (D5b), $50/month covers roughly 4,100 applications. The free-tier daily cap should therefore be sized as a fairness and abuse control, not a cost control. Still needs a number named.

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

## D18 — Cold start: front-load facts, fold stories into the first application — **accepted** (2026-08-09)

**Decision:** Onboarding is a sixty-second intake of four facts only — salary expectation, notice period, work authorisation, location. Stories are never asked in the abstract; they surface as anchored one-line gap questions during a real application the user needs to submit.
**Why:** resumes contain almost no stories, so a new user's first form is mostly asks. Asking in-flight puts each question at the moment of maximum motivation, and every answer goes into the form they needed to fill anyway. A ten-question cold interview before the product has proven anything loses people at install.
**Rejected:** mining resume bullets into draft stories for one-tap approval — that is the model writing the user's history, and rubber-stamped stories are exactly the low-quality voice material D13 exists to exclude.
