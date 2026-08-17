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
  scoreMemoryChunkDuplicate,
  extractQuestionFromChunkText,
  isDuplicateQuestion,
  groupQaPairs,
  MEMORY_CHUNK_DEDUP_THRESHOLD,
  NEAR_DUPLICATE_HYBRID_THRESHOLD,
  NEAR_DUPLICATE_KEYWORD_THRESHOLD,
} from './capture/capture.ts';
export type { QaOrigin, OriginResult, MappingVerifyResult, QaPairRow, MemoryChunkRow, QaGroup } from './capture/capture.ts';
export { readHumanValue, readHumanCheckboxGroupValue } from './capture/readHumanValue.ts';
export {
  isSameApplication,
  isStaleStepMismatch,
  resolveCapturePayload,
  defaultJobKeyFromUrl,
  linkedInJobKeyFromUrl,
} from './capture/captureSnapshot.ts';
export type {
  CaptureAnswerEntry,
  CaptureMismatch,
  CaptureSnapshot,
  ResolvedCapturePayload,
  JobKeyFromUrl,
} from './capture/captureSnapshot.ts';
export { normalizeQuestion } from './gate/normalize.ts';

// Style profile (S9) — lightweight, safe for extension bundle (no ingestion deps)
export {
  VOICE_CORPUS_TRIGGER_DELTA,
  VOICE_CORPUS_MAX_ITEMS,
  STYLE_PROFILE_MAX_OUTPUT_TOKENS,
  STYLE_PROFILE_MAX_PROFILE_CHARS,
  STYLE_PROFILE_MAX_BULLETS,
  STALE_REBUILD_MS,
  shouldTriggerRebuild,
  isInFlight,
  buildDistillationSystemPrompt,
  buildDistillationUserContent,
  sanitizeProfileMd,
} from './styleProfile/styleProfile.ts';
export type { VoiceCorpusItem } from './styleProfile/styleProfile.ts';

// Auto-fill (S11) — lightweight, safe for extension bundle
export {
  AUTOFILL_CONFIDENCE_THRESHOLD,
  SUPPORTED_AUTOFILL_INPUT_TYPES,
  isSupportedInputType,
  validateFillableElement,
  fillElementValue,
  executeAutofill,
} from './autofill/autofill.ts';
export type {
  SupportedAutofillInputType,
  InsertFieldPayload,
  InsertFieldResult,
} from './autofill/autofill.ts';

// Settings, Caps & Video Media Branching (S12) — lightweight, safe for extension bundle
export {
  OUTPUT_LENGTHS,
  OUTPUT_LENGTH_CONFIG,
  DAILY_SUGGESTION_LIMIT,
  DAILY_COVER_LETTER_LIMIT,
  DAILY_COVER_LETTER_ATTEMPT_LIMIT,
  VIDEO_QUESTION_KEYWORDS,
  isVideoQuestion,
  trimGracefully,
} from './settings/settings.ts';
export type { OutputLength, OutputLengthConfig } from './settings/settings.ts';

// Paste validation (S3b, S8, S9) — pure text validation, safe for extension bundle
export {
  PASTE_ALLOWED_KINDS,
  PASTE_MIN_CHARS,
  PASTE_MAX_CHARS,
  validatePaste,
  pastedDocumentProvenance,
} from './ingestion/paste.ts';
export type { PasteValidationResult, PastedDocumentProvenance } from './ingestion/paste.ts';

// Storage abstraction (S14A) — one interface over Cloud SaaS (Supabase) and
// Local BYO-Key (PGlite).
//
// PGliteStorageAdapter is deliberately NOT re-exported here, for the same
// reason ./ingestion/* is not: this barrel is what apps/extension imports, and
// naming the adapter from it makes Vite emit PGlite's WASM payload into the
// extension output — 1.08 MB → 17.9 MB — even though the dynamic import inside
// init() means no entrypoint actually loads it yet. It IS exported from
// './storage/index.ts'; the local posture imports it by that deep path, the
// same way the ingest Edge Function reaches ./ingestion/*.
export type { StorageAdapter, StoragePosture } from './storage/storageAdapter.ts';
export { MEMORY_CHUNK_TYPES, EXTRACTION_FAILURE_ADAPTERS } from './storage/types.ts';
export type {
  DocumentRecord,
  ExtractionFailureAdapter,
  InsertCaptureMismatchInput,
  InsertDocumentInput,
  InsertExtractionFailureInput,
  InsertGateDecisionInput,
  InsertMemoryChunkInput,
  InsertQAPairInput,
  MemoryChunkRecord,
  MemoryChunkType,
  QAPairRecord,
  ScoredChunk,
  SearchHybridParams,
  StyleProfileRecord,
  UpsertStyleProfileInput,
} from './storage/types.ts';
export { parseEmbedding, toVectorLiteral } from './storage/embedding.ts';
export {
  DEFAULT_SEARCH_LIMIT,
  HYBRID_KEYWORD_WEIGHT,
  HYBRID_VECTOR_WEIGHT,
  queryTokens,
  rankChunks,
  scoreChunk,
} from './storage/hybrid.ts';
export { LOCAL_SCHEMA_SQL, LOCAL_SCHEMA_VERSION } from './storage/localSchema.ts';
export {
  SupabaseStorageAdapter,
  SUPABASE_CANDIDATE_POOL,
} from './storage/supabaseStorageAdapter.ts';

