export const APP_NAME = 'Jobibi';

// Deliberately not re-exported here: apps/extension imports this module, and
// pdf/docx parsing is server-side-only (the ingest Edge Function imports
// ./ingestion/*.ts directly). Barrel-exporting them would drag unpdf/fflate
// into the browser bundle for a codepath that never runs there.

export const DOCUMENT_KINDS = ['resume', 'cover_letter', 'transcript'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// Kept in its own leaf module (not defined here) so Deno Edge Functions can
// import the type without pulling in this barrel's DOM-typed adapter exports.
export { SENSITIVE_FACT_KINDS } from './sensitiveFactKind.ts';
export type { SensitiveFactKind } from './sensitiveFactKind.ts';

// Adapter types are lightweight and safe for the extension bundle (no ingestion deps).
export type {
  ExtractedQuestion,
  ExtractionResult,
  FieldType,
  JobContext,
  LabelSource,
  MappingConfidence,
} from './adapters/types.ts';
export { extractJobStreetQuestions } from './adapters/jobstreet.ts';

// Capture helpers (S6) — lightweight, safe for extension bundle
export {
  deriveOrigin,
  levenshtein,
  verifySingleMapping,
  verifyCaptureMappings,
  findSeenBefore,
  scoreNearDuplicate,
} from './capture/capture.ts';
export type { QaOrigin, OriginResult, MappingVerifyResult } from './capture/capture.ts';
