import { describe, it, expect } from 'vitest';
import {
  OUTPUT_LENGTHS,
  OUTPUT_LENGTH_CONFIG,
  DAILY_SUGGESTION_LIMIT,
  WEEKLY_COVER_LETTER_LIMIT,
  isVideoQuestion,
} from './settings';

describe('settings & caps', () => {
  it('defines valid output lengths with configs', () => {
    expect(OUTPUT_LENGTHS).toEqual(['short', 'medium', 'long']);
    expect(OUTPUT_LENGTH_CONFIG.short.premiumOnly).toBe(false);
    expect(OUTPUT_LENGTH_CONFIG.medium.premiumOnly).toBe(true);
    expect(OUTPUT_LENGTH_CONFIG.long.premiumOnly).toBe(true);

    expect(OUTPUT_LENGTH_CONFIG.short.maxTokens).toBeLessThan(OUTPUT_LENGTH_CONFIG.medium.maxTokens);
    expect(OUTPUT_LENGTH_CONFIG.medium.maxTokens).toBeLessThan(OUTPUT_LENGTH_CONFIG.long.maxTokens);
  });

  it('defines correct limits', () => {
    expect(DAILY_SUGGESTION_LIMIT).toBe(15);
    expect(WEEKLY_COVER_LETTER_LIMIT).toBe(1);
  });

  it('detects video questions correctly', () => {
    expect(isVideoQuestion('Please record a video introducing yourself.')).toBe(true);
    expect(isVideoQuestion('Submit a Loom video pitch about your experience.')).toBe(true);
    expect(isVideoQuestion('Record a 1-3 min video answering why you want to join us.')).toBe(true);
    expect(isVideoQuestion('Provide a video introduction for the team.')).toBe(true);
    expect(isVideoQuestion('Why do you want to work here?')).toBe(false);
    expect(isVideoQuestion('Describe your React experience.')).toBe(false);
  });
});
