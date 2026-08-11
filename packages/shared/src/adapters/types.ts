/** Shared adapter types for question extraction (S4). */

export const FIELD_TYPES = [
  'textarea',
  'text',
  'email',
  'number',
  'select',
  'radio',
  'checkbox',
  'file',
  'unknown',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Confidence that the label→field mapping is correct (D16). 0–1. */
export type MappingConfidence = number;

/** How the label was resolved — used for confidence scoring. */
export type LabelSource =
  | 'label-for' // <label for="id"> matching field id
  | 'label-wrap' // field wrapped inside <label>
  | 'aria-labelledby' // aria-labelledby → element text
  | 'aria-label' // aria-label attribute
  | 'placeholder' // placeholder text alone
  | 'proximity' // nearby text heuristic
  | 'none';

/** One detected application question. */
export interface ExtractedQuestion {
  /** Stable id derived from field identity (for re-derive matching). */
  id: string;
  /** Question / label text as shown to the applicant. */
  label: string;
  /** Detected field type. */
  fieldType: FieldType;
  /** Optional helper / surrounding context (placeholder, hint text). */
  context?: string;
  /** Field identity for mapping. */
  field: {
    tagName: string;
    id?: string;
    name?: string;
    type?: string;
    selector: string;
  };
  /** How the label was found. */
  labelSource: LabelSource;
  /** Confidence that label maps to field (D16). */
  confidence: MappingConfidence;
  /** Whether question text was derived or skipped for missing label. */
  skipped?: boolean;
}

/** Job context picked from the page (role + company). */
export interface JobContext {
  roleTitle?: string;
  company?: string;
}

/** Full extraction result from one page scan. */
export interface ExtractionResult {
  questions: ExtractedQuestion[];
  jobContext: JobContext;
  /** Host that was scanned (for debugging). */
  host: string;
}
