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
import { detectFormat, extractText } from '../../../packages/shared/src/ingestion/extract.ts';
import { corsHeaders } from '../_shared/cors.ts';

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts?: Record<string, unknown>): Promise<number[]> } };
};

interface IngestRequest {
  storagePath: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isIngestRequest(body: unknown): body is IngestRequest {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
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
      return jsonResponse({ error: 'Not authenticated' }, 401);
    }

    const body = await req.json().catch(() => null);
    if (!isIngestRequest(body)) {
      return jsonResponse({ error: 'storagePath, kind, fileName, and mimeType are required' }, 400);
    }

    if (!body.storagePath.startsWith(`${user.id}/`)) {
      return jsonResponse({ error: 'storagePath must be under the caller\'s own folder' }, 403);
    }

    const format = detectFormat(body.mimeType, body.fileName);
    if (!format) {
      return jsonResponse({ error: `Unsupported file type: ${body.mimeType}` }, 400);
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(body.storagePath);
    if (downloadError || !fileBlob) {
      return jsonResponse({ error: `Could not read uploaded file: ${downloadError?.message ?? 'not found'}` }, 404);
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());

    let text: string;
    try {
      text = await extractText(bytes, format);
    } catch (err) {
      return jsonResponse({ error: `Could not extract text: ${(err as Error).message}` }, 422);
    }
    if (!text.trim()) {
      return jsonResponse({ error: 'No extractable text found in this file' }, 422);
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return jsonResponse({ error: 'No extractable text found in this file' }, 422);
    }

    const { data: document, error: documentError } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        kind: body.kind,
        file_name: body.fileName,
        mime_type: body.mimeType,
        storage_path: body.storagePath,
        extracted_text: text,
        parsed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (documentError || !document) {
      return jsonResponse({ error: `Could not save document: ${documentError?.message}` }, 500);
    }

    const embeddingSession = new Supabase.ai.Session('gte-small');
    const chunkRows = [];
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
      return jsonResponse({ error: `Could not save chunks: ${chunksError.message}` }, 500);
    }

    return jsonResponse({ documentId: document.id, chunkCount: chunkRows.length }, 200);
  } catch (err) {
    console.error('ingest failed', err);
    return jsonResponse({ error: 'Unexpected error during ingestion' }, 500);
  }
});
