# Jobibi

Jobibi helps a jobseeker answer the questions on a job application form, using their own history, in their own voice. This file is the shared vocabulary — what each term means, and which words to avoid so they don't drift.

## Language

### The suggestion decision

**Gate**:
The code that decides, for one question, whether Jobibi drafts an answer, asks the user a question, or refuses. It has exactly three outcomes and it is not the model.
_Avoid_: Filter, confidence check, threshold

**Draft**:
The gate outcome where Jobibi produces an answer from what it already knows.

**Ask**:
The gate outcome where Jobibi has relevant material but not enough of it for this job, so it puts one short question to the user before drafting.
_Avoid_: Clarify, follow-up, prompt

**Refusal**:
The gate outcome where nothing in the user's history is relevant, so Jobibi declines to answer rather than inventing one.
_Avoid_: Fallback, no-match, decline

**Question-match**:
How well the user's history relates to the question being asked.

**Role-match**:
How well the user's history fits the kind of job being applied for. Distinct from question-match: a story can answer the question well and suit the role badly.
_Avoid_: Job fit, relevance

**Gap question**:
The single short question Jobibi asks on an *ask* outcome, anchored to something already in the user's history.
_Avoid_: Clarifying question, prompt, interview question

### What Jobibi produces

**Copy card**:
The unit of output for one question: a finished answer, the skeleton behind it, and where the material came from — with the assistant's conversational text kept structurally separate from the answer itself.
_Avoid_: Suggestion card, result, response

**Answer**:
The finished, copy-paste-ready prose on a copy card.

**Skeleton**:
The bullet outline behind an answer, offered so the user can write the prose themselves instead of copying it.
_Avoid_: Outline, bullets, talking points

**Provenance**:
The record of which piece of the user's history an answer came from, shown to the user as a plain-language source line.
_Avoid_: Citation, attribution, reference

### The memory bank

**Memory bank**:
Everything Jobibi knows about one user — uploaded documents, intake answers, stories, facts, and every answer they have submitted.
_Avoid_: Knowledge base, corpus, profile

**Capture**:
Reading a user's submitted answers back off the form and storing them, so the memory bank grows with each application.
_Avoid_: Ingest, sync, harvest

**Origin**:
How a stored answer came to exist — written by the user from scratch, edited from a Jobibi draft, or accepted verbatim. Determines whether it teaches Jobibi the user's voice.
_Avoid_: Source, provenance (reserved above), authorship

**Voice corpus**:
The subset of the memory bank that trains the style profile: only text the user actually wrote or meaningfully edited. Verbatim-accepted drafts are excluded, so Jobibi never learns its own writing back from itself.
_Avoid_: Training set, style corpus

**Style profile**:
The distilled guide to how this user writes, rebuilt from the voice corpus as it grows.
_Avoid_: Tone guide, voice model, persona

**Seen-before**:
The case where the user has already answered this question on a previous application. Whether it is offered for reuse or re-told depends on role-match.
_Avoid_: Duplicate, cache hit, repeat

### High-stakes handling

**Sensitive fact**:
A typed, high-stakes piece of information — salary expectation, notice period, work authorisation, or location — that Jobibi stores with the date and application it came from.
_Avoid_: Sensitive data, PII, critical field

**Always-confirm**:
The handling every sensitive fact receives: shown to the user with its source and asked about, never drafted from and never filled automatically, regardless of tier.
_Avoid_: Confirmation flow, guard, gated field

**Freshness**:
How long a sensitive fact stays trustworthy before Jobibi asks whether it still holds.
_Avoid_: TTL, staleness, expiry

### Reading the page

**Adapter**:
The per-site code that finds the questions on an application form and binds each one to its input field.
_Avoid_: Scraper, parser, connector

**Job context**:
What Jobibi knows about the job being applied for — the role title and company, plus the description when the page happens to carry it. The input to role-match.
_Avoid_: Job data, JD, posting

**Mapping**:
The binding between a question on the page and the field the answer goes into. Re-derived before any capture, because a wrong mapping silently corrupts the memory bank.
_Avoid_: Binding, association, link

**Sidekick**:
The docked panel in the browser where Jobibi shows its copy cards and asks its questions.
_Avoid_: Sidebar, widget, extension UI
