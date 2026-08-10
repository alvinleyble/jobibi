import { describe, expect, it } from 'vitest';
import { extractTextFromDocumentXml } from './docxXml';

function documentXml(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`;
}

describe('extractTextFromDocumentXml', () => {
  it('joins runs within a paragraph and separates paragraphs with a blank line', () => {
    const xml = documentXml(
      '<w:p><w:r><w:t>Jane Dela Cruz</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Software Engineer</w:t></w:r><w:r><w:t xml:space="preserve"> with 5 years experience</w:t></w:r></w:p>',
    );

    expect(extractTextFromDocumentXml(xml)).toBe(
      'Jane Dela Cruz\n\nSoftware Engineer with 5 years experience',
    );
  });

  it('decodes XML entities inside text runs', () => {
    const xml = documentXml('<w:p><w:r><w:t>Q&amp;A, &lt;tag&gt; &quot;quoted&quot; &apos;text&apos;</w:t></w:r></w:p>');

    expect(extractTextFromDocumentXml(xml)).toBe('Q&A, <tag> "quoted" \'text\'');
  });

  it('drops empty paragraphs used purely for spacing', () => {
    const xml = documentXml('<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Second</w:t></w:r></w:p>');

    expect(extractTextFromDocumentXml(xml)).toBe('First\n\nSecond');
  });

  it('returns an empty string when there are no paragraphs', () => {
    expect(extractTextFromDocumentXml(documentXml(''))).toBe('');
  });
});
