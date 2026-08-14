import { unzipSync, strFromU8 } from 'fflate';
import { extractText as extractPdfPages, getDocumentProxy } from 'unpdf';
import { extractTextFromDocumentXml } from './docxXml.ts';

export type DocumentFormat = 'pdf' | 'docx' | 'txt';

const MIME_TO_FORMAT: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};

const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
};

export function detectFormat(mimeType: string, fileName: string): DocumentFormat | null {
  if (MIME_TO_FORMAT[mimeType]) return MIME_TO_FORMAT[mimeType];
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_FORMAT[ext] ?? null;
}

export async function extractText(bytes: Uint8Array, format: DocumentFormat): Promise<string> {
  switch (format) {
    case 'txt':
      return await extractTxtText(bytes);
    case 'docx':
      return await extractDocxText(bytes);
    case 'pdf':
      return await extractPdfText(bytes);
    default:
      throw new Error('Unsupported document format. Please upload a text-based PDF, DOCX, or TXT file.');
  }
}

export function extractTxtText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).trim();
}

export function extractDocxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, {
    filter: (file) => file.name === 'word/document.xml',
  });
  const documentXml = files['word/document.xml'];
  if (!documentXml) {
    throw new Error('Could not read DOCX document content (word/document.xml is missing). Please make sure the file is a valid Word document.');
  }
  return extractTextFromDocumentXml(strFromU8(documentXml));
}

export const PDF_NO_SELECTABLE_TEXT_ERROR =
  "We couldn't find any selectable text in this PDF. If your resume is a scanned image or photo, please upload a text-based PDF, DOCX, or copy-paste the text.";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractPdfPages(pdf, { mergePages: true });
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(PDF_NO_SELECTABLE_TEXT_ERROR);
  }
  return trimmed;
}
