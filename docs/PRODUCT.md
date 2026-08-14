# Jobibi — Product Vision

*Drafted 2026-08-09. Revised 2026-08-09 to record the outcomes of the design grill. See [DECISIONS.md](DECISIONS.md) for the decision log and [CONTEXT.md](../CONTEXT.md) for shared vocabulary.*

## The problem

Applying for jobs is repetitive, and the repetition is not copy-paste-able: the same "tell us about a project you're proud of" question needs a different telling for an n8n/Make.com automation role than for a Software QA role. Rewriting situational summaries and portfolio examples per job type is the friction that makes people submit generic answers — or give up on tailoring entirely.

## What Jobibi is — and is not

Jobibi is an **editor of your best self**. It reads the questions on the application form you have open, retrieves the relevant pieces of *your* real history — resumes, cover letters, transcripts, and every answer you've previously submitted — and drafts a tailored, copy-paste-ready answer in your voice.

It is deliberately **not** an auto-applier:

- The human always reviews, edits, and submits. Even the premium Auto-Fill feature only types into fields; the user still checks and clicks submit.
- Suggestions are strictly grounded in the user's own material. Jobibi has three honest responses to a question, never one invented one: it drafts, it asks, or it declines.
- Because every answer is grounded in one person's real history, the substance is genuinely theirs — not a template, not a generic profile, not a claim they can't back up in an interview.

**A note on AI detection.** Companies increasingly screen for AI-generated applications, and grounding helps with part of that problem but not all of it. Answers built from one person's real history are not correlatable across applicants the way template-driven tools' output is. But detection tooling mostly reads *style*, not cross-applicant similarity — and a grounded answer written by a model is still written by a model. The honest claim is authenticity of substance, and the lever for authenticity of *voice* is the style profile plus the option to write the prose yourself (see feature 2). We do not promise users they won't be flagged.

## Who it's for

Philippine jobseekers first — JobStreet, LinkedIn, and Indeed heavy users, applying from desktop browsers. International scaling comes later; nothing in the architecture is PH-locked, but coverage, examples, and (eventually) pricing and payment rails are PH-first.

## Core features (v1)

1. **The Sidekick panel.** A docked side panel in Chrome that reads the questions on the active application page and shows suggested answers alongside it.

2. **Copy-paste-first output, in two forms.** Every suggestion renders as a distinct *copy card*: any conversational intro/outro from the assistant is structurally separated from the answer itself, and the answer has a one-click copy button. Each card also carries the **skeleton** behind the answer — the bullet outline it was built from — so a user who would rather write the prose themselves can copy the structure instead. Both are produced by structured output from the model, never by prompt formatting tricks.

3. **Progressive memory.** Day one, the memory bank holds only what the user uploads at onboarding (a resume, plus an optional pasted career-highlights/voice sample). The four repeating facts — salary expectation, notice period, work authorisation, location — are no longer front-loaded at install; each is collected the first time it's actually needed, via the same always-confirm card that handles any sensitive field (D18). Every completed application feeds submitted answers back into memory. After roughly 15–20 applications the assistant is attuned to the user's tone and best stories.

   Each stored answer records **how it was produced** — written by the user, edited from a draft, or accepted verbatim. Only what the user actually wrote or meaningfully edited teaches Jobibi their voice. Drafts accepted unchanged stay searchable as content but are excluded from voice learning, so the assistant never drifts toward its own writing over time.

4. **Three honest outcomes, decided by code.** For each question Jobibi either **drafts**, **asks**, or **refuses** — and which one is chosen by ordinary code, not by the model's discretion:

   - **Draft** — the memory bank has relevant material that fits this kind of role.
   - **Ask** — there's a good story here, but it's thin for the angle this job needs. Rather than padding it out or giving up, Jobibi asks one short question anchored to something already in your history ("Your CV says you cut ticket triage time — what was the hardest part of making that reliable?"), then drafts, then keeps the answer. This is the common case early on, and it is how the memory bank fills.
   - **Refuse** — nothing relevant. Jobibi says so rather than inventing.

   The model is never consulted about whether to refuse. It is only asked to word the gap question after code has already decided to ask.

5. **High-stakes provenance.** Salary expectations, visa/work authorization, notice period, and relocation are *always-confirm* fields: never auto-suggested blindly, never auto-filled, at any tier. The panel shows the stored fact **with its source** — "You said ₱X on your Stripe application, April 2026 — still true?" Detection is deliberately over-inclusive: an unnecessary confirmation costs one click, a missed one puts a wrong salary figure into a real application.

6. **Premium Auto-Fill (paywalled).** Free users copy-paste. Premium users get an Insert button that types the suggestion directly into the form field. Sensitive fields are excluded regardless of tier, and Auto-Fill stands down entirely when Jobibi isn't confident it has the right field.

7. **Grill Me mode.** The assistant proactively interviews the user to refresh stale facts ("Has your salary expectation changed? New tools since last year?"). Every stored fact carries a freshness clock that drives both proactive grill sessions and contextual re-confirmation mid-application.

8. **Media branching.** When a form asks for something the assistant cannot produce (e.g., a 1–3 minute video), it recognizes the field type and offers a dedicated session to draft a script or talking points from the user's portfolio instead.

## What day one looks like

A new user uploads a resume and answers four quick questions — salary expectation, notice period, work authorization, location. That takes about a minute and it is the whole of onboarding.

Their first real application is where the memory bank actually fills. Resumes contain titles, dates, and responsibility bullets; they contain almost no stories, and behavioural questions want stories. So on that first form Jobibi will ask more than it drafts. Every answer given goes into the form the user needed to fill anyway — and stays in memory for every application after it.

This is a deliberate trade: no long interview before the product has proven anything, at the cost of a first session that feels more like a conversation than magic.

## Trust and privacy stance

- Per-user isolation is enforced by the database itself (row-level security), not by application code being careful.
- **What Jobibi reads:** your answers to the application questions on the page, including ones it didn't help with — that's how it learns from the gaps in what it knows. It never reads fields it hasn't identified as application questions, such as ID numbers, addresses, or file uploads. This is stated plainly at onboarding, not buried in a policy page.
- Users can export their entire memory bank, delete it wholesale, and delete any **single stored answer** — the last one matters, because Jobibi captures answers to questions it had no hand in.
- Per suggestion, only the question, the retrieved snippets, and the user's style profile are sent to the AI — never another user's data. No cross-user training. The model provider does not train on API traffic.
- Philippine Data Privacy Act compliance is an open item to resolve before public launch (see DECISIONS).

## Competitive frame

Simplify, Teal, and similar tools do profile-based autofill and generic AI drafting, US-first. Jobibi's wedge: **provenance-grounded personal memory** (it cites where your answer came from), **honest refusal** (it won't invent — and it asks rather than padding), and **PH-first coverage** (JobStreet-class sites that US tools ignore).

## Business model (initial hypothesis)

- **Free:** suggestions with manual copy-paste, daily cap.
- **Premium:** Auto-Fill + higher limits.
- **Beta:** everything free, premium behind a waitlist; payment rails deliberately deferred (DECISIONS D3).

## Explicitly out of v1

Desktop screen-aware app, mobile, local-only memory mode, voice interaction, payment rails, Workday and long-tail ATS adapters (generic fallback only), and any recruiter/team-side features.
