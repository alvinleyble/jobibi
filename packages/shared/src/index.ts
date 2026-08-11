export const APP_NAME = 'Jobibi';

// Deliberately not re-exported here: apps/extension imports this module, and
// pdf/docx parsing is server-side-only (the ingest Edge Function imports
// ./ingestion/*.ts directly). Barrel-exporting them would drag unpdf/fflate
// into the browser bundle for a codepath that never runs there.

export const DOCUMENT_KINDS = ['resume', 'cover_letter', 'transcript'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const SENSITIVE_FACT_KINDS = ['salary', 'notice_period', 'work_authorization', 'location'] as const;
export type SensitiveFactKind = (typeof SENSITIVE_FACT_KINDS)[number];

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
