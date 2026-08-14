export const APP_NAME = 'Jobibi';

// Deliberately not re-exported here: apps/extension imports this module, and
// pdf/docx parsing is server-side-only (the ingest Edge Function imports
// ./ingestion/*.ts directly). Barrel-exporting them would drag unpdf/fflate
// into the browser bundle for a codepath that never runs there.

// DOCUMENT_KINDS: S8 removed "Upload Cover Letter" and "Upload Transcript"
// from the UploadDocument picker, but both values stay valid here and in
// the DB CHECK constraint
// (supabase/migrations/20260810001000_memory_bank_tables.sql:16) —
// `cover_letter` is still the storage kind for accepted drafts from the
// Draft Cover Letter facility, and `transcript` is kept-but-unreachable so
// the removal stays UI-only with no constraint/type narrowing. Do not
// narrow this list without also handling the DB constraint and S8 flow.
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
export { extractLinkedInQuestions } from './adapters/linkedin.ts';
export { extractIndeedQuestions, INDEED_QUESTIONS_MODULE_PATH_RE } from './adapters/indeed.ts';
export { extractGenericQuestions } from './adapters/generic.ts';
export { CONFIDENCE_BY_SOURCE, FIELD_SELECTOR } from './adapters/helpers.ts';

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
