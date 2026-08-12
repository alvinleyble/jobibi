-- S6: Capture — the growth loop (D12, D13, D16)
-- qa_pairs + applications + capture logging scaffold

-- applications: each job application the user works
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company text,
  role_title text,
  site text,
  url text,
  url_hash text,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.applications enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='Users can view own applications') then
    create policy "Users can view own applications"
      on public.applications for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='Users can insert own applications') then
    create policy "Users can insert own applications"
      on public.applications for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='Users can delete own applications') then
    create policy "Users can delete own applications"
      on public.applications for delete using (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, delete on public.applications to authenticated;

create index if not exists applications_user_id_idx on public.applications (user_id, created_at desc);
create index if not exists applications_url_hash_idx on public.applications (url_hash);

-- qa_pairs: every question the user answered — the growth loop (D12/D13)
create table if not exists public.qa_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  question_label text not null,
  question_norm text not null,
  answer_text text not null,
  draft_text text,
  origin text not null check (origin in ('user_written', 'user_edited', 'accepted_verbatim')),
  edit_distance integer not null default 0,
  embedding extensions.vector(384),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.qa_pairs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='qa_pairs' and policyname='Users can view own qa pairs') then
    create policy "Users can view own qa pairs"
      on public.qa_pairs for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='qa_pairs' and policyname='Users can insert own qa pairs') then
    create policy "Users can insert own qa pairs"
      on public.qa_pairs for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='qa_pairs' and policyname='Users can delete own qa pairs') then
    create policy "Users can delete own qa pairs"
      on public.qa_pairs for delete using (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, delete on public.qa_pairs to authenticated;

create index if not exists qa_pairs_user_id_idx on public.qa_pairs (user_id, created_at desc);
create index if not exists qa_pairs_question_norm_idx on public.qa_pairs (user_id, question_norm);
create index if not exists qa_pairs_embedding_idx on public.qa_pairs using hnsw (embedding extensions.vector_cosine_ops);

-- ensure memory_chunks accepts new type for captured answers (extend check)
-- existing types: experience, skill, story, preference, gap_answer
alter table public.memory_chunks drop constraint if exists memory_chunks_type_check;
alter table public.memory_chunks add constraint memory_chunks_type_check
  check (type in ('experience', 'skill', 'story', 'preference', 'gap_answer', 'qa_pair'));

-- capture_mismatches: audit log for D16 re-derive drops
create table if not exists public.capture_mismatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  question_label text not null,
  original_mapping jsonb,
  rederived_mapping jsonb,
  reason text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.capture_mismatches enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='capture_mismatches' and policyname='Users can view own capture mismatches') then
    create policy "Users can view own capture mismatches"
      on public.capture_mismatches for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='capture_mismatches' and policyname='Users can insert own capture mismatches') then
    create policy "Users can insert own capture mismatches"
      on public.capture_mismatches for insert with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert on public.capture_mismatches to authenticated;
