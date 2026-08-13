-- S7: extraction-failure telemetry (D16 follower)
-- Record when an adapter (dedicated or generic) fails to extract questions
-- it expected to find, so gaps are visible rather than silent.
-- Mirrors gate_decisions pattern: table + RLS + write-under-caller's-JWT.

create table public.extraction_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  adapter text not null check (adapter in ('jobstreet', 'linkedin', 'indeed', 'generic')),
  host text not null,
  url text,
  url_hash text,
  detected_fields integer not null default 0,
  extracted_questions integer not null default 0,
  failure_reason text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.extraction_failures enable row level security;

create policy "Users can view own extraction failures"
  on public.extraction_failures
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own extraction failures"
  on public.extraction_failures
  for insert
  with check (auth.uid() = user_id);

grant select, insert on public.extraction_failures to authenticated;

create index extraction_failures_user_id_idx on public.extraction_failures (user_id, created_at desc);
create index extraction_failures_adapter_idx on public.extraction_failures (adapter);
create index extraction_failures_host_idx on public.extraction_failures (host);
