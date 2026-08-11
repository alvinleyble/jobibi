/**
 * S5c — sensitive golden cases for union detector verification.
 *
 * Each case is a (question × sensitive_facts → expect sensitive) triple.
 * At least half are oblique (no rule-list keyword) to prove retrieval's job.
 * Rule list in sensitive.ts is deliberately narrow:
 *   salary: ['salary']
 *   notice: ['notice period','notice']
 *   visa:   ['work authorization','visa']
 *   location: ['location','relocation']
 * so oblique cases must be caught by retrieval alone.
 */

import type { SensitiveFact } from './sensitive.ts';
import type { SensitiveFactKind } from '../index.ts';

export interface SensitiveGoldenCase {
  id: string;
  question: string;
  // facts seeded for this case (synthetic)
  facts: SensitiveFact[];
  // expected union result
  expectSensitive: boolean;
  expectKind: SensitiveFactKind | null;
  // whether rule keyword is present in question (for audit)
  hasRuleKeyword: boolean;
  justification: string;
  tags: string[];
}

function fact(kind: SensitiveFactKind, value: string, stated_at = '2026-04-15T00:00:00Z'): SensitiveFact {
  return { id: `fact-${kind}`, kind, value, stated_at, confirmed_at: null };
}

const ALL_FACTS: SensitiveFact[] = [
  fact('salary', '₱45,000/month'),
  fact('notice_period', '30 days'),
  fact('work_authorization', 'PH citizen, no visa needed'),
  fact('location', 'Quezon City, PH (open to remote)'),
];

export const SENSITIVE_GOLDEN_SET: SensitiveGoldenCase[] = [
  // ── Direct keyword hits (rule should fire) ─────────────────────────
  {
    id: 'S001',
    question: 'What is your expected salary?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'salary',
    hasRuleKeyword: true,
    justification: 'Direct salary keyword → rule fires (union true).',
    tags: ['salary', 'rule', 'direct'],
  },
  {
    id: 'S002',
    question: 'What is your notice period?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'notice_period',
    hasRuleKeyword: true,
    justification: 'Direct notice period keyword → rule fires.',
    tags: ['notice_period', 'rule', 'direct'],
  },
  {
    id: 'S003',
    question: 'Do you require visa sponsorship to work in the Philippines?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'work_authorization',
    hasRuleKeyword: true,
    justification: 'Direct visa keyword → rule fires.',
    tags: ['work_authorization', 'rule', 'direct'],
  },
  {
    id: 'S004',
    question: 'Are you willing to relocate for this role?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'location',
    hasRuleKeyword: true,
    justification: 'Relocate keyword (location variant) → rule fires.',
    tags: ['location', 'rule', 'direct'],
  },
  {
    id: 'S005',
    question: 'Current location?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'location',
    hasRuleKeyword: true,
    justification: 'location keyword → rule fires.',
    tags: ['location', 'rule', 'direct'],
  },
  {
    id: 'S006',
    question: 'What is your work authorization status?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'work_authorization',
    hasRuleKeyword: true,
    justification: 'work authorization phrase → rule fires.',
    tags: ['work_authorization', 'rule', 'direct'],
  },

  // ── Oblique phrasings (NO rule keyword) — retrieval must catch ─────
  {
    id: 'S007',
    question: 'What compensation range are you targeting?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'salary',
    hasRuleKeyword: false,
    justification: 'No salary keyword, but compensation/range/targeting semantically salary → retrieval fires. The D17 canonical long-tail case.',
    tags: ['salary', 'retrieval', 'oblique'],
  },
  {
    id: 'S008',
    question: 'When could you be available to join us?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'notice_period',
    hasRuleKeyword: false,
    justification: 'No notice keyword; available/join maps to notice_period descriptor → retrieval fires.',
    tags: ['notice_period', 'retrieval', 'oblique'],
  },
  {
    id: 'S009',
    question: 'How soon can you start?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'notice_period',
    hasRuleKeyword: false,
    justification: 'No notice keyword; how soon/can you start maps to notice_period → retrieval.',
    tags: ['notice_period', 'retrieval', 'oblique'],
  },
  {
    id: 'S010',
    question: 'Are you legally eligible to work in this country?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'work_authorization',
    hasRuleKeyword: false,
    justification: 'No visa/work authorization keyword; legally eligible maps to work_authorization descriptor → retrieval.',
    tags: ['work_authorization', 'retrieval', 'oblique'],
  },
  {
    id: 'S011',
    question: 'Where are you currently based?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'location',
    hasRuleKeyword: false,
    justification: 'No location/relocate keyword; where based maps to location descriptor → retrieval.',
    tags: ['location', 'retrieval', 'oblique'],
  },
  {
    id: 'S012',
    question: 'Are you open to moving for this role?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'location',
    hasRuleKeyword: false,
    justification: 'moving (not relocate) maps to location → retrieval. Rule has relocate but not moving.',
    tags: ['location', 'retrieval', 'oblique'],
  },
  {
    id: 'S013',
    question: 'What pay expectations do you have?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'salary',
    hasRuleKeyword: false,
    justification: 'pay (not salary) maps to salary descriptor → retrieval.',
    tags: ['salary', 'retrieval', 'oblique'],
  },
  {
    id: 'S014',
    question: 'Do you need sponsorship to work here?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'work_authorization',
    hasRuleKeyword: false,
    justification: 'sponsorship (no visa phrase) maps to work_authorization → retrieval.',
    tags: ['work_authorization', 'retrieval', 'oblique'],
  },
  {
    id: 'S015',
    question: 'What is your desired package?',
    facts: ALL_FACTS,
    expectSensitive: true,
    expectKind: 'salary',
    hasRuleKeyword: false,
    justification: 'package as salary synonym → retrieval (rule only has salary).',
    tags: ['salary', 'retrieval', 'oblique'],
  },

  // ── Non-sensitive — must NOT fire ──────────────────────────────────
  {
    id: 'S016',
    question: 'Tell us about a QA bug you caught before release.',
    facts: ALL_FACTS,
    expectSensitive: false,
    expectKind: null,
    hasRuleKeyword: false,
    justification: 'QA story, no sensitive signal → not sensitive.',
    tags: ['non-sensitive', 'qa'],
  },
  {
    id: 'S017',
    question: 'Describe a time you automated a repetitive task.',
    facts: ALL_FACTS,
    expectSensitive: false,
    expectKind: null,
    hasRuleKeyword: false,
    justification: 'Automation story, no sensitive signal.',
    tags: ['non-sensitive', 'automation'],
  },
  {
    id: 'S018',
    question: 'Why do you want to join our company?',
    facts: ALL_FACTS,
    expectSensitive: false,
    expectKind: null,
    hasRuleKeyword: false,
    justification: 'Motivation question, not about facts → not sensitive.',
    tags: ['non-sensitive'],
  },
  {
    id: 'S019',
    question: 'What is your expected salary?',
    facts: [], // no facts seeded — rule still fires, but no fact to show (still sensitive per union rule? Actually spec: union detection routes to always-confirm. If no fact, still sensitive but card empty.)
    expectSensitive: true,
    expectKind: 'salary',
    hasRuleKeyword: true,
    justification: 'Salary question with no facts — rule still fires (question is sensitive regardless of fact existence).',
    tags: ['salary', 'rule', 'no-facts'],
  },
  {
    id: 'S020',
    question: 'What compensation range are you targeting?',
    facts: [], // no facts — retrieval cannot fire (needs fact), so not sensitive? But rule misses, so union false. This edge is intentional: without facts, oblique cannot be retrieval-caught.
    expectSensitive: false,
    expectKind: null,
    hasRuleKeyword: false,
    justification: 'Oblique salary without any facts — retrieval has nothing to match, so not sensitive. Intake seeding (D18) prevents this in practice.',
    tags: ['salary', 'oblique', 'no-facts', 'edge'],
  },
];
