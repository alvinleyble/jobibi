/**
 * Local BYO-Key posture: `StorageAdapter` over an in-process Postgres.
 *
 * PGlite is real Postgres compiled to WASM, so the local memory bank runs the
 * same DDL, the same CHECK constraints and the same pgvector operators as the
 * cloud one — that is why the two postures can be swapped without the gate
 * noticing. Persistence is IndexedDB (`idb://jobibi-local-memory`); tests and
 * throwaway sessions use `memory://`.
 *
 * The `@electric-sql/pglite` import is dynamic on purpose: it drags a multi-MB
 * WASM payload, and a Cloud SaaS user must never pay for it. Only `init()`
 * — reached the first time someone actually opens a local database — loads it.
 */

import type { PGlite } from '@electric-sql/pglite';
import { parseEmbedding, toVectorLiteral } from './embedding.ts';
import {
  DEFAULT_SEARCH_LIMIT,
  HYBRID_KEYWORD_WEIGHT,
  HYBRID_VECTOR_WEIGHT,
  queryTokens,
} from './hybrid.ts';
import { LOCAL_SCHEMA_SQL } from './localSchema.ts';
import type { StorageAdapter, StoragePosture } from './storageAdapter.ts';
import type {
  DocumentRecord,
  InsertCaptureMismatchInput,
  InsertDocumentInput,
  InsertExtractionFailureInput,
  InsertGateDecisionInput,
  InsertMemoryChunkInput,
  InsertQAPairInput,
  MemoryChunkRecord,
  QAPairRecord,
  ScoredChunk,
  SearchHybridParams,
  StyleProfileRecord,
  UpsertStyleProfileInput,
} from './types.ts';

/** IndexedDB location of the local memory bank in a browser context. */
export const LOCAL_MEMORY_DATA_DIR = 'idb://jobibi-local-memory';

/** Ephemeral database — tests, and any session that must leave no trace. */
export const IN_MEMORY_DATA_DIR = 'memory://';

export interface PGliteStorageAdapterOptions {
  /** Defaults to {@link LOCAL_MEMORY_DATA_DIR}. Pass {@link IN_MEMORY_DATA_DIR} for tests. */
  dataDir?: string;
}

type Row = Record<string, unknown>;

/** PGlite hands back `Date` for timestamptz; the records are ISO strings everywhere else. */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function requireIso(value: unknown): string {
  return toIso(value) ?? new Date(0).toISOString();
}

function toDocument(row: Row): DocumentRecord {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    kind: row.kind as DocumentRecord['kind'],
    file_name: row.file_name as string,
    mime_type: row.mime_type as string,
    storage_path: (row.storage_path as string | null) ?? null,
    extracted_text: (row.extracted_text as string | null) ?? null,
    parsed_at: toIso(row.parsed_at),
    origin: (row.origin as DocumentRecord['origin']) ?? null,
    created_at: requireIso(row.created_at),
  };
}

function toMemoryChunk(row: Row): MemoryChunkRecord {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    document_id: (row.document_id as string | null) ?? null,
    chunk_index: Number(row.chunk_index ?? 0),
    type: (row.type as MemoryChunkRecord['type']) ?? 'experience',
    text: row.text as string,
    embedding: parseEmbedding(row.embedding),
    freshness_at: toIso(row.freshness_at),
    created_at: requireIso(row.created_at),
  };
}

function toQAPair(row: Row): QAPairRecord {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    application_id: (row.application_id as string | null) ?? null,
    question_label: row.question_label as string,
    question_norm: row.question_norm as string,
    answer_text: row.answer_text as string,
    draft_text: (row.draft_text as string | null) ?? null,
    origin: row.origin as QAPairRecord['origin'],
    edit_distance: Number(row.edit_distance ?? 0),
    embedding: parseEmbedding(row.embedding),
    created_at: requireIso(row.created_at),
  };
}

function toStyleProfile(row: Row): StyleProfileRecord {
  return {
    user_id: row.user_id as string,
    profile_md: (row.profile_md as string | null) ?? null,
    generated_at: toIso(row.generated_at),
    corpus_size: Number(row.corpus_size ?? 0),
    rebuilding: Boolean(row.rebuilding),
    rebuilding_started_at: toIso(row.rebuilding_started_at),
    batch_job_id: (row.batch_job_id as string | null) ?? null,
    created_at: requireIso(row.created_at),
    updated_at: requireIso(row.updated_at),
  };
}

/** Columns selected for a memory chunk — `embedding` rendered as text so `parseEmbedding` handles it. */
const CHUNK_COLUMNS =
  'id, user_id, document_id, chunk_index, type, text, embedding::text as embedding, freshness_at, created_at';

const QA_COLUMNS =
  'id, user_id, application_id, question_label, question_norm, answer_text, draft_text, origin, edit_distance, embedding::text as embedding, created_at';

/**
 * Hybrid ranking in SQL.
 *
 * The keyword half is deliberately not `to_tsvector`/`ts_rank`: it reproduces
 * `keywordOverlap` exactly — distinct query tokens (lowercased, split on
 * `\W+`, which after `lower()` is `[^a-z0-9_]+`) divided by the query's token
 * count. Postgres full-text ranking would score differently from the cloud
 * posture and quietly desynchronize the gate.
 *
 * Vector similarity is `1 - (embedding <=> query)` — pgvector's `<=>` is cosine
 * *distance*. With no embedding on either side the vector axis falls back to
 * the keyword score, matching `scoreChunk`.
 */
const SEARCH_HYBRID_SQL = `
  select ${CHUNK_COLUMNS}, kw.keyword_score, vec.vector_score, hyb.score
  from memory_chunks mc
  cross join lateral (
    select case
      when $3::float8 = 0 then 0::float8
      else (
        select count(*)::float8
        from jsonb_array_elements_text($2::jsonb) as t(token)
        where t.token = any(regexp_split_to_array(lower(mc.text), '[^a-z0-9_]+'))
      ) / $3::float8
    end as keyword_score
  ) kw
  cross join lateral (
    select case
      when $1::text is null or mc.embedding is null then kw.keyword_score
      else 1 - (mc.embedding <=> ($1::text)::vector)
    end as vector_score
  ) vec
  cross join lateral (
    select (${HYBRID_VECTOR_WEIGHT} * vec.vector_score) + (${HYBRID_KEYWORD_WEIGHT} * kw.keyword_score) as score
  ) hyb
  where ($4::text is null or mc.user_id = $4::uuid)
    and hyb.score >= $5::float8
  order by hyb.score desc, mc.id asc
  limit $6::int
`;

export class PGliteStorageAdapter implements StorageAdapter {
  readonly posture: StoragePosture = 'local';

  private readonly dataDir: string;
  private db: PGlite | null = null;
  private opening: Promise<PGlite> | null = null;

  constructor(options: PGliteStorageAdapterOptions = {}) {
    this.dataDir = options.dataDir ?? LOCAL_MEMORY_DATA_DIR;
  }

  /**
   * Open the database and apply the schema. Safe to call repeatedly and safe to
   * race — concurrent callers share one open, so the schema is never applied twice.
   */
  async init(): Promise<void> {
    await this.open();
  }

  private open(): Promise<PGlite> {
    if (this.db) return Promise.resolve(this.db);
    if (!this.opening) {
      this.opening = (async () => {
        // pgvector ships as its own package from PGlite 0.5 (it was the
        // `@electric-sql/pglite/vector` subpath in 0.2.x, which no longer exists).
        const [{ PGlite: PGliteCtor }, { vector }] = await Promise.all([
          import('@electric-sql/pglite'),
          import('@electric-sql/pglite-pgvector'),
        ]);
        const db = await PGliteCtor.create({
          dataDir: this.dataDir,
          extensions: { vector },
        });
        await db.exec(LOCAL_SCHEMA_SQL);
        this.db = db;
        return db;
      })().catch((err) => {
        // Leave no half-open state behind: a failed open must be retryable.
        this.opening = null;
        throw err;
      });
    }
    return this.opening;
  }

  /** Release the WASM instance. IndexedDB contents survive; `memory://` does not. */
  async close(): Promise<void> {
    const db = this.db;
    this.db = null;
    this.opening = null;
    if (db) await db.close();
  }

  private async rows(sql: string, params: unknown[] = []): Promise<Row[]> {
    const db = await this.open();
    const result = await db.query<Row>(sql, params);
    return result.rows;
  }

  // documents ---------------------------------------------------------------

  async getDocuments(userId?: string): Promise<DocumentRecord[]> {
    const rows = await this.rows(
      `select * from documents where ($1::text is null or user_id = $1::uuid) order by created_at desc, id asc`,
      [userId ?? null],
    );
    return rows.map(toDocument);
  }

  async getDocumentById(id: string): Promise<DocumentRecord | null> {
    const rows = await this.rows(`select * from documents where id = $1::uuid`, [id]);
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async insertDocument(doc: InsertDocumentInput): Promise<DocumentRecord> {
    const rows = await this.rows(
      `insert into documents (id, user_id, kind, file_name, mime_type, storage_path, extracted_text, parsed_at, origin)
       values (coalesce($1::uuid, gen_random_uuid()), $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz, $9)
       returning *`,
      [
        doc.id ?? null,
        doc.user_id,
        doc.kind,
        doc.file_name,
        doc.mime_type,
        doc.storage_path ?? null,
        doc.extracted_text ?? null,
        doc.parsed_at ?? null,
        doc.origin ?? null,
      ],
    );
    return toDocument(rows[0] as Row);
  }

  async deleteDocument(id: string, userId?: string): Promise<void> {
    await this.rows(
      `delete from documents where id = $1::uuid and ($2::text is null or user_id = $2::uuid)`,
      [id, userId ?? null],
    );
  }

  // memory chunks -----------------------------------------------------------

  async getMemoryChunks(documentId: string): Promise<MemoryChunkRecord[]> {
    const rows = await this.rows(
      `select ${CHUNK_COLUMNS} from memory_chunks mc where document_id = $1::uuid order by chunk_index asc`,
      [documentId],
    );
    return rows.map(toMemoryChunk);
  }

  async insertMemoryChunks(chunks: InsertMemoryChunkInput[]): Promise<MemoryChunkRecord[]> {
    if (chunks.length === 0) return [];
    const cols = 8;
    const values: unknown[] = [];
    const tuples = chunks.map((chunk, i) => {
      const base = i * cols;
      values.push(
        chunk.id ?? null,
        chunk.user_id,
        chunk.document_id ?? null,
        chunk.chunk_index,
        chunk.type ?? 'experience',
        chunk.text,
        toVectorLiteral(chunk.embedding),
        chunk.freshness_at ?? null,
      );
      return `(coalesce($${base + 1}::uuid, gen_random_uuid()), $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::int, $${base + 5}, $${base + 6}, ($${base + 7}::text)::vector, $${base + 8}::timestamptz)`;
    });
    const rows = await this.rows(
      `insert into memory_chunks (id, user_id, document_id, chunk_index, type, text, embedding, freshness_at)
       values ${tuples.join(', ')}
       returning ${CHUNK_COLUMNS}`,
      values,
    );
    return rows.map(toMemoryChunk);
  }

  async deleteMemoryChunksByDocumentId(documentId: string, userId?: string): Promise<void> {
    await this.rows(
      `delete from memory_chunks where document_id = $1::uuid and ($2::text is null or user_id = $2::uuid)`,
      [documentId, userId ?? null],
    );
  }

  async searchHybrid(params: SearchHybridParams): Promise<ScoredChunk[]> {
    const tokens = queryTokens(params.query);
    const rows = await this.rows(SEARCH_HYBRID_SQL, [
      toVectorLiteral(params.queryEmbedding),
      JSON.stringify(tokens),
      tokens.length,
      params.userId ?? null,
      params.roleMatchThreshold ?? 0,
      params.limit ?? DEFAULT_SEARCH_LIMIT,
    ]);
    return rows.map((row) => ({
      chunk: toMemoryChunk(row),
      vectorScore: Number(row.vector_score ?? 0),
      keywordScore: Number(row.keyword_score ?? 0),
      score: Number(row.score ?? 0),
    }));
  }

  // q&a pairs ---------------------------------------------------------------

  async getQAPairs(userId?: string): Promise<QAPairRecord[]> {
    const rows = await this.rows(
      `select ${QA_COLUMNS} from qa_pairs where ($1::text is null or user_id = $1::uuid) order by created_at desc, id asc`,
      [userId ?? null],
    );
    return rows.map(toQAPair);
  }

  async insertQAPair(qa: InsertQAPairInput): Promise<QAPairRecord> {
    const rows = await this.rows(
      `insert into qa_pairs (id, user_id, application_id, question_label, question_norm, answer_text, draft_text, origin, edit_distance, embedding)
       values (coalesce($1::uuid, gen_random_uuid()), $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::int, ($10::text)::vector)
       returning ${QA_COLUMNS}`,
      [
        qa.id ?? null,
        qa.user_id,
        qa.application_id ?? null,
        qa.question_label,
        qa.question_norm,
        qa.answer_text,
        qa.draft_text ?? null,
        qa.origin,
        qa.edit_distance ?? 0,
        toVectorLiteral(qa.embedding),
      ],
    );
    return toQAPair(rows[0] as Row);
  }

  async deleteQAPair(id: string, userId?: string): Promise<void> {
    await this.rows(
      `delete from qa_pairs where id = $1::uuid and ($2::text is null or user_id = $2::uuid)`,
      [id, userId ?? null],
    );
  }

  async getQAPairsCount(userId?: string): Promise<number> {
    const rows = await this.rows(
      `select count(*)::int as count from qa_pairs where ($1::text is null or user_id = $1::uuid)`,
      [userId ?? null],
    );
    return Number(rows[0]?.count ?? 0);
  }

  // style profile -----------------------------------------------------------

  async getStyleProfile(userId?: string): Promise<StyleProfileRecord | null> {
    const rows = await this.rows(
      `select * from style_profile where ($1::text is null or user_id = $1::uuid) limit 1`,
      [userId ?? null],
    );
    return rows[0] ? toStyleProfile(rows[0]) : null;
  }

  async upsertStyleProfile(profile: UpsertStyleProfileInput): Promise<StyleProfileRecord> {
    // Columns are built from the keys the caller actually supplied, which is
    // exactly how PostgREST builds an upsert: omitted columns keep their
    // current value, and an explicit `null` clears one. Writing a fixed column
    // list with `coalesce` instead would conflate "not supplied" with "null"
    // and make the two postures disagree on a partial update.
    const columns: string[] = ['user_id'];
    const values: unknown[] = [profile.user_id];
    const casts: Record<string, string> = {
      user_id: '::uuid',
      generated_at: '::timestamptz',
      corpus_size: '::int',
      rebuilding: '::boolean',
      rebuilding_started_at: '::timestamptz',
    };
    const optional = [
      'profile_md',
      'generated_at',
      'corpus_size',
      'rebuilding',
      'rebuilding_started_at',
      'batch_job_id',
    ] as const;
    for (const key of optional) {
      if (profile[key] !== undefined) {
        columns.push(key);
        values.push(profile[key]);
      }
    }
    const placeholders = columns.map((c, i) => `$${i + 1}${casts[c] ?? ''}`);
    const updates = columns
      .filter((c) => c !== 'user_id')
      .map((c) => `${c} = excluded.${c}`)
      .concat(`updated_at = timezone('utc'::text, now())`);

    const rows = await this.rows(
      `insert into style_profile (${columns.join(', ')})
       values (${placeholders.join(', ')})
       on conflict (user_id) do update set ${updates.join(', ')}
       returning *`,
      values,
    );
    return toStyleProfile(rows[0] as Row);
  }

  // telemetry & audit -------------------------------------------------------

  async logGateDecision(decision: InsertGateDecisionInput): Promise<void> {
    await this.rows(
      `insert into gate_decisions (user_id, application_id, question_norm, question_match, role_match, outcome, user_action)
       values ($1::uuid, $2::uuid, $3, $4::float8, $5::float8, $6, $7)`,
      [
        decision.user_id,
        decision.application_id ?? null,
        decision.question_norm,
        decision.question_match,
        decision.role_match,
        decision.outcome,
        decision.user_action ?? null,
      ],
    );
  }

  async logExtractionFailure(failure: InsertExtractionFailureInput): Promise<void> {
    await this.rows(
      `insert into extraction_failures (user_id, adapter, host, url, url_hash, detected_fields, extracted_questions, failure_reason)
       values ($1::uuid, $2, $3, $4, $5, coalesce($6::int, 0), coalesce($7::int, 0), $8)`,
      [
        failure.user_id,
        failure.adapter,
        failure.host,
        failure.url ?? null,
        failure.url_hash ?? null,
        failure.detected_fields ?? null,
        failure.extracted_questions ?? null,
        failure.failure_reason ?? null,
      ],
    );
  }

  async logCaptureMismatch(mismatch: InsertCaptureMismatchInput): Promise<void> {
    await this.rows(
      `insert into capture_mismatches (user_id, application_id, question_label, original_mapping, rederived_mapping, reason)
       values ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $6)`,
      [
        mismatch.user_id,
        mismatch.application_id ?? null,
        mismatch.question_label,
        mismatch.original_mapping === undefined ? null : JSON.stringify(mismatch.original_mapping),
        mismatch.rederived_mapping === undefined ? null : JSON.stringify(mismatch.rederived_mapping),
        mismatch.reason,
      ],
    );
  }
}
