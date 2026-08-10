/**
 * Pure text extraction from a DOCX `word/document.xml` string. Kept
 * dependency-free and separate from the zip unpacking step so it is
 * unit-testable without a real .docx binary fixture.
 */
export function extractTextFromDocumentXml(xml: string): string {
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];

  const lines = paragraphs.map((paragraph) => {
    const runs = paragraph.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [];
    return runs
      .map((run) => decodeXmlEntities(run.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '')))
      .join('');
  });

  return lines.filter((line) => line.trim().length > 0).join('\n\n');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
