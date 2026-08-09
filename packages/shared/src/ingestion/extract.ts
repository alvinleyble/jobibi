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
      throw new Error(`Unsupported document format: ${format satisfies never}`);
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
    throw new Error('Not a valid .docx file: word/document.xml is missing');
  }
  return extractTextFromDocumentXml(strFromU8(documentXml));
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractPdfPages(pdf, { mergePages: true });
  return text.trim();
}
