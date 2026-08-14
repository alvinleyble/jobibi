// Ingest: turn an uploaded resume/cover letter/transcript into searchable
// memory_chunks. Runs entirely under the caller's own JWT (no service-role
// client) so Storage and Postgres RLS are what keep this to the caller's own
// rows — see docs/DECISIONS.md D2 and D7.
//
// Embeddings run in-process via the Edge Runtime's built-in gte-small model
// (D5c): no network call, nothing in the memory bank is sent anywhere to be
// embedded.
import { createClient } from '@supabase/supabase-js';
import { DOCUMENT_KINDS, type DocumentKind } from '../../../packages/shared/src/index.ts';
import { chunkText } from '../../../packages/shared/src/ingestion/chunk.ts';
import {
  DocumentFormat,
  PDF_NO_SELECTABLE_TEXT_ERROR,
  detectFormat,
  extractText,
} from '../../../packages/shared/src/ingestion/extract.ts';
import { pastedDocumentProvenance, validatePaste } from '../../../packages/shared/src/ingestion/paste.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { maybeTriggerStyleProfileRebuild } from '../_shared/styleProfileTrigger.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

interface FileIngestRequest {
  storagePath: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
}

interface PasteIngestRequest {
  text: string;
  kind: DocumentKind;
  // S8: Draft Cover Letter — D13 origin for accepted drafts. Only meaningful
  // for kind='cover_letter' stored drafts; NULL for other kinds and for
  // pre-S8 manual pastes.
  origin?: 'user_written' | 'user_edited' | 'accepted_verbatim' | null;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isFileIngestRequest(body: unknown): body is FileIngestRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.storagePath === 'string' &&
    typeof b.fileName === 'string' &&
    typeof b.mimeType === 'string' &&
    typeof b.kind === 'string' &&
    (DOCUMENT_KINDS as readonly string[]).includes(b.kind)
  );
}

function isPasteIngestRequest(body: unknown): body is PasteIngestRequest {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.text === 'string' &&
    typeof b.kind === 'string' &&
    (DOCUMENT_KINDS as readonly string[]).includes(b.kind)
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Please sign in to upload documents.' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Your session has expired. Please sign in again.' }, 401);
    }

    const body = await req.json().catch(() => null);

    let text: string;
    let storagePath: string | null;
    let fileName: string;
    let mimeType: string;
    let kind: DocumentKind;
    let format: DocumentFormat | null = null;
    let origin: 'user_written' | 'user_edited' | 'accepted_verbatim' | null = null;

    if (isPasteIngestRequest(body)) {
      kind = body.kind;
      const validation = validatePaste(body.text, kind);
      if (!validation.ok) {
        return jsonResponse({ error: validation.error }, 422);
      }
      text = validation.text!;
      const provenance = pastedDocumentProvenance(kind);
      storagePath = provenance.storagePath;
      fileName = provenance.fileName;
      mimeType = provenance.mimeType;
      // S8 D13: persist origin for Draft Cover Letter accepted drafts
      if (body.origin && ['user_written', 'user_edited', 'accepted_verbatim'].includes(body.origin)) {
        origin = body.origin as typeof origin;
      }
    } else if (isFileIngestRequest(body)) {
      kind = body.kind;
      if (!body.storagePath.startsWith(`${user.id}/`)) {
        return jsonResponse({ error: 'You do not have permission to upload to this location.' }, 403);
      }

      format = detectFormat(body.mimeType, body.fileName);
      if (!format) {
        return jsonResponse({ error: 'Unsupported file format. Please upload a text-based PDF, DOCX, or TXT file.' }, 400);
      }

      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from('documents')
        .download(body.storagePath);
      if (downloadError || !fileBlob) {
        console.error('[ingest] download error:', downloadError);
        return jsonResponse({ error: 'We could not read the uploaded file. Please try uploading it again.' }, 404);
      }
      const bytes = new Uint8Array(await fileBlob.arrayBuffer());

      try {
        text = await extractText(bytes, format);
      } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 422);
      }
      if (!text.trim()) {
        if (format === 'pdf') {
          return jsonResponse({ error: PDF_NO_SELECTABLE_TEXT_ERROR }, 422);
        }
        return jsonResponse({ error: 'We couldn\'t find any readable text in this file. Please make sure the file contains text (not just images or scans) and try again.' }, 422);
      }
      storagePath = body.storagePath;
      fileName = body.fileName;
      mimeType = body.mimeType;
    } else {
      return jsonResponse(
        { error: 'Please upload a file or paste text to save to your memory bank.' },
        400,
      );
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      if (format === 'pdf') {
        return jsonResponse({ error: PDF_NO_SELECTABLE_TEXT_ERROR }, 422);
      }
      return jsonResponse({ error: 'We couldn\'t find any readable text in this file. Please make sure the file contains text (not just images or scans) and try again.' }, 422);
    }

    const { data: document, error: documentError } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        kind,
        file_name: fileName,
        mime_type: mimeType,
        storage_path: storagePath,
        extracted_text: text,
        parsed_at: new Date().toISOString(),
        ...(origin ? { origin } : {}),
      })
      .select('id')
      .single();
    if (documentError || !document) {
      console.error('[ingest] Could not save document:', documentError);
      return jsonResponse({ error: 'We could not save your document. Please try again.' }, 500);
    }

    const embeddingSession = new Supabase.ai.Session('gte-small');
    const chunkRows = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await embeddingSession.run(chunks[i], { mean_pool: true, normalize: true });
        chunkRows.push({
          user_id: user.id,
          document_id: document.id,
          chunk_index: i,
          text: chunks[i],
          embedding: `[${embedding.join(',')}]`,
        });
      }

      const { error: chunksError } = await supabase.from('memory_chunks').insert(chunkRows);
      if (chunksError) {
        throw new Error(`Could not save chunks: ${chunksError.message}`);
      }
    } catch (err) {
      console.error('[ingest] Chunking / embedding failed:', err);
      await supabase.from('documents').delete().eq('id', document.id);
      return jsonResponse({ error: 'We could not process your document for memory search. Please try uploading it again.' }, 500);
    }

    // S9: trigger only for qualifying documents (user_written / user_edited); accepted_verbatim and NULL-origin uploads do not count (D13)
    // style-profile owns claim/in-flight
    if (origin === 'user_written' || origin === 'user_edited') {
      await maybeTriggerStyleProfileRebuild(supabase, user.id, authHeader, Deno.env.get('SUPABASE_URL')!);
    }

    return jsonResponse({ documentId: document.id, chunkCount: chunkRows.length }, 200);
  } catch (err) {
    console.error('ingest failed', err);
    return jsonResponse({ error: 'An unexpected error occurred while processing your document. Please try again.' }, 500);
  }
});
