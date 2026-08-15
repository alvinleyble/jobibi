// S12: Privacy Surface, Beta Caps & Settings (D3, D8, D12, D17)

export const OUTPUT_LENGTHS = ['short', 'medium', 'long'] as const;
export type OutputLength = (typeof OUTPUT_LENGTHS)[number];

export interface OutputLengthConfig {
  label: string;
  wordRange: string;
  maxTokens: number;
  maxChars: number;
  premiumOnly: boolean;
}

export const OUTPUT_LENGTH_CONFIG: Record<OutputLength, OutputLengthConfig> = {
  short: {
    label: 'Short (50–200 words)',
    wordRange: '50–200 words',
    maxTokens: 300,
    maxChars: 1200,
    premiumOnly: false,
  },
  medium: {
    label: 'Medium (200–450 words)',
    wordRange: '200–450 words',
    maxTokens: 600,
    maxChars: 2700,
    premiumOnly: true,
  },
  long: {
    label: 'Long (450–700 words)',
    wordRange: '450–700 words',
    maxTokens: 900,
    maxChars: 4200,
    premiumOnly: true,
  },
};

export const DAILY_SUGGESTION_LIMIT = 15;
export const WEEKLY_COVER_LETTER_LIMIT = 1;

export const VIDEO_QUESTION_KEYWORDS = [
  'record a video',
  'loom',
  'video introduction',
  'video pitch',
  '1-3 min video',
  '1-2 min video',
  'short video',
  'video response',
  'record video',
  'video recording',
  'submit a video',
  'record a 1-3 min video',
] as const;

/**
 * Returns true if the question asks for a video recording or video submission.
 */
export function isVideoQuestion(questionText: string): boolean {
  if (!questionText || typeof questionText !== 'string') return false;
  const lower = questionText.toLowerCase();
  return VIDEO_QUESTION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Trims text gracefully at the last complete sentence, paragraph, or word boundary
 * before maxChars, preventing mid-word and mid-sentence cutoffs.
 */
export function trimGracefully(text: string, maxChars?: number): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!maxChars || maxChars <= 0 || trimmed.length <= maxChars) {
    return trimmed;
  }

  const candidate = trimmed.slice(0, maxChars);

  // 1. Try finding the last complete sentence boundary ending with punctuation [.!?] followed by optional quotes/brackets and whitespace/end of string
  const sentenceEndRegex = /[.!?]+["')\]]?(?=\s|$)/g;
  let lastSentenceEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceEndRegex.exec(candidate)) !== null) {
    lastSentenceEnd = match.index + match[0].length;
  }

  if (lastSentenceEnd > 0) {
    const candidateSentence = candidate.slice(0, lastSentenceEnd).trim();
    if (candidateSentence.length > 0) {
      return candidateSentence;
    }
  }

  // 2. Try finding the last paragraph or newline boundary
  const lastNewline = candidate.lastIndexOf('\n');
  if (lastNewline > 0) {
    const candidateNewline = candidate.slice(0, lastNewline).trim();
    if (candidateNewline.length > 0) {
      return candidateNewline;
    }
  }

  // 3. Try finding the last word boundary (whitespace)
  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace > 0) {
    const candidateSpace = candidate.slice(0, lastSpace).trim();
    if (candidateSpace.length > 0) {
      return candidateSpace;
    }
  }

  // 4. Fallback to candidate slice
  return candidate.trim();
}
