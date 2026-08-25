# Jobibi — Architecture

*Drafted 2026-08-09. Revised 2026-08-25 to record the pivot to 100% open-source local BYO-Key (D26). See [DECISIONS.md](DECISIONS.md) for the decision log and [CONTEXT.md](../CONTEXT.md) for shared vocabulary.*

## Shape of the system

Jobibi is a 100% open-source, local-first Chrome extension with zero cloud infrastructure (D26).
All persistence, vector retrieval, and pipeline orchestration execute locally within the browser.
AI drafting calls connect directly from the client to the user's chosen provider using their own API key.

```mermaid
flowchart TD
    subgraph Browser["Chrome Extension (Client Side)"]
        subgraph UI_Layer["UI & Extraction Layer"]
            UI["Side Panel<br/>SuggestCards · MemoryBank · Settings"]
            CS["Content Scripts<br/>JobStreet · LinkedIn · Indeed · Generic"]
        end

        subgraph Background_Layer["Routing Layer"]
            SW["Background Service Worker<br/>Thin Router · SidePanel Launcher · Message Bus"]
        end

        subgraph Offscreen_Layer["Compute & Storage Host (Offscreen Document)"]
            RPC["Message Router & Pipeline Orchestrator"]
            PGL["PGliteStorageAdapter<br/>Postgres WASM + pgvector<br/>IndexedDB: idb://jobibi-local-memory"]
            ONNX["In-Browser Embeddings<br/>@xenova/transformers (gte-small ONNX)"]
            
            subgraph AI_Adapters["AI Provider Adapters (BYO-Key)"]
                GEM_A["GeminiClientAdapter<br/>gemini-2.5-flash"]
                OAI_A["OpenAIClientAdapter<br/>gpt-4o-mini"]
            end
        end
    end

    subgraph Providers["External AI Provider Endpoints"]
        GEM["Google Gemini API<br/>generativelanguage.googleapis.com"]
        OAI["OpenAI API<br/>api.openai.com"]
    end

    UI <-->|browser.runtime.sendMessage| SW
    CS <-->|browser.runtime.sendMessage| SW
    SW <-->|browser.runtime.sendMessage| RPC

    RPC <--> PGL
    RPC <--> ONNX
    RPC <--> GEM_A
    RPC <--> OAI_A

    GEM_A -->|Direct HTTPS (User Key)| GEM
    OAI_A -->|Direct HTTPS (User Key)| OAI
```

- **Local storage engine:** Memory bank, documents, vector embeddings, Q&A history, style profiles, and telemetry reside exclusively on-device in PGlite WASM backed by IndexedDB (`idb://jobibi-local-memory`).
- **Offscreen compute host:** PGlite WASM, ONNX vector embedding generation (`gte-small`), and AI provider HTTP requests run inside a dedicated Chrome offscreen document, isolated from service worker termination limits.
- **Direct client AI calls:** Drafting and gap-question requests flow directly from the offscreen host to Google Gemini or OpenAI with zero intermediary servers.

### Local-First Runtime Guardrails (D22, D26)

1. **Centralized PGlite host in offscreen context:** PGlite WASM is instantiated exclusively within the offscreen document.
   The side panel UI and content scripts interact with the database via typed message passing (`browser.runtime.sendMessage`), eliminating IndexedDB multi-context lock contention.
2. **Storage persistence guarantee:** The extension calls `navigator.storage.persist()` on database initialization to protect IndexedDB from Chromium storage eviction during low-disk states.
3. **Background embedding model delivery:** The quantized `gte-small` ONNX vector embedding model (~30MB) is downloaded in the background upon extension installation and cached permanently in browser CacheStorage and IndexedDB.
   Onboarding is displayed immediately without blocking on model download.
4. **Transparent token usage:** Automatic style profile distillation (D19) runs after every 10 qualifying user answers, executing directly via the configured AI provider.
5. **Zero-outbound telemetry boundary:** All `gate_decisions`, `extraction_failures`, and `capture_mismatches` are stored strictly in local PGlite tables.
   All remote analytics and cloud logging are eliminated.
6. **Local data identity:** A synthetic UUID is generated on first launch and stored in `chrome.storage.local` as `jobibi_local_user_id`.
   Schema tables retain their `user_id` column for export and import portability.

## Why this stack

- **Chrome extension (Manifest V3):** The only platform that can both read application forms reliably via direct DOM access and write into them via Auto-Fill without screen OCR or companion apps.
  Edge runs Chrome extensions unmodified.
- **WXT + React + TypeScript + Tailwind:** WXT provides Vite-based modern extension tooling, hot module replacement, and clean MV3 entrypoint bundling.
  React drives the side panel UI; content scripts remain lightweight and dependency-free.
- **Chrome Side Panel API for the Sidekick:** A docked browser panel that operates alongside web content without conflicting with site styles, providing clean ergonomics for reviewing suggestions.
- **PGlite (`@electric-sql/pglite` + `@electric-sql/pglite-pgvector`):** In-process Postgres compiled to WASM running in the browser.
  It preserves the exact Postgres schema, SQL syntax, pgvector indexing, and 0.7/0.3 hybrid search without maintaining backend database infrastructure.
- **Chrome Offscreen Document:** Provides a stable, long-lived DOM context that hosts PGlite WASM, ONNX embeddings, and provider HTTP fetch calls.
  It avoids the 30-second termination limit of Manifest V3 service workers, preventing interrupted WASM initialization and aborted AI requests.
- **ONNX embeddings via `@xenova/transformers` (`gte-small`):** Runs 384-dimensional vector embedding generation client-side in WebAssembly/WebGPU.
  Documents and questions are embedded in-process with zero network latency, zero per-embedding cost, and zero data leakage.
- **Direct client AI adapters (`gemini-2.5-flash` & `gpt-4o-mini`):** Direct HTTPS communication with established AI providers using the user's personal API key.
  Both models support strict JSON schema output, fast response times, and minimal cost (including Gemini's free tier).
- **Monorepo (pnpm):** `apps/extension` (WXT extension) and `packages/shared` (pipeline logic, storage adapters, AI adapters, gate heuristics, and zod schemas).

## The suggestion pipeline

What happens when the user opens an application page:

1. **Extract:** The content script reads the active form (question labels, field types, context markers).
   It records a mapping from each question to its input field with a confidence score.
   Dedicated adapters handle JobStreet, LinkedIn Easy Apply, and Indeed; a generic label-proximity heuristic handles all other pages.

2. **Establish job context:** Role title and company are extracted to differentiate role requirements (e.g. QA testing versus automation engineering).
   Job description text is captured opportunistically when present in the DOM without requiring dedicated listing-page adapters.

3. **Normalize:** Each question is cleaned and canonicalized so variant phrasings match existing records.

4. **Seen-before check:** The pipeline queries local `qa_pairs` in PGlite for near-duplicate questions previously answered by the user.
   Matches surface prior answers with options to reuse or rewrite based on role match.

5. **Retrieve:** Hybrid search in PGlite combines vector cosine similarity (`gte-small` ONNX embeddings) with keyword overlap (0.7 / 0.3 weighting) across `memory_chunks` to locate relevant background.

6. **Salary/notice check:** Executes in code before retrieval, the gate, or any AI provider call.
   Keyword matches on salary or notice period return a static refusal: no stored answer is suggested, and the user answers directly in the form.

7. **The gate:** Deterministic code evaluates question-match and role-match against relative thresholds to pick one of three outcomes:

   | | role-match low | role-match high |
   |---|---|---|
   | **question-match high** | **ASK** | **DRAFT** |
   | **question-match low** | REFUSE | REFUSE |

   Scoring is relative to the user's historical score distribution with an absolute floor for empty memory states.
   The AI model never decides whether to refuse.
   On a refusal, no model call occurs.
   On an ask, the model is called only to word the gap question after code selects the outcome.
   Every gate decision is logged to local PGlite tables for calibration.

8. **Ask (if selected):** The panel displays a single question anchored to an existing memory chunk.
   The user's response is stored in `gap_answers`, embedded into `memory_chunks`, and passed forward to drafting.

9. **Draft:** The offscreen document dispatches a request via the configured `AIAdapter` (Gemini or OpenAI).
   The prompt combines the local style profile, retrieved memory snippets, the question, and job context.
   All drafting calls enforce an explicit length cap and strict JSON schema output.

10. **Render:** The model returns structured JSON, rendered in the side panel as a copy card:

```json
{
  "intro": "Here's a version tailored to the QA role:",
  "answer": "…the copy-paste-ready text…",
  "skeleton": [
    "Built n8n workflow auto-triaging 200+ tickets/week",
    "Hardest part: making it reliable across malformed inputs",
    "Wrote branch-level checks against real production traffic"
  ],
  "outro": "Want it shorter or more technical?",
  "confidence": 0.86,
  "sources": [{ "kind": "qa_pair", "ref": "grab-2026-04", "label": "Your Grab application, Apr 2026" }]
}
```

The user can copy the finished prose, copy the bullet skeleton to write their own text, or click Insert to auto-fill the form field.

## Data model

The local PGlite database manages the following tables:

| Table | Holds | Key columns |
|---|---|---|
| `documents` | Resumes, cover letters, and pasted voice samples | user_id, kind (resume/cover/transcript), extracted_text, parsed_at, origin |
| `memory_chunks` | Searchable semantic chunks | user_id, text, embedding (vector 384), source ref, type, freshness_at |
| `applications` | Tracked job applications | user_id, company, role, site, url_hash, status, submitted_at |
| `qa_pairs` | Stored question-and-answer pairs | user_id, question_norm, embedding, answer_text, application_id, **draft_text**, **origin**, **edit_distance** |
| `gap_answers` | Responses to Jobibi-initiated gap questions | user_id, question_asked, answer_text, anchored_chunk_id, application_id, created_at |
| `style_profile` | Distilled writing voice observations | user_id, profile_md, generated_at, corpus_size, rebuilding |
| `gate_decisions` | Local gate calibration telemetry | user_id, application_id, question_norm, question_match, role_match, outcome, user_action, created_at |
| `capture_mismatches` | Audit log for dropped field mappings (D16) | user_id, application_id, question_label, original_mapping, rederived_mapping, reason, created_at |
| `extraction_failures` | Telemetry for adapter DOM extraction issues | user_id, adapter, host, url, url_hash, detected_fields, extracted_questions, failure_reason, created_at |

- `user_id` across all tables is populated with the synthetic local user ID (`jobibi_local_user_id` in `chrome.storage.local`).
- `documents.storage_path` is unused in local mode; raw binary files are discarded after client-side parsing into `documents.extracted_text`.
- User preferences (`output_length`, provider, API key) are stored in `chrome.storage.local`.
- No `profiles` table is used.
- Local data export produces a unified JSON dump; deletion drops the local IndexedDB database entirely.
- Individual `qa_pairs` rows can be deleted independently from the Memory Bank UI.

## Capture — how the memory bank actually grows

The memory bank grows when Jobibi captures what the user *submitted*, not what was initially offered.
Relying on manual save actions results in lost learning opportunities.

The content script watches mapped form fields and reads their final values upon submit button click or page navigation.
Captured answers are diffed against the initial draft to compute `origin` (`user_written`, `user_edited`, or `accepted_verbatim`) and `edit_distance`.

**Scope of what is read:** Every field identified as an application question is read at submission, including questions Jobibi refused or did not draft.
This ensures user-written answers fill knowledge gaps for future applications.
Fields not identified as questions (passwords, addresses, file uploads) are never read.

**Guard against silent corruption (D16):** The question-to-field mapping is independently re-derived at submission time and compared against the initial suggestion mapping.
If mappings agree, the captured answer is written to PGlite.
If mappings disagree, the write is dropped and logged to `capture_mismatches`.
Auto-Fill uses the same confidence check, disabling direct insertion when mapping confidence is below 0.75.

## Memory growth and the style profile

- On submission, captured answers are written to `qa_pairs` and chunked into `memory_chunks` (skipping chunk insertion for near-duplicate questions with similarity ≥ 0.90).
- A background distillation task in the offscreen document checks if the qualifying voice corpus has grown by 10 items since the last rebuild (D19).
- **The voice corpus is strictly filtered by origin:** It includes only `user_written` and `user_edited` entries from `qa_pairs`, `documents`, and `gap_answers`.
  Verbatim-accepted drafts (`accepted_verbatim`) are excluded to prevent the model from learning its own output.
- Distillation produces `profile_md` (5–8 concise bullets describing sentence length, formality, and stylistic traits) and caches it in `style_profile`.
- Subsequent drafting calls inject the style profile into the system prompt.

## Auto-Fill mechanics

Auto-Fill is available to all users as a standard feature.
When the user clicks Insert on a draft card, the content script updates the target field using native property setters and dispatches `input`, `change`, and `blur` events to ensure compatibility with reactive frameworks.
Salary and notice questions are statically refused at the pipeline level and cannot be auto-filled.
Low-confidence mappings (< 0.75) disable the Insert button.
Jobibi never submits forms automatically; the user always reviews and clicks submit.

## Cost model (BYO-Key)

Users provide their own API key and pay their provider directly.
Jobibi incurs zero operational hosting or AI costs.

| Provider | Model | Typical Pricing | Effective Cost per Question |
|---|---|---|---|
| **Google Gemini** | `gemini-2.5-flash` | Free tier (15 RPM, 1M TPM, 1,500 RPD)<br/>Paid: $0.075 / $0.30 per MTok | **$0.00** (Free Tier)<br/>≈ $0.00015 (Paid) |
| **OpenAI** | `gpt-4o-mini` | $0.15 / $0.60 per MTok | ≈ **$0.0003** per question<br/>(≈ $0.006 per 20-question app) |

- Embeddings are completely free, computed locally via the `gte-small` ONNX model.
- Drafting calls enforce strict `output_length` token constraints to prevent excessive token usage on personal API keys.

## Security and privacy notes

- **Zero remote data storage:** No user data, resumes, answers, or embeddings are transmitted to Jobibi servers.
  Everything is persisted in local IndexedDB storage.
- **Ephemeral AI requests:** AI calls transmit only the active question, relevant memory snippets, and the style profile directly to the user's selected provider (Google or OpenAI).
  No intermediary proxy inspects or logs requests.
- **Credential security:** API keys and local user IDs are stored exclusively in `chrome.storage.local` within the user's browser profile.
- **Manifest V3 compliance:** Extension code runs entirely from the local bundle with no remote script execution.
  Host permissions are restricted to provider API endpoints and model weights CDN.
- **Targeted DOM reading:** Content scripts read only identified question fields during form interaction and submission, ignoring non-application form fields.

## Known risks

- **PGlite WASM footprint:** PGlite WASM and its pgvector module require ~10–15MB of memory within the offscreen document.
  Mitigation: Hosting PGlite in a single offscreen document prevents multiple runtime allocations across tabs.
- **Initial embedding model download:** Downloading the ~30MB `gte-small` ONNX model may take several seconds on slow connections.
  Mitigation: Background prefetching begins immediately on install, while onboarding remains interactive; an inline spinner appears only if an upload occurs before download completion.
- **IndexedDB eviction:** Browsers under extreme disk pressure may clear IndexedDB data.
  Mitigation: The extension requests persistent storage via `navigator.storage.persist()` on initial launch.
- **ATS DOM drift:** Target job sites periodically modify their DOM structure, risking extraction failures.
  Mitigation: Comprehensive fixture test suites, generic fallback extractor, and the D16 re-derive mapping validation that drops mismatched writes.
- **Gate calibration:** Relative thresholds must accurately distinguish between drafting, asking, and refusing across varying corpus sizes.
  Mitigation: Tuning against a golden test fixture and recording all decisions to local telemetry tables.

