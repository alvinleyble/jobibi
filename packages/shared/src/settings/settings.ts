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
    maxChars: 600,
    premiumOnly: false,
  },
  medium: {
    label: 'Medium (200–450 words)',
    wordRange: '200–450 words',
    maxTokens: 600,
    maxChars: 1500,
    premiumOnly: true,
  },
  long: {
    label: 'Long (450–700 words)',
    wordRange: '450–700 words',
    maxTokens: 900,
    maxChars: 2500,
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
