const DEFAULT_MAX_CHARS = 800;

export interface ChunkOptions {
  maxChars?: number;
}

/**
 * Splits document text into chunks for embedding, at paragraph boundaries
 * where possible. Falls back to sentence, then hard-character, splitting for
 * a single paragraph/sentence longer than maxChars.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (maxChars <= 0) {
    throw new Error('maxChars must be positive');
  }

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length > maxChars ? splitOversizedParagraph(paragraph, maxChars) : [paragraph];
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        flush();
        current = piece;
      }
    }
  }
  flush();

  return chunks;
}

function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const units = sentence.length > maxChars ? hardWrap(sentence, maxChars) : [sentence];
    for (const unit of units) {
      const candidate = current ? `${current} ${unit}` : unit;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) pieces.push(current);
        current = unit;
      }
    }
  }
  if (current) pieces.push(current);

  return pieces;
}

function hardWrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}
