-- Memory bank schema for S3: uploaded documents, their searchable chunks,
-- and the four sensitive facts collected at intake (D18).
--
-- All inserts happen client-side under the caller's own JWT (no service-role
-- writes for this slice), so RLS is the only thing standing between one
-- user's memory bank and another's. Enabled from creation, per project
-- convention (D2).

create extension if not exists vector with schema extensions;

-- documents ------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('resume', 'cover_letter', 'transcript')),
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  extracted_text text,
  parsed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.documents enable row level security;

create policy "Users can view own documents"
  on public.documents
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own documents"
  on public.documents
  for insert
  with check (auth.uid() = user_id);

grant select, insert on public.documents to authenticated;

-- memory_chunks ----------------------------------------------------------

create table public.memory_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  chunk_index integer not null,
  type text not null default 'experience'
    check (type in ('experience', 'skill', 'story', 'preference', 'gap_answer')),
  text text not null,
  embedding extensions.vector(384),
  freshness_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.memory_chunks enable row level security;

create policy "Users can view own memory chunks"
  on public.memory_chunks
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own memory chunks"
  on public.memory_chunks
  for insert
  with check (auth.uid() = user_id);

grant select, insert on public.memory_chunks to authenticated;

create index memory_chunks_user_id_idx on public.memory_chunks (user_id);
create index memory_chunks_document_id_idx on public.memory_chunks (document_id);
create index memory_chunks_embedding_idx on public.memory_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- sensitive_facts (D17, D18) ----------------------------------------------

create table public.sensitive_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('salary', 'notice_period', 'work_authorization', 'location')),
  value text not null,
  source_application_id uuid,
  stated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  confirmed_at timestamp with time zone
);

alter table public.sensitive_facts enable row level security;

create policy "Users can view own sensitive facts"
  on public.sensitive_facts
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own sensitive facts"
  on public.sensitive_facts
  for insert
  with check (auth.uid() = user_id);

grant select, insert on public.sensitive_facts to authenticated;

create index sensitive_facts_user_id_kind_idx on public.sensitive_facts (user_id, kind, stated_at desc);
