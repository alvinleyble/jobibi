/**
 * The Local BYO-Key schema, applied to a fresh PGlite database on first open.
 *
 * Column names, types and CHECK constraints track `supabase/migrations/` — that
 * is what makes the two postures interchangeable. Two deliberate differences:
 *
 * 1. No `references auth.users` — there is no auth schema in a local database.
 *    `user_id` stays `not null` so rows are still attributable if a local file
 *    is ever imported into the cloud.
 * 2. No RLS and no grants. RLS is what separates *different users* on a shared
 *    Postgres; a local database is one user's own machine, and enabling RLS
 *    there without a JWT would only lock the owner out of their own memory.
 *
 * Everything is `if not exists`, so opening an existing IndexedDB database is a
 * no-op rather than a migration.
 */

export const LOCAL_SCHEMA_VERSION = 1;

export const LOCAL_SCHEMA_SQL = `
create extension if not exists vector;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('resume', 'cover_letter', 'transcript')),
  file_name text not null,
  mime_type text not null,
  storage_path text,
  extracted_text text,
  parsed_at timestamptz,
  origin text check (origin in ('user_written', 'user_edited', 'accepted_verbatim')),
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists documents_user_id_idx on documents (user_id, created_at desc);

create table if not exists memory_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_id uuid references documents (id) on delete cascade,
  chunk_index integer not null,
  type text not null default 'experience'
    check (type in ('experience', 'skill', 'story', 'preference', 'gap_answer', 'qa_pair')),
  text text not null,
  embedding vector(384),
  freshness_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists memory_chunks_user_id_idx on memory_chunks (user_id);
create index if not exists memory_chunks_document_id_idx on memory_chunks (document_id);

create table if not exists qa_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  application_id uuid,
  question_label text not null,
  question_norm text not null,
  answer_text text not null,
  draft_text text,
  origin text not null check (origin in ('user_written', 'user_edited', 'accepted_verbatim')),
  edit_distance integer not null default 0,
  embedding vector(384),
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists qa_pairs_user_id_idx on qa_pairs (user_id, created_at desc);
create index if not exists qa_pairs_question_norm_idx on qa_pairs (user_id, question_norm);

create table if not exists style_profile (
  user_id uuid primary key,
  profile_md text,
  generated_at timestamptz,
  corpus_size integer not null default 0,
  rebuilding boolean not null default false,
  rebuilding_started_at timestamptz,
  batch_job_id text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists gate_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  application_id uuid,
  question_norm text not null,
  question_match double precision not null,
  role_match double precision not null,
  outcome text not null check (outcome in ('draft', 'ask', 'refuse')),
  user_action text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists gate_decisions_user_id_idx on gate_decisions (user_id, created_at desc);

create table if not exists extraction_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  adapter text not null check (adapter in ('jobstreet', 'linkedin', 'indeed', 'generic')),
  host text not null,
  url text,
  url_hash text,
  detected_fields integer not null default 0,
  extracted_questions integer not null default 0,
  failure_reason text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists extraction_failures_user_id_idx on extraction_failures (user_id, created_at desc);

create table if not exists capture_mismatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  application_id uuid,
  question_label text not null,
  original_mapping jsonb,
  rederived_mapping jsonb,
  reason text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists capture_mismatches_user_id_idx on capture_mismatches (user_id, created_at desc);
`;
