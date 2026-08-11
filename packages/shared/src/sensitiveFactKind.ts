export const SENSITIVE_FACT_KINDS = ['salary', 'notice_period', 'work_authorization', 'location'] as const;
export type SensitiveFactKind = (typeof SENSITIVE_FACT_KINDS)[number];
