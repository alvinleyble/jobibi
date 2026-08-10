import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk';

describe('chunkText', () => {
  it('returns an empty array for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('returns a single chunk when the whole text fits', () => {
    const text = 'A short resume summary.';
    expect(chunkText(text, { maxChars: 800 })).toEqual([text]);
  });

  it('keeps whole paragraphs together within a chunk when they fit', () => {
    const text = ['First paragraph.', 'Second paragraph.'].join('\n\n');
    const chunks = chunkText(text, { maxChars: 800 });
    expect(chunks).toEqual(['First paragraph.\n\nSecond paragraph.']);
  });

  it('starts a new chunk once adding the next paragraph would exceed maxChars', () => {
    const a = 'a'.repeat(50);
    const b = 'b'.repeat(50);
    const chunks = chunkText([a, b].join('\n\n'), { maxChars: 60 });
    expect(chunks).toEqual([a, b]);
  });

  it('splits a single oversized paragraph on sentence boundaries', () => {
    const sentence1 = 'This is the first sentence of a long paragraph.';
    const sentence2 = 'This is the second sentence, also fairly long.';
    const paragraph = `${sentence1} ${sentence2}`;
    const chunks = chunkText(paragraph, { maxChars: sentence1.length + 5 });
    expect(chunks).toEqual([sentence1, sentence2]);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(sentence1.length + 5);
    }
  });

  it('hard-wraps a single sentence longer than maxChars', () => {
    const longWord = 'x'.repeat(25);
    const chunks = chunkText(longWord, { maxChars: 10 });
    expect(chunks.join('')).toBe(longWord);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });

  it('never produces a chunk longer than maxChars across mixed content', () => {
    const maxChars = 100;
    const text = [
      'Short intro paragraph.',
      'y'.repeat(400),
      'Another normal paragraph that is reasonably sized for testing purposes here.',
    ].join('\n\n');
    const chunks = chunkText(text, { maxChars });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars);
    }
  });

  it('rejects a non-positive maxChars', () => {
    expect(() => chunkText('hello', { maxChars: 0 })).toThrow();
  });

  it('defaults to 800 characters when no option is given', () => {
    const text = 'z'.repeat(2000);
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(800);
    }
  });
});
