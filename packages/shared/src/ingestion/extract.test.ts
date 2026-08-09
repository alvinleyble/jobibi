import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectFormat, extractDocxText, extractPdfText, extractText, extractTxtText } from './extract';

describe('detectFormat', () => {
  it('detects by mime type first', () => {
    expect(detectFormat('application/pdf', 'whatever.bin')).toBe('pdf');
    expect(
      detectFormat('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'whatever.bin'),
    ).toBe('docx');
    expect(detectFormat('text/plain', 'whatever.bin')).toBe('txt');
  });

  it('falls back to file extension when the mime type is unrecognized', () => {
    expect(detectFormat('application/octet-stream', 'resume.pdf')).toBe('pdf');
    expect(detectFormat('application/octet-stream', 'resume.DOCX')).toBe('docx');
    expect(detectFormat('application/octet-stream', 'resume.txt')).toBe('txt');
  });

  it('returns null for an unsupported file', () => {
    expect(detectFormat('image/png', 'photo.png')).toBeNull();
  });
});

describe('extractTxtText', () => {
  it('decodes UTF-8 bytes and trims surrounding whitespace', () => {
    const bytes = new TextEncoder().encode('  Cover letter body.\n');
    expect(extractTxtText(bytes)).toBe('Cover letter body.');
  });
});

describe('extractDocxText', () => {
  it('extracts paragraph text from a real docx-shaped zip', () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Jane Dela Cruz</w:t></w:r></w:p>
    <w:p><w:r><w:t>QA Engineer, four years</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const zipped = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(documentXml),
    });

    expect(extractDocxText(zipped)).toBe('Jane Dela Cruz\n\nQA Engineer, four years');
  });

  it('throws a clear error when word/document.xml is missing', () => {
    const zipped = zipSync({ 'readme.txt': strToU8('not a docx') });
    expect(() => extractDocxText(zipped)).toThrow(/word\/document\.xml/);
  });
});

describe('extractPdfText', () => {
  it('extracts text from the content stream of a minimal PDF', async () => {
    const pdfBytes = buildMinimalPdf('Hello Jobibi PDF');
    const text = await extractPdfText(pdfBytes);
    expect(text).toContain('Hello Jobibi PDF');
  });
});

describe('extractText dispatcher', () => {
  it('routes txt through the plain decoder', async () => {
    const bytes = new TextEncoder().encode('Plain text resume.');
    expect(await extractText(bytes, 'txt')).toBe('Plain text resume.');
  });
});

/**
 * Builds a minimal, valid single-page PDF containing one line of text in
 * its content stream, with correctly computed xref offsets, so extraction
 * can be tested without checking in a binary fixture.
 */
function buildMinimalPdf(text: string): Uint8Array {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const contentStream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;

  const objectBodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const encoder = new TextEncoder();
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (const [index, body] of objectBodies.entries()) {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  offsets.push(encoder.encode(pdf).length);
  pdf += `5 0 obj\n<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;

  const xrefOffset = encoder.encode(pdf).length;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encoder.encode(pdf);
}
