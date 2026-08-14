-- S9: Style profile v1 (D13, D15)
-- Voice corpus = qa_pairs(user_written/user_edited) + documents(user_written/user_edited) + gap_answers
-- style_profile: one row per user, distilled voice guide rebuilt every 10 new qualifying items.
-- Trigger uses delta-since-last-rebuild (corpus_size), skip-if-in-flight, silent-fail-and-retry-next-cycle (D19).

create table if not exists public.style_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile_md text,
  generated_at timestamp with time zone,
  corpus_size integer not null default 0,
  -- in-flight signal: when a rebuild is running, set rebuilding=true + batch job tracking
  rebuilding boolean not null default false,
  rebuilding_started_at timestamp with time zone,
  batch_job_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.style_profile enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='style_profile' and policyname='Users can view own style profile') then
    create policy "Users can view own style profile"
      on public.style_profile for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='style_profile' and policyname='Users can insert own style profile') then
    create policy "Users can insert own style profile"
      on public.style_profile for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='style_profile' and policyname='Users can update own style profile') then
    create policy "Users can update own style profile"
      on public.style_profile for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='style_profile' and policyname='Users can delete own style profile') then
    create policy "Users can delete own style profile"
      on public.style_profile for delete using (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update, delete on public.style_profile to authenticated;

-- updated_at trigger
create or replace function public.handle_style_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists style_profile_updated_at on public.style_profile;
create trigger style_profile_updated_at
  before update on public.style_profile
  for each row execute function public.handle_style_profile_updated_at();

comment on table public.style_profile is 'S9 voice distillation: one distilled profile per user, rebuilt every 10 qualifying items (D13-filtered).';
comment on column public.style_profile.profile_md is 'Bulleted observations about how the user writes (sentence length, formality, habits). Not career facts.';
comment on column public.style_profile.corpus_size is 'Qualifying voice-corpus count at last successful rebuild; trigger fires when current_count - corpus_size >= 10.';
comment on column public.style_profile.rebuilding is 'In-flight marker: true while a batch distillation job is running; skip-if-in-flight check reads this.';
comment on column public.style_profile.batch_job_id is 'OpenAI batch job id for the in-flight distillation, if any.';
