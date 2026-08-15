import { describe, it, expect } from 'vitest';
import {
  OUTPUT_LENGTHS,
  OUTPUT_LENGTH_CONFIG,
  DAILY_SUGGESTION_LIMIT,
  DAILY_COVER_LETTER_LIMIT,
  DAILY_COVER_LETTER_ATTEMPT_LIMIT,
  isVideoQuestion,
  trimGracefully,
} from './settings';

describe('settings & caps', () => {
  it('defines valid output lengths with calibrated configs matching 6 chars/word', () => {
    expect(OUTPUT_LENGTHS).toEqual(['short', 'medium', 'long']);
    expect(OUTPUT_LENGTH_CONFIG.short.premiumOnly).toBe(false);
    expect(OUTPUT_LENGTH_CONFIG.medium.premiumOnly).toBe(true);
    expect(OUTPUT_LENGTH_CONFIG.long.premiumOnly).toBe(true);

    expect(OUTPUT_LENGTH_CONFIG.short.wordRange).toBe('50–200 words');
    expect(OUTPUT_LENGTH_CONFIG.short.maxTokens).toBe(300);
    expect(OUTPUT_LENGTH_CONFIG.short.maxChars).toBe(1200);

    expect(OUTPUT_LENGTH_CONFIG.medium.wordRange).toBe('200–450 words');
    expect(OUTPUT_LENGTH_CONFIG.medium.maxTokens).toBe(600);
    expect(OUTPUT_LENGTH_CONFIG.medium.maxChars).toBe(2700);

    expect(OUTPUT_LENGTH_CONFIG.long.wordRange).toBe('450–700 words');
    expect(OUTPUT_LENGTH_CONFIG.long.maxTokens).toBe(900);
    expect(OUTPUT_LENGTH_CONFIG.long.maxChars).toBe(4200);

    expect(OUTPUT_LENGTH_CONFIG.short.maxTokens).toBeLessThan(OUTPUT_LENGTH_CONFIG.medium.maxTokens);
    expect(OUTPUT_LENGTH_CONFIG.medium.maxTokens).toBeLessThan(OUTPUT_LENGTH_CONFIG.long.maxTokens);
    expect(OUTPUT_LENGTH_CONFIG.short.maxChars).toBeLessThan(OUTPUT_LENGTH_CONFIG.medium.maxChars);
    expect(OUTPUT_LENGTH_CONFIG.medium.maxChars).toBeLessThan(OUTPUT_LENGTH_CONFIG.long.maxChars);
  });

  it('defines correct limits', () => {
    expect(DAILY_SUGGESTION_LIMIT).toBe(15);
    expect(DAILY_COVER_LETTER_LIMIT).toBe(1);
    expect(DAILY_COVER_LETTER_ATTEMPT_LIMIT).toBe(5);
  });

  it('detects video questions correctly', () => {
    expect(isVideoQuestion('Please record a video introducing yourself.')).toBe(true);
    expect(isVideoQuestion('Submit a Loom video pitch about your experience.')).toBe(true);
    expect(isVideoQuestion('Record a 1-3 min video answering why you want to join us.')).toBe(true);
    expect(isVideoQuestion('Provide a video introduction for the team.')).toBe(true);
    expect(isVideoQuestion('Why do you want to work here?')).toBe(false);
    expect(isVideoQuestion('Describe your React experience.')).toBe(false);
  });

  describe('trimGracefully', () => {
    it('returns empty string for empty, null, or undefined inputs', () => {
      expect(trimGracefully('')).toBe('');
      expect(trimGracefully('   ')).toBe('');
      expect(trimGracefully(null as unknown as string)).toBe('');
      expect(trimGracefully(undefined as unknown as string)).toBe('');
    });

    it('returns full trimmed text when within maxChars limit', () => {
      const text = 'This is a complete sentence that easily fits.';
      expect(trimGracefully(text, 100)).toBe(text);
      expect(trimGracefully(`  ${text}  `, 100)).toBe(text);
    });

    it('returns full trimmed text when maxChars is not provided or non-positive', () => {
      const text = 'Some sample text.';
      expect(trimGracefully(text)).toBe(text);
      expect(trimGracefully(text, 0)).toBe(text);
      expect(trimGracefully(text, -5)).toBe(text);
    });

    it('trims cleanly at the last complete sentence boundary before maxChars without mid-word cutoff', () => {
      const text = 'I led front-end development at Acme Corp. We scaled the web app to 1M users. Furthermore, I am very enthusiastic about this opportunity.';
      // Limit cuts off mid-word during "enthusiastic"
      const result = trimGracefully(text, 95);
      expect(result).toBe('I led front-end development at Acme Corp. We scaled the web app to 1M users.');
      expect(result.endsWith('.')).toBe(true);
      expect(result).not.toContain('enthusi');
    });

    it('handles multiple sentence punctuation types (.!?) and trailing quotes/parentheses', () => {
      const text = 'Did you know? We achieved a 40% latency reduction! The CEO noted ("Outstanding result!"). We then continued with next phase of rollout.';
      const result = trimGracefully(text, 110);
      expect(result).toBe('Did you know? We achieved a 40% latency reduction! The CEO noted ("Outstanding result!").');
    });

    it('trims at paragraph / newline boundary when no punctuation boundary exists in the trailing segment', () => {
      const text = 'Talking points:\n- Built high-performance caching layer\n- Mentored 4 junior engineers\n- Collaborated with product team on roadmap';
      const result = trimGracefully(text, 90);
      expect(result).toBe('Talking points:\n- Built high-performance caching layer\n- Mentored 4 junior engineers');
    });

    it('trims at last word boundary when no sentence or newline boundary exists', () => {
      const text = 'Senior full stack engineer experienced with TypeScript React Node Postgres and cloud infrastructure';
      const result = trimGracefully(text, 55);
      expect(result).toBe('Senior full stack engineer experienced with TypeScript');
      expect(result.endsWith('TypeScript')).toBe(true);
    });

    it('falls back to candidate slice when string contains no spaces, newlines, or punctuation', () => {
      const text = 'Supercalifragilisticexpialidocious';
      expect(trimGracefully(text, 10)).toBe('Supercalif');
    });
  });
});
