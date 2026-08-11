import type { GoldenCase } from './types.ts';

/**
 * S4.5 — The golden set (D15).
 *
 * ~50 (question × memory → expected outcome) triples.
 * Hand-written, no generation. Each justification names the two axes:
 *   question-match (does history contain material for this question?)
 *   role-match (does that material fit this role family?)
 *
 * Gate table (ARCHITECTURE.md):
 *   q-high + r-high = DRAFT
 *   q-high + r-low  = ASK   (the hard case — strong story, wrong family)
 *   q-low (any r)   = REFUSE
 *
 * Tuning bias is toward ASK (a wrong ask costs one question, a wrong draft costs trust).
 * Sensitive kinds (salary/notice/visa/relocation) are not in this fixture — they are
 * handled by S5c's union detector *before* the gate, so including them would conflate two stages.
 *
 * Coverage: 18 draft / 16 ask / 16 refuse = 50. Tags make coverage auditable.
 */

export const GOLDEN_SET: GoldenCase[] = [
  // ── DRAFT: q-high + r-high ──────────────────────────────────────────
  {
    id: 'G001',
    question: 'Tell us about a QA bug you caught before release and how you did it.',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [
      'At ProbeCX I built branch-level checks for the n8n ticket triage workflow that handled 200+ tickets/week, catching malformed JSON that had slipped through QA for months.',
      'I wrote a regression checklist for the Grab onboarding flow and logged the JIRA ticket that blocked a release until the edge case was fixed.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (direct QA bug story) + r-high (QA role matches QA history) → draft.',
    tags: ['draft', 'qa', 'q-high-r-high'],
  },
  {
    id: 'G002',
    question: 'Describe a time you automated a repetitive task. What tools did you use and what was the impact?',
    jobContext: { role: 'Automation Specialist', company: 'Acme BPO' },
    memoryChunks: [
      'Built an n8n workflow auto-triaging 200+ tickets/week across three inboxes, routing by keyword and urgency, cutting manual triage from 3 hours to 20 minutes daily.',
      'Hardest part was making it reliable across malformed inputs — added schema validation, dead-letter queue, and branch-level checks against real production traffic.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (direct automation story with impact) + r-high (automation role ↔ n8n history) → draft.',
    tags: ['draft', 'automation', 'q-high-r-high'],
  },
  {
    id: 'G003',
    question: 'How do you prioritize test cases when time is limited?',
    jobContext: { role: 'Software QA Engineer', company: 'Collabera' },
    memoryChunks: [
      'As QA for a fintech release I prioritized by risk: payment flows first, then PII-handling, then edge cases — and negotiated a 2-day extension for the long tail.',
      'Wrote a risk matrix mapping JIRA labels to release-blocker vs nice-to-test.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (prioritization under time pressure) + r-high (QA role) → draft.',
    tags: ['draft', 'qa'],
  },
  {
    id: 'G004',
    question: 'Give an example of collaborating with developers to resolve a production issue.',
    jobContext: { role: 'Quality Analyst', company: 'ProbeCX' },
    memoryChunks: [
      'During a production hotfix I paired with two engineers to reproduce a race condition, wrote a minimal repro script, and verified the patch against real traffic logs before sign-off.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (collab + production issue) + r-high (QA ↔ QA collaboration history) → draft.',
    tags: ['draft', 'qa'],
  },
  {
    id: 'G005',
    question: 'What is your experience with JIRA, TFS, or other bug tracking tools?',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [
      'Daily JIRA user for 3 years: created 400+ tickets, ran sprint boards, and integrated n8n to auto-create tickets from Slack alerts.',
      'Migrated a team from TFS to JIRA, mapping old work-item types to the new workflow.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (exact tool match) + r-high (QA role asks tools the user knows) → draft.',
    tags: ['draft', 'qa', 'tooling'],
  },
  {
    id: 'G006',
    question: 'Describe a workflow you improved and how you measured success.',
    jobContext: { role: 'Automation Engineer', company: 'Stripe PH' },
    memoryChunks: [
      'Automated ticket triage with Make.com + n8n: measured success as tickets auto-closed (92%) and median time-to-first-response from 45 min to 8 min.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (workflow improvement) + r-high (automation role) → draft.',
    tags: ['draft', 'automation'],
  },
  {
    id: 'G007',
    question: 'How do you ensure test coverage for edge cases?',
    jobContext: { role: 'QA Engineer', company: 'GlobalOne' },
    memoryChunks: [
      'Built branch-level checks against real production traffic sampled weekly — replayed 10k malformed payloads through the workflow to catch silent drops.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (edge-case coverage via concrete technique) + r-high (QA) → draft.',
    tags: ['draft', 'qa'],
  },
  {
    id: 'G008',
    question: 'Tell us about a time you handled a difficult stakeholder or client.',
    jobContext: { role: 'Customer Support Lead', company: 'ProbeCX' },
    memoryChunks: [
      'As support lead I de-escalated a churn-risk client by running a joint RCA, sharing the fix timeline daily, and delivering a postmortem that restored the renewal.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (stakeholder handling story) + r-high (support lead role matches history) → draft.',
    tags: ['draft', 'support'],
  },
  {
    id: 'G009',
    question: 'What is your approach to regression testing?',
    jobContext: { role: 'Software QA Engineer', company: 'NTT Data' },
    memoryChunks: [
      'Maintain a living regression pack per microservice, run smoke on every merge, and tag flaky tests for quarantine after 3 failures. Caught a payment regression 2 hours before release.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (regression approach) + r-high (QA role) → draft.',
    tags: ['draft', 'qa'],
  },
  {
    id: 'G010',
    question: 'Describe a time you reduced operational toil with scripting or no-code tools.',
    jobContext: { role: 'Automation Specialist', company: 'Ingram Micro' },
    memoryChunks: [
      'Replaced a daily CSV hand-off with an n8n + Google Sheets automation, eliminating 5 hours/week of copy-paste and cutting errors to zero.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (toil reduction via automation) + r-high (automation role) → draft.',
    tags: ['draft', 'automation'],
  },
  {
    id: 'G011',
    question: 'How do you document test plans so others can follow them?',
    jobContext: { role: 'Quality Analyst', company: 'Acme' },
    memoryChunks: [
      'Write one-page test plans per feature: scope, risks, data needs, and Given/When/Then checklists linked to JIRA. Onboarded two junior QAs in one sprint.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (test-plan documentation) + r-high (QA) → draft.',
    tags: ['draft', 'qa'],
  },
  {
    id: 'G012',
    question: 'Give an example of using data to decide what to test or automate next.',
    jobContext: { role: 'QA Engineer', company: 'ProbeCX' },
    memoryChunks: [
      'Analyzed 6 months of Zendesk tags — 40% of escapes were checkout-related, so I proposed automating checkout smoke first and tracked escape rate dropping from 12% to 4%.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (data-driven prioritization) + r-high (QA/data role) → draft.',
    tags: ['draft', 'qa', 'data-driven'],
  },
  {
    id: 'G013',
    question: 'What makes you a good fit for this Customer Support role?',
    jobContext: { role: 'Customer Support Specialist', company: 'Airbnb PH' },
    memoryChunks: [
      'Two years handling 60+ tickets/day with 98% CSAT, plus building macros and a knowledge-base article that cut repeat contacts by 18%.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (fit + support evidence) + r-high (support role ↔ support history) → draft.',
    tags: ['draft', 'support'],
  },
  {
    id: 'G014',
    question: 'Describe your experience with API testing.',
    jobContext: { role: 'QA Engineer', company: 'PayMongo' },
    memoryChunks: [
      'Tested REST APIs with Postman + k6: contract tests, auth flows, and load tests for the payments endpoint that caught a missing idempotency key bug.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (API testing) + r-high (QA at payments co.) → draft.',
    tags: ['draft', 'qa', 'api'],
  },
  {
    id: 'G015',
    question: 'Tell us about an n8n or Make.com workflow you are proud of.',
    jobContext: { role: 'Automation Engineer', company: 'Relay' },
    memoryChunks: [
      'Proudest is the 200+ ticket/week triage workflow in n8n with error branching and Slack approvals — survived a schema migration without dropping a message.',
      'Second workflow synced Stripe events to Notion for finance reconciliation.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (exact n8n question ↔ n8n history) + r-high (automation role) → draft.',
    tags: ['draft', 'automation', 'n8n'],
  },
  {
    id: 'G016',
    question: 'How do you handle tight deadlines without sacrificing quality?',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [
      'Negotiate scope, not quality: during a 4-day release crunch I proposed testing the top 3 risk areas first and got a 2-day buffer for the rest — shipped with zero P1s.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (deadline vs quality story) + r-high (QA role) → draft.',
    tags: ['draft', 'qa'],
  },
  {
    id: 'G017',
    question: 'What tools or methods do you use for defect reporting?',
    jobContext: { role: 'QA Engineer', company: 'Collabera' },
    memoryChunks: [
      'Report in JIRA with repro steps, expected vs actual, logs, and Loom video; tag severity and link to test run. My tickets have a 95% first-pass acceptance rate.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (defect reporting) + r-high (QA) → draft.',
    tags: ['draft', 'qa'],
  },
  {
    id: 'G018',
    question: 'Describe a time you mentored a junior teammate.',
    jobContext: { role: 'QA Lead', company: 'ProbeCX' },
    memoryChunks: [
      'Mentored a junior QA from manual-only to writing Playwright smoke tests, pairing weekly and reviewing PRs — they shipped their first automation PR in month two.',
    ],
    expectedOutcome: 'draft',
    justification: 'q-high (mentoring story) + r-high (QA Lead ↔ QA mentoring history) → draft.',
    tags: ['draft', 'qa', 'mentorship'],
  },

  // ── ASK: q-high + r-low (strong story, wrong family) ───────────────
  {
    id: 'G019',
    question: 'Tell us about a time you automated a repetitive task at work.',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [
      'Built an n8n workflow auto-triaging 200+ tickets/week, cutting triage from 3 hours to 20 minutes — but this was an automation/ops story, not a QA-mindset story.',
      'Used Make.com for a marketing lead-enrichment flow.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (automation story) but r-low (QA role cares about bug hunting/test strategy, not ops triage) → ask: what QA-relevant automation have you done?',
    tags: ['ask', 'q-high-r-low', 'qa-vs-automation'],
  },
  {
    id: 'G020',
    question: 'How do you ensure test coverage across browsers and devices?',
    jobContext: { role: 'Automation Engineer', company: 'Relay' },
    memoryChunks: [
      'As QA I built a browser matrix and ran Playwright across Chromium/Firefox/WebKit, catching a Safari-only layout break before release.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (coverage story exists) but r-low (automation engineer role wants workflow/tool automation, not manual browser QA) → ask: what automation-specific coverage have you done?',
    tags: ['ask', 'q-high-r-low'],
  },
  {
    id: 'G021',
    question: 'Describe a time you handled a difficult client in a support context.',
    jobContext: { role: 'Software QA Engineer', company: 'NTT Data' },
    memoryChunks: [
      'De-escalated a churn-risk client as support lead: joint RCA, daily updates, postmortem that saved the renewal.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (difficult-client story) but r-low (QA engineer role, not support lead) → ask: tell us about a difficult developer or product stakeholder instead?',
    tags: ['ask', 'support-vs-qa'],
  },
  {
    id: 'G022',
    question: 'Give an example of improving an end-to-end sales or marketing workflow.',
    jobContext: { role: 'Quality Analyst', company: 'ProbeCX' },
    memoryChunks: [
      'Automated ticket triage and marketing lead enrichment in n8n/Make.com, improving throughput 6× — sales/marketing automation, not QA.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (workflow improvement) but r-low (QA role ≠ sales automation) → ask: what QA process did you improve?',
    tags: ['ask', 'q-high-r-low'],
  },
  {
    id: 'G023',
    question: 'What is your approach to performance or load testing?',
    jobContext: { role: 'Customer Support Specialist', company: 'Airbnb PH' },
    memoryChunks: [
      'Ran k6 load tests for the payments API, finding a connection-pool bottleneck at 800 RPS — performance testing expertise.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (perf testing story) but r-low (support role does not call for k6 expertise) → ask: how do you handle performance complaints from customers?',
    tags: ['ask', 'qa-vs-support'],
  },
  {
    id: 'G024',
    question: 'Tell us about an n8n workflow you built.',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [
      'Built n8n triage workflow for 200+ tickets/week with branch-level checks and Slack approvals — pure ops automation.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (n8n workflow) but r-low (QA role wants test-oriented story, not ops routing) → ask: have you used automation to support testing?',
    tags: ['ask', 'n8n-qa-mismatch'],
  },
  {
    id: 'G025',
    question: 'How do you prioritize fixes when everything feels urgent?',
    jobContext: { role: 'Automation Engineer', company: 'Relay' },
    memoryChunks: [
      'As QA lead I ran a risk matrix with product, marking P1 payment bugs vs P3 copy fixes, and sequenced by blast radius — QA prioritization framing.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (prioritization story) but r-low (automation role wants workflow-automation prioritization, not QA risk matrix) → ask: what automation did you prioritize?',
    tags: ['ask', 'q-high-r-low'],
  },
  {
    id: 'G026',
    question: 'Why do you want to join our Support team?',
    jobContext: { role: 'Customer Support Specialist', company: 'ProbeCX' },
    memoryChunks: [
      'Proudest work is building n8n automations and branch-level checks against production traffic — deeply technical, not support-facing.',
      'Enjoy building workflows, less experience with direct customer empathy at scale.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (has work history) but r-low (why-support needs support motivation, not automation pride) → ask: what draws you to support?',
    tags: ['ask', 'motivation-mismatch'],
  },
  {
    id: 'G027',
    question: 'Describe your experience mentoring engineers on testing best practices.',
    jobContext: { role: 'Automation Specialist', company: 'Acme' },
    memoryChunks: [
      'Mentored a junior QA on Playwright and test planning — QA mentoring, not automation-engineering mentoring.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (mentoring story) but r-low (automation specialist role wants workflow mentoring, not QA coaching) → ask about automation mentoring.',
    tags: ['ask', 'q-high-r-low'],
  },
  {
    id: 'G028',
    question: 'Tell us about a bug you found that others missed.',
    jobContext: { role: 'Automation Engineer', company: 'Relay' },
    memoryChunks: [
      'Found a subtle race condition in the QA regression suite by adding branch-level checks against malformed traffic — QA bug hunting, not automation impact.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (bug story) but r-low (automation engineer wants toil-reduction story reframed) → ask: how did automation help find it?',
    tags: ['ask', 'qa-vs-automation'],
  },
  {
    id: 'G029',
    question: 'What draws you to this BPO Operations role?',
    jobContext: { role: 'BPO Operations Associate', company: 'ProbeCX' },
    memoryChunks: [
      'Built technical automations in n8n/Make.com and API tests with Postman+k6 — engineering-centric, not operations shift work.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (has operations-relevant throughput story) but r-low (BPO ops role ≠ engineering automation framing) → ask: what operations experience fits?',
    tags: ['ask', 'eng-vs-bpo'],
  },
  {
    id: 'G030',
    question: 'How do you handle repetitive support tickets?',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [
      'Automated 92% of ticket triage in n8n, building dedupe and routing logic — support automation story in a QA role context.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (repetitive tickets) but r-low (QA role wants test-repetitiveness, not support triage) → ask: how do you handle repetitive test cases?',
    tags: ['ask', 'support-vs-qa'],
  },
  {
    id: 'G031',
    question: 'Describe your leadership style when shipping under pressure.',
    jobContext: { role: 'Automation Specialist', company: 'Relay' },
    memoryChunks: [
      'Led QA sign-off for a 4-day release crunch, negotiating scope and running risk-based smoke — QA leadership, not automation leadership.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (leadership under pressure) but r-low (automation role wants automation-team leadership) → ask: lead an automation effort under pressure?',
    tags: ['ask', 'qa-vs-automation'],
  },
  {
    id: 'G032',
    question: 'Why should we hire you as a Customer Success Manager?',
    jobContext: { role: 'Customer Success Manager', company: 'Airbnb PH' },
    memoryChunks: [
      'Deep QA and automation background: n8n workflows, branch-level checks, JIRA hygiene — little direct success/retention experience.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (has professional history) but r-low (CSM wants retention/relationship framing, not QA depth) → ask: what customer-success outcome are you proud of?',
    tags: ['ask', 'role-family-mismatch'],
  },
  {
    id: 'G033',
    question: 'Tell us about a time you improved documentation or knowledge sharing.',
    jobContext: { role: 'Automation Engineer', company: 'Relay' },
    memoryChunks: [
      'Wrote one-page test plans and Given/When/Then checklists that onboarded junior QAs in one sprint — QA documentation, not runbook automation.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (documentation story) but r-low (automation engineer wants runbook/automation docs) → ask: what automation runbooks have you written?',
    tags: ['ask', 'q-high-r-low'],
  },
  {
    id: 'G034',
    question: 'How do you measure success in your current role?',
    jobContext: { role: 'BPO Team Lead', company: 'ProbeCX' },
    memoryChunks: [
      'Measure success as escape rate dropping 12%→4% and 92% auto-triaged tickets — QA/automation metrics, not BPO handle-time/CSAT.',
    ],
    expectedOutcome: 'ask',
    justification: 'q-high (has success metrics) but r-low (BPO lead expects AHT/CSAT/retention metrics) → ask: what BPO metrics did you move?',
    tags: ['ask', 'metric-mismatch'],
  },

  // ── REFUSE: q-low (any r) ───────────────────────────────────────────
  {
    id: 'G035',
    question: 'Describe your experience deploying Kubernetes at scale in production.',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [
      'QA experience with n8n workflows, JIRA, and manual regression — no Kubernetes or infra experience.',
      'Built Make.com lead enrichment, no container orchestration.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no K8s in memory at all) regardless of r → refuse; never invent.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G036',
    question: 'Have you managed a P&L or owned a quarterly revenue target?',
    jobContext: { role: 'Quality Analyst', company: 'ProbeCX' },
    memoryChunks: [
      'ProbeCX QA and n8n triage automation; no revenue ownership.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no P&L history) → refuse.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G037',
    question: 'What is your experience with US GAAP accounting?',
    jobContext: { role: 'Automation Specialist', company: 'Acme' },
    memoryChunks: [
      'Built ticket triage automations and QA regression packs — no finance/accounting history.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no accounting history) → refuse.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G038',
    question: 'Tell us about your PhD research and publications.',
    jobContext: { role: 'QA Engineer', company: 'GlobalOne' },
    memoryChunks: [
      'No PhD; background is BPO support → QA → n8n automation. No publications.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no academic research in memory) → refuse rather than hallucinate.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G039',
    question: 'How would you design a real-time trading algorithm for equities?',
    jobContext: { role: 'QA Engineer', company: 'PayMongo' },
    memoryChunks: [
      'QA and API testing for payments — no quant or trading experience.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no trading design history) → refuse.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G040',
    question: 'Describe leading a 50-person engineering organization through a reorg.',
    jobContext: { role: 'QA Engineer', company: 'NTT Data' },
    memoryChunks: [
      'Mentored one junior QA and ran sprint QA — no 50-person leadership.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (scale of leadership absent) → refuse; ask would be misleading (nothing to anchor to).',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G041',
    question: 'Why do you want to leave your current role? (and the next question is blank)',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data' },
    memoryChunks: [],
    expectedOutcome: 'refuse',
    justification: 'q-low (empty memory, no material at all) → refuse; absolute floor case for D15.',
    tags: ['refuse', 'empty-memory', 'absolute-floor'],
  },
  {
    id: 'G042',
    question: 'Please share your portfolio link or GitHub with production code samples.',
    jobContext: { role: 'Automation Engineer', company: 'Relay' },
    memoryChunks: [
      'All n8n work was internal to ProbeCX VPN; no public portfolio or GitHub.',
      'Wrote internal docs, no open-source.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no public code to share) → refuse rather than invent a link.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G043',
    question: 'Describe your experience with cold-chain logistics for pharma.',
    jobContext: { role: 'Customer Support Specialist', company: 'Airbnb PH' },
    memoryChunks: [
      'Support and QA background — no logistics or pharma.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (domain absent) → refuse.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G044',
    question: 'What languages do you use to write smart contracts on Ethereum?',
    jobContext: { role: 'QA Engineer', company: 'NTT Data' },
    memoryChunks: [
      'Tested REST APIs with Postman+k6; no smart-contract experience.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no blockchain history) → refuse.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G045',
    question: 'Have you ever built a mobile app that reached 1M downloads?',
    jobContext: { role: 'QA Engineer', company: 'ProbeCX' },
    memoryChunks: [
      'No mobile dev; QA for web workflows, some Playwright.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no mobile app history) → refuse.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G046',
    question: 'Tell us about your experience with Workday configuration.',
    jobContext: { role: 'Quality Analyst', company: 'ProbeCX' },
    memoryChunks: [
      'JIRA/TFS/Playwright experience, no Workday.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no Workday history) → refuse.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G047',
    question: 'Describe a time you negotiated a multi-million peso enterprise contract.',
    jobContext: { role: 'Automation Specialist', company: 'Acme' },
    memoryChunks: [
      'Negotiated QA scope and release timelines, no enterprise contract ownership.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (scale absent) → refuse, not ask (no enterprise contract to anchor a gap question).',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G048',
    question: 'What is your visa sponsorship requirement for the US?',
    jobContext: { role: 'Quality Analyst', company: 'NTT Data PH' },
    memoryChunks: [
      'This is a sensitive fact (work authorization) — but for D15 gate purposes, memory has no visa history either.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low for gate (no visa history to ground) → refuse; in production S5c would intercept as always-confirm before gate.',
    tags: ['refuse', 'q-low', 'sensitive-note'],
  },
  {
    id: 'G049',
    question: 'How do you stay current with QA trends beyond your current stack?',
    jobContext: { role: 'Data Engineer', company: 'Acme Analytics' },
    memoryChunks: [
      'QA regression and n8n automation history — but no data-engineering or pipeline history to ground a data-engineer answer.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (question about QA trends, but role is data engineer — and memory lacks data-eng context) → refuse on q-low; r is also low but q dominates.',
    tags: ['refuse', 'q-low'],
  },
  {
    id: 'G050',
    question: 'Please list your CPA license number.',
    jobContext: { role: 'QA Engineer', company: 'NTT Data' },
    memoryChunks: [
      'Not a CPA; no license. QA background only.',
    ],
    expectedOutcome: 'refuse',
    justification: 'q-low (no CPA history) → refuse; fabricating a license would be harmful.',
    tags: ['refuse', 'q-low'],
  },
];
