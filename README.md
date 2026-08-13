# Jobibi

A privacy-first job application assistant for the Philippine market — a Chrome extension that sits beside the application form you're filling out and suggests answers grounded in your own history, in your own voice.

Not an auto-applier. Jobibi is an *editor of your best self*: the human always reviews, edits, and submits.

For each question it does one of three things — drafts an answer, asks you one short question when it has a good story but not the right angle, or declines when it has nothing relevant. Which one is chosen by code, not by the model.

**Status:** Phase 2 complete — S7B shipped on `fm/jobibi-s7b-linkedin-detection-scoping` (LinkedIn Easy Apply detection scoping — dialog-only, Additional Questions step only, cover-letter co-location). See [docs/build/project-build-progress.md](docs/build/project-build-progress.md) for the authoritative build state.

## Documentation

| Doc | What's in it |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Shared vocabulary — what each term means and which words to avoid |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Vision, problem, market, feature set, trust stance |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, system design, data model, pipeline, costs |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log — accepted decisions and open questions |
| [docs/build/v0.1.md](docs/build/v0.1.md) | Authorized build plan (see project-build-progress.md for current state) |
| [docs/build/project-build-progress.md](docs/build/project-build-progress.md) | Single source of truth for current state |
