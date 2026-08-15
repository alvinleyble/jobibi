-- Cover letter attempts tracking for daily preview limit (5/day UTC)
-- Prevents loophole where free users generate infinite previews without accepting.

create table if not exists public.cover_letter_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.cover_letter_attempts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='cover_letter_attempts' and policyname='Users can view own cover letter attempts') then
    create policy "Users can view own cover letter attempts"
      on public.cover_letter_attempts for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='cover_letter_attempts' and policyname='Users can insert own cover letter attempts') then
    create policy "Users can insert own cover letter attempts"
      on public.cover_letter_attempts for insert with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert on public.cover_letter_attempts to authenticated;

create index if not exists cover_letter_attempts_user_created_idx
  on public.cover_letter_attempts (user_id, created_at desc);
