import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeSupabaseClient } from './fakeSupabase.ts';
import { hybridScore } from '../gate/retrieve.ts';
import { HYBRID_KEYWORD_WEIGHT, HYBRID_VECTOR_WEIGHT, queryTokens } from './hybrid.ts';
import { parseEmbedding, toVectorLiteral } from './embedding.ts';
import { IN_MEMORY_DATA_DIR, PGliteStorageAdapter } from './pgliteStorageAdapter.ts';
import { SupabaseStorageAdapter } from './supabaseStorageAdapter.ts';
import type { StorageAdapter } from './storageAdapter.ts';
import type { InsertMemoryChunkInput } from './types.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

/**
 * 384-dim gte-small-shaped vector with a few non-zero components. Values are
 * exactly representable in binary32 so pgvector's float4 storage is lossless
 * and PGlite's SQL cosine can be compared against the JS one.
 */
function embed(components: Record<number, number>): number[] {
  const v = new Array<number>(384).fill(0);
  for (const [index, value] of Object.entries(components)) v[Number(index)] = value;
  return v;
}

const PAYMENTS_VEC = embed({ 0: 1 });
const MENTORING_VEC = embed({ 1: 1 });
const MIXED_VEC = embed({ 0: 0.5, 1: 0.5 });

const QUERY = 'payments platform migration';
const QUERY_VEC = embed({ 0: 1 });

/** The three chunks every retrieval test ranks, in a fixed order. */
function seedChunks(userId = USER): InsertMemoryChunkInput[] {
  return [
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      user_id: userId,
      chunk_index: 0,
      type: 'experience',
      text: 'Led the payments platform migration for a regional marketplace.',
      embedding: PAYMENTS_VEC,
    },
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      user_id: userId,
      chunk_index: 1,
      type: 'story',
      text: 'Mentored three junior engineers through their first code reviews.',
      embedding: MENTORING_VEC,
    },
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000003',
      user_id: userId,
      chunk_index: 2,
      type: 'skill',
      text: 'Built internal tooling for release automation and rollout safety.',
      embedding: MIXED_VEC,
    },
  ];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('embedding serialization', () => {
  it('round-trips through the pgvector literal form', () => {
    expect(parseEmbedding(toVectorLiteral([0.5, -0.25, 0]))).toEqual([0.5, -0.25, 0]);
  });

  it('accepts the array form the extension already holds', () => {
    expect(parseEmbedding([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('treats absent or empty vectors as null', () => {
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding(undefined)).toBeNull();
    expect(parseEmbedding('')).toBeNull();
    expect(toVectorLiteral([])).toBeNull();
    expect(toVectorLiteral(null)).toBeNull();
  });
});

describe('hybrid weighting', () => {
  it('derives 0.7/0.3 from gate/retrieve rather than restating it', () => {
    expect(HYBRID_VECTOR_WEIGHT).toBeCloseTo(0.7, 10);
    expect(HYBRID_KEYWORD_WEIGHT).toBeCloseTo(0.3, 10);
    expect(hybridScore(1, 1)).toBeCloseTo(HYBRID_VECTOR_WEIGHT + HYBRID_KEYWORD_WEIGHT, 10);
  });

  it('tokenizes a query the way keywordOverlap does — lowercased, deduped, split on \\W+', () => {
    expect(queryTokens('Payments, payments — PLATFORM migration!')).toEqual([
      'payments',
      'platform',
      'migration',
    ]);
    expect(queryTokens('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PGlite: initialization and schema
// ---------------------------------------------------------------------------

describe('PGliteStorageAdapter initialization', () => {
  it('creates every Jobibi table and enables pgvector', async () => {
    const adapter = new PGliteStorageAdapter({ dataDir: IN_MEMORY_DATA_DIR });
    await adapter.init();

    // init() is idempotent — the schema is all `if not exists`.
    await adapter.init();

    const db = adapter as unknown as {
      rows(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
    };

    const tables = (
      await db.rows(
        `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
      )
    ).map((r) => r.table_name);
    expect(tables).toEqual([
      'capture_mismatches',
      'documents',
      'extraction_failures',
      'gate_decisions',
      'memory_chunks',
      'qa_pairs',
      'style_profile',
    ]);

    const ext = await db.rows(`select extname from pg_extension where extname = 'vector'`);
    expect(ext).toHaveLength(1);

    const [embeddingCol] = await db.rows(
      `select udt_name from information_schema.columns
       where table_name = 'memory_chunks' and column_name = 'embedding'`,
    );
    expect(embeddingCol?.udt_name).toBe('vector');

    await adapter.close();
  });

  it('enforces the same CHECK constraints as the cloud migrations', async () => {
    const adapter = new PGliteStorageAdapter({ dataDir: IN_MEMORY_DATA_DIR });
    await adapter.init();

    await expect(
      adapter.insertDocument({
        user_id: USER,
        kind: 'portfolio' as never,
        file_name: 'x.pdf',
        mime_type: 'application/pdf',
      }),
    ).rejects.toThrow();

    await expect(
      adapter.insertMemoryChunks([
        { user_id: USER, chunk_index: 0, type: 'invented' as never, text: 'nope' },
      ]),
    ).rejects.toThrow();

    await adapter.close();
  });
});

// ---------------------------------------------------------------------------
// Shared behaviour: both adapters run the same suite
// ---------------------------------------------------------------------------

interface Harness {
  name: string;
  adapter: StorageAdapter;
  teardown(): Promise<void>;
}

const harnesses: Harness[] = [];

beforeAll(async () => {
  const local = new PGliteStorageAdapter({ dataDir: IN_MEMORY_DATA_DIR });
  await local.init();
  harnesses.push({ name: 'PGliteStorageAdapter', adapter: local, teardown: () => local.close() });

  const { client } = createFakeSupabaseClient();
  harnesses.push({
    name: 'SupabaseStorageAdapter',
    adapter: new SupabaseStorageAdapter(client),
    teardown: async () => {},
  });
});

afterAll(async () => {
  for (const h of harnesses) await h.teardown();
});

function harness(name: string): StorageAdapter {
  const found = harnesses.find((h) => h.name === name);
  if (!found) throw new Error(`harness ${name} not set up`);
  return found.adapter;
}

describe.each(['PGliteStorageAdapter', 'SupabaseStorageAdapter'])('%s', (name) => {
  it('reports its posture', () => {
    const expected = name === 'PGliteStorageAdapter' ? 'local' : 'cloud';
    expect(harness(name).posture).toBe(expected);
  });

  it('inserts, reads back and deletes a document', async () => {
    const adapter = harness(name);
    const doc = await adapter.insertDocument({
      user_id: USER,
      kind: 'resume',
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      storage_path: `${USER}/resume.pdf`,
      extracted_text: 'Ten years building payments systems.',
      origin: 'user_written',
    });

    expect(doc.id).toBeTruthy();
    expect(doc.user_id).toBe(USER);
    expect(doc.kind).toBe('resume');
    expect(doc.origin).toBe('user_written');
    expect(doc.parsed_at).toBeNull();
    expect(typeof doc.created_at).toBe('string');

    expect(await adapter.getDocumentById(doc.id)).toMatchObject({ id: doc.id, kind: 'resume' });
    expect((await adapter.getDocuments(USER)).map((d) => d.id)).toContain(doc.id);

    await adapter.deleteDocument(doc.id, USER);
    expect(await adapter.getDocumentById(doc.id)).toBeNull();
    expect((await adapter.getDocuments(USER)).map((d) => d.id)).not.toContain(doc.id);
  });

  it('does not delete another user’s document when scoped', async () => {
    const adapter = harness(name);
    const doc = await adapter.insertDocument({
      user_id: USER,
      kind: 'resume',
      file_name: 'scoped.pdf',
      mime_type: 'application/pdf',
    });

    await adapter.deleteDocument(doc.id, OTHER_USER);
    expect(await adapter.getDocumentById(doc.id)).not.toBeNull();

    await adapter.deleteDocument(doc.id, USER);
    expect(await adapter.getDocumentById(doc.id)).toBeNull();
  });

  it('inserts memory chunks with embeddings and reads them back by document', async () => {
    const adapter = harness(name);
    const doc = await adapter.insertDocument({
      user_id: USER,
      kind: 'resume',
      file_name: 'chunked.pdf',
      mime_type: 'application/pdf',
    });

    const inserted = await adapter.insertMemoryChunks(
      seedChunks().map((c, i) => ({
        ...c,
        id: undefined,
        document_id: doc.id,
        chunk_index: i,
      })),
    );

    expect(inserted).toHaveLength(3);
    expect(inserted[0]!.embedding).toHaveLength(384);
    expect(inserted[0]!.embedding![0]).toBeCloseTo(1, 6);

    const read = await adapter.getMemoryChunks(doc.id);
    expect(read).toHaveLength(3);
    expect(read.map((c) => c.text).sort()).toEqual(inserted.map((c) => c.text).sort());
    expect(read.every((c) => c.embedding?.length === 384)).toBe(true);

    await adapter.deleteMemoryChunksByDocumentId(doc.id, USER);
    expect(await adapter.getMemoryChunks(doc.id)).toHaveLength(0);

    await adapter.deleteDocument(doc.id, USER);
  });

  it('accepts a chunk with no embedding', async () => {
    const adapter = harness(name);
    const doc = await adapter.insertDocument({
      user_id: USER,
      kind: 'resume',
      file_name: 'no-embedding.pdf',
      mime_type: 'application/pdf',
    });
    const [chunk] = await adapter.insertMemoryChunks([
      { user_id: USER, document_id: doc.id, chunk_index: 0, text: 'Embedding failed at write.' },
    ]);
    expect(chunk!.embedding).toBeNull();
    expect(chunk!.type).toBe('experience');

    await adapter.deleteMemoryChunksByDocumentId(doc.id, USER);
    await adapter.deleteDocument(doc.id, USER);
  });

  it('inserting zero chunks is a no-op', async () => {
    expect(await harness(name).insertMemoryChunks([])).toEqual([]);
  });

  it('stores, counts and deletes q&a pairs', async () => {
    const adapter = harness(name);
    const before = await adapter.getQAPairsCount(USER);

    const qa = await adapter.insertQAPair({
      user_id: USER,
      question_label: 'Why do you want this role?',
      question_norm: 'why do you want this role',
      answer_text: 'Because the payments problem space is where I do my best work.',
      draft_text: 'Because payments is interesting.',
      origin: 'user_edited',
      edit_distance: 31,
      embedding: PAYMENTS_VEC,
    });

    expect(qa.origin).toBe('user_edited');
    expect(qa.edit_distance).toBe(31);
    expect(qa.embedding).toHaveLength(384);
    expect(await adapter.getQAPairsCount(USER)).toBe(before + 1);
    expect((await adapter.getQAPairs(USER)).map((r) => r.id)).toContain(qa.id);

    await adapter.deleteQAPair(qa.id, USER);
    expect(await adapter.getQAPairsCount(USER)).toBe(before);
  });

  it('counts only the scoped user’s q&a pairs', async () => {
    const adapter = harness(name);
    const mine = await adapter.getQAPairsCount(USER);
    const theirs = await adapter.getQAPairsCount(OTHER_USER);

    const qa = await adapter.insertQAPair({
      user_id: OTHER_USER,
      question_label: 'Describe a conflict you resolved.',
      question_norm: 'describe a conflict you resolved',
      answer_text: 'We disagreed about rollout order and settled it with a staged release.',
      origin: 'user_written',
    });

    expect(await adapter.getQAPairsCount(OTHER_USER)).toBe(theirs + 1);
    expect(await adapter.getQAPairsCount(USER)).toBe(mine);

    await adapter.deleteQAPair(qa.id, OTHER_USER);
  });

  it('upserts a style profile and preserves fields a partial update omits', async () => {
    const adapter = harness(name);

    const created = await adapter.upsertStyleProfile({
      user_id: USER,
      profile_md: '- Writes in short, concrete sentences.',
      corpus_size: 10,
      generated_at: '2026-08-15T00:00:00.000Z',
    });
    expect(created.profile_md).toBe('- Writes in short, concrete sentences.');
    expect(created.corpus_size).toBe(10);
    expect(created.rebuilding).toBe(false);

    const flagged = await adapter.upsertStyleProfile({
      user_id: USER,
      rebuilding: true,
      rebuilding_started_at: '2026-08-15T01:00:00.000Z',
    });
    expect(flagged.rebuilding).toBe(true);
    // D13/D19: flipping the in-flight flag must not blank the distilled voice.
    expect(flagged.profile_md).toBe('- Writes in short, concrete sentences.');
    expect(flagged.corpus_size).toBe(10);

    const fetched = await adapter.getStyleProfile(USER);
    expect(fetched?.rebuilding).toBe(true);
    expect(fetched?.profile_md).toBe('- Writes in short, concrete sentences.');
  });

  it('returns null when no style profile exists yet', async () => {
    expect(await harness(name).getStyleProfile(OTHER_USER)).toBeNull();
  });

  it('logs a gate decision with both axes (D15)', async () => {
    const adapter = harness(name);
    await expect(
      adapter.logGateDecision({
        user_id: USER,
        question_norm: 'why do you want this role',
        question_match: 0.82,
        role_match: 0.61,
        outcome: 'draft',
        user_action: 'copied',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a gate outcome outside draft/ask/refuse', async () => {
    // The gate has three outcomes, not two (D10) — storage must not widen that.
    const adapter = harness(name);
    const write = adapter.logGateDecision({
      user_id: USER,
      question_norm: 'why do you want this role',
      question_match: 0.1,
      role_match: 0.1,
      outcome: 'confirm' as never,
    });
    if (name === 'PGliteStorageAdapter') {
      await expect(write).rejects.toThrow();
    } else {
      // The fake has no CHECK constraints; the real cloud table does.
      await expect(write).resolves.toBeUndefined();
    }
  });

  it('logs extraction failures and capture mismatches', async () => {
    const adapter = harness(name);
    await expect(
      adapter.logExtractionFailure({
        user_id: USER,
        adapter: 'jobstreet',
        host: 'jobstreet.com.ph',
        url: 'https://jobstreet.com.ph/job/1',
        detected_fields: 4,
        extracted_questions: 0,
        failure_reason: 'no labelled questions found',
      }),
    ).resolves.toBeUndefined();

    await expect(
      adapter.logCaptureMismatch({
        user_id: USER,
        question_label: 'Why do you want this role?',
        original_mapping: { fieldId: 'q1' },
        rederived_mapping: { fieldId: 'q2' },
        reason: 'field id moved between draft and submit',
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Hybrid retrieval
// ---------------------------------------------------------------------------

describe('searchHybrid', () => {
  let local: PGliteStorageAdapter;
  let cloud: SupabaseStorageAdapter;
  let localDocId: string;

  beforeAll(async () => {
    local = new PGliteStorageAdapter({ dataDir: IN_MEMORY_DATA_DIR });
    await local.init();
    const doc = await local.insertDocument({
      user_id: USER,
      kind: 'resume',
      file_name: 'retrieval.pdf',
      mime_type: 'application/pdf',
    });
    localDocId = doc.id;
    await local.insertMemoryChunks(seedChunks().map((c) => ({ ...c, document_id: doc.id })));

    const { client } = createFakeSupabaseClient();
    cloud = new SupabaseStorageAdapter(client);
    await cloud.insertMemoryChunks(seedChunks());
  });

  afterAll(async () => {
    await local.close();
  });

  // Resolved lazily: `it.each` builds its cases at collection time, before
  // `beforeAll` has opened either adapter.
  const postures = ['local', 'cloud'] as const;
  const pick = (label: (typeof postures)[number]): StorageAdapter =>
    label === 'local' ? local : cloud;

  it.each(postures)('%s ranks vector+keyword matches above vector-only ones', async (label) => {
    const results = await pick(label).searchHybrid({
      userId: USER,
      query: QUERY,
      queryEmbedding: QUERY_VEC,
    });

    expect(results.map((r) => r.chunk.chunk_index)).toEqual([0, 2, 1]);

    const [top, middle, bottom] = results;
    // Exact-cosine + every query token present.
    expect(top!.vectorScore).toBeCloseTo(1, 5);
    expect(top!.keywordScore).toBeCloseTo(1, 5);
    expect(top!.score).toBeCloseTo(1, 5);
    // Partial vector overlap, no keyword hits.
    expect(middle!.vectorScore).toBeCloseTo(Math.SQRT1_2, 5);
    expect(middle!.keywordScore).toBe(0);
    expect(middle!.score).toBeCloseTo(hybridScore(Math.SQRT1_2, 0), 5);
    expect(bottom!.score).toBeCloseTo(0, 5);
  });

  it.each(postures)('%s honours the limit', async (label) => {
    const results = await pick(label).searchHybrid({
      userId: USER,
      query: QUERY,
      queryEmbedding: QUERY_VEC,
      limit: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.chunk.chunk_index).toBe(0);
  });

  it.each(postures)('%s drops chunks below the score floor', async (label) => {
    const results = await pick(label).searchHybrid({
      userId: USER,
      query: QUERY,
      queryEmbedding: QUERY_VEC,
      roleMatchThreshold: 0.6,
    });
    expect(results.map((r) => r.chunk.chunk_index)).toEqual([0]);
  });

  it.each(postures)('%s falls back to keyword-only when there is no query embedding', async (label) => {
    const results = await pick(label).searchHybrid({
      userId: USER,
      query: QUERY,
      queryEmbedding: [],
    });
    // With no vectors the vector axis mirrors the keyword axis, so only the
    // chunk that shares tokens with the question scores at all.
    expect(results[0]!.chunk.chunk_index).toBe(0);
    expect(results[0]!.vectorScore).toBeCloseTo(results[0]!.keywordScore, 10);
    expect(results[0]!.score).toBeCloseTo(1, 5);
    expect(results.slice(1).every((r) => r.score === 0)).toBe(true);
  });

  it.each(postures)('%s returns nothing for a user with no memory', async (label) => {
    const results = await pick(label).searchHybrid({
      userId: OTHER_USER,
      query: QUERY,
      queryEmbedding: QUERY_VEC,
    });
    expect(results).toEqual([]);
  });

  it('ranks identically across both postures', async () => {
    const params = { userId: USER, query: QUERY, queryEmbedding: QUERY_VEC };
    const [localResults, cloudResults] = await Promise.all([
      local.searchHybrid(params),
      cloud.searchHybrid(params),
    ]);

    expect(localResults).toHaveLength(cloudResults.length);
    localResults.forEach((lr, i) => {
      const cr = cloudResults[i]!;
      expect(lr.chunk.text).toBe(cr.chunk.text);
      expect(lr.chunk.chunk_index).toBe(cr.chunk.chunk_index);
      expect(lr.chunk.type).toBe(cr.chunk.type);
      // PGlite scores in SQL over float4 vectors, the cloud adapter in JS over
      // float64 — identical order, and identical scores to well inside any
      // difference the gate could act on.
      expect(lr.keywordScore).toBeCloseTo(cr.keywordScore, 10);
      expect(lr.vectorScore).toBeCloseTo(cr.vectorScore, 6);
      expect(lr.score).toBeCloseTo(cr.score, 6);
    });
  });

  it('keeps the local chunks attached to their document', async () => {
    expect(await local.getMemoryChunks(localDocId)).toHaveLength(3);
  });
});
