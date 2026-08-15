# Jobibi 🪄

> **Draft job-application answers grounded in your own history, in your own voice.**

Jobibi is an open-source Chrome extension that sits in your browser side panel beside job application forms on **JobStreet**, **LinkedIn**, and **Indeed**. It retrieves relevant experiences from your resume, past cover letters, and previous answers to draft tailored, copy-paste-ready responses.

Jobibi is **not an auto-applier**. It is an *editor of your best self*: the human always reviews, edits, and submits.

---

## ✨ Key Features

* **🎯 ATS Coverage & Detection:** Real-time form question extraction across **JobStreet**, **LinkedIn Easy Apply**, **Indeed SmartApply**, and long-tail job sites (universal generic fallback).
* **⚖️ The 3-Way Grounded Gate:** For every question, Jobibi decides by code (never model hallucination) whether to **Draft** (strong relevant experience), **Ask** (good story but needs a clarifying detail), or **Refuse** (no relevant experience).
* **⚡ Smart Auto-Fill:** 1-click DOM form injection with strict confidence gating ($<0.75$ safety threshold) — it only fills when it is confident it has the right field.
* **📝 Cover Letter Generator:** Paste any job description to generate a structured, provenance-cited cover letter with configurable length caps.
* **🧠 Progressive Memory Bank:** Form submissions automatically capture submitted answers, deduplicating vector embeddings ($\ge 0.90$ similarity) and distilling your unique writing style profile after 10 qualifying answers.
* **🛡️ High-Stakes Honesty:** Salary expectations and notice periods are dynamic refusals — Jobibi never invents, guesses, or drafts them.
* **🔒 Privacy & Isolation:** Zero cross-user training. 100% database-enforced Row-Level Security (RLS), 1-click JSON data export, per-answer deletion, and full account purge.

---

## 🛠️ Architecture & Tech Stack

```
jobibi/
├── apps/
│   └── extension/          # Chrome MV3 Extension (WXT + React 19 + Tailwind CSS)
├── packages/
│   └── shared/             # Storage adapters, gate logic, ATS extractors, Zod schemas
└── supabase/
    ├── functions/          # 8 Supabase Edge Functions (Deno + OpenAI GPT-5.6 Luna)
    └── migrations/         # Supabase Postgres schema & pgvector vector storage
```

* **Frontend:** WXT, React 19, Tailwind CSS, Lucide Icons, Nunito Typography.
* **AI & Embeddings:** OpenAI GPT-5.6 Luna (strict JSON schema outputs) and in-process `gte-small` embeddings.
* **Backend:** Supabase Postgres + `pgvector`, Row-Level Security (RLS) on all tables.
* **Testing:** Vitest (unit & parity testing) + Playwright (headless & headed Chrome MV3 E2E testing).

---

## 🚀 Quickstart & Local Setup

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/alvinleyble/jobibi.git
cd jobibi
pnpm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Set your Supabase project URL and public anon key in `.env`:

```env
WXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
WXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Build the Extension

```bash
# Build the Chrome MV3 bundle
pnpm build

# Or run in development watch mode
pnpm dev
```

### 4. Load into Chrome

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right toggle.
3. Click **Load unpacked**.
4. Select the output directory: `apps/extension/.output/chrome-mv3`.
5. Open the side panel from the extension toolbar icon!

---

## 🧪 Testing & Verification

```bash
# Run all unit and parity tests (260+ tests)
pnpm test

# Run TypeScript compilation check
pnpm compile

# Run automated Playwright E2E test suite across ATS fixtures
pnpm test:e2e
```

---

## 📚 Documentation & Design Records

| Document | Purpose |
| :--- | :--- |
| [**CONTEXT.md**](CONTEXT.md) | Shared vocabulary — precise product terms and concepts. |
| [**docs/PRODUCT.md**](docs/PRODUCT.md) | Product vision, target users, trust stance, and core thesis. |
| [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) | Deep system architecture, data models, and token cost economics. |
| [**docs/DECISIONS.md**](docs/DECISIONS.md) | Architectural Decision Records (ADRs D1 through D22). |
| [**docs/build/v0.1.md**](docs/build/v0.1.md) | Master build roadmap and slice plans. |
| [**docs/build/project-build-progress.md**](docs/build/project-build-progress.md) | Single source of truth for build progress and landed commits. |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
