/**
 * A tiny in-memory stand-in for the PostgREST query builder, used by the S14A
 * parity tests.
 *
 * It exists because parity is the claim S14A actually has to defend: the same
 * calls, against the same rows, must come back the same shape and the same
 * order from either posture. Reaching a real Supabase project from a unit test
 * would make that assertion a network flake, so the cloud side is exercised
 * against a fake that mimics the small surface `SupabaseStorageAdapter` uses —
 * `.select/.insert/.upsert/.delete`, `.eq`, `.order`, `.limit`,
 * `.single/.maybeSingle`, and head-count selects.
 *
 * Two behaviours are copied deliberately because the adapter depends on them:
 * pgvector columns come back as `"[0.1,0.2]"` strings, not arrays; and an
 * upsert writes only the keys present in the payload.
 *
 * Not exported from the package barrel — test support, not product code.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { toVectorLiteral } from './embedding.ts';

export type FakeRow = Record<string, unknown>;
export type FakeStore = Record<string, FakeRow[]>;

interface Result {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
}

/** Column defaults applied on insert, mirroring the migrations' DEFAULT clauses. */
const DEFAULTS: Record<string, () => FakeRow> = {
  documents: () => ({
    id: crypto.randomUUID(),
    storage_path: null,
    extracted_text: null,
    parsed_at: null,
    origin: null,
    created_at: new Date().toISOString(),
  }),
  memory_chunks: () => ({
    id: crypto.randomUUID(),
    document_id: null,
    type: 'experience',
    embedding: null,
    freshness_at: null,
    created_at: new Date().toISOString(),
  }),
  qa_pairs: () => ({
    id: crypto.randomUUID(),
    application_id: null,
    draft_text: null,
    edit_distance: 0,
    embedding: null,
    created_at: new Date().toISOString(),
  }),
  style_profile: () => ({
    profile_md: null,
    generated_at: null,
    corpus_size: 0,
    rebuilding: false,
    rebuilding_started_at: null,
    batch_job_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  gate_decisions: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }),
  extraction_failures: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }),
  capture_mismatches: () => ({ id: crypto.randomUUID(), created_at: new Date().toISOString() }),
};

/** Store embeddings the way PostgREST returns them: a pgvector literal string. */
function normalizeWrite(row: FakeRow): FakeRow {
  const out = { ...row };
  if (Array.isArray(out.embedding)) out.embedding = toVectorLiteral(out.embedding as number[]);
  return out;
}

class FakeQuery implements PromiseLike<Result> {
  private filters: [string, unknown][] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rowLimit: number | null = null;
  private returning = false;
  private headOnly = false;
  private wantCount = false;

  constructor(
    private readonly store: FakeStore,
    private readonly table: string,
    private readonly op: 'select' | 'insert' | 'upsert' | 'delete',
    private readonly payload: FakeRow[] = [],
    private readonly onConflict: string | null = null,
  ) {
    this.returning = op === 'select';
  }

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    this.returning = true;
    if (options?.count) this.wantCount = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.rowLimit = n;
    return this;
  }

  single(): Promise<Result> {
    return this.run().then((r) => {
      const rows = (r.data as FakeRow[] | null) ?? [];
      if (rows.length !== 1) {
        return { data: null, error: { message: 'expected exactly one row' }, count: null };
      }
      return { data: rows[0] as unknown, error: null, count: null };
    });
  }

  maybeSingle(): Promise<Result> {
    return this.run().then((r) => {
      const rows = (r.data as FakeRow[] | null) ?? [];
      if (rows.length > 1) {
        return { data: null, error: { message: 'expected at most one row' }, count: null };
      }
      return { data: (rows[0] as unknown) ?? null, error: null, count: null };
    });
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private table_(): FakeRow[] {
    this.store[this.table] ??= [];
    return this.store[this.table]!;
  }

  private matches(row: FakeRow): boolean {
    return this.filters.every(([col, val]) => row[col] === val);
  }

  private run(): Promise<Result> {
    const rows = this.table_();

    if (this.op === 'insert' || this.op === 'upsert') {
      const written: FakeRow[] = [];
      for (const raw of this.payload) {
        const incoming = normalizeWrite(raw);
        const key = this.onConflict;
        const existing = key ? rows.find((r) => r[key] === incoming[key]) : undefined;
        if (existing) {
          // PostgREST upsert writes only the supplied keys.
          Object.assign(existing, incoming, { updated_at: new Date().toISOString() });
          written.push(existing);
        } else {
          const row = { ...(DEFAULTS[this.table]?.() ?? {}), ...incoming };
          rows.push(row);
          written.push(row);
        }
      }
      return Promise.resolve({ data: this.returning ? written : null, error: null, count: null });
    }

    if (this.op === 'delete') {
      const kept = rows.filter((r) => !this.matches(r));
      const removed = rows.filter((r) => this.matches(r));
      this.store[this.table] = kept;
      return Promise.resolve({ data: this.returning ? removed : null, error: null, count: null });
    }

    let selected = rows.filter((r) => this.matches(r));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      selected = [...selected].sort((a, b) => {
        const av = String(a[column] ?? '');
        const bv = String(b[column] ?? '');
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    const count = this.wantCount ? selected.length : null;
    if (this.rowLimit !== null) selected = selected.slice(0, this.rowLimit);
    return Promise.resolve({ data: this.headOnly ? null : selected, error: null, count });
  }
}

class FakeTable {
  constructor(
    private readonly store: FakeStore,
    private readonly table: string,
  ) {}

  select(columns?: string, options?: { count?: string; head?: boolean }): FakeQuery {
    return new FakeQuery(this.store, this.table, 'select').select(columns, options);
  }

  insert(payload: FakeRow | FakeRow[]): FakeQuery {
    return new FakeQuery(this.store, this.table, 'insert', ([] as FakeRow[]).concat(payload));
  }

  upsert(payload: FakeRow | FakeRow[], options?: { onConflict?: string }): FakeQuery {
    return new FakeQuery(
      this.store,
      this.table,
      'upsert',
      ([] as FakeRow[]).concat(payload),
      options?.onConflict ?? null,
    );
  }

  delete(): FakeQuery {
    return new FakeQuery(this.store, this.table, 'delete');
  }
}

/** Build a `SupabaseClient`-shaped fake backed by `store`. */
export function createFakeSupabaseClient(store: FakeStore = {}): {
  client: SupabaseClient;
  store: FakeStore;
} {
  const client = {
    from: (table: string) => new FakeTable(store, table),
  } as unknown as SupabaseClient;
  return { client, store };
}
