-- S12: Privacy Surface, Beta Caps & Settings (D3, D8, D12, D17)
-- Adds output_length preference to profiles, ensures RLS update/delete policies across all user tables
-- for per-answer deletion and clean account wiping (D12).

-- 1. profiles: add output_length column (default 'short')
alter table public.profiles
  add column if not exists output_length text not null default 'short'
  check (output_length in ('short', 'medium', 'long'));

-- 2. Delete policies across user-owned tables for D12 privacy surface & account wiping
-- memory_chunks
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='memory_chunks' and policyname='Users can delete own memory chunks') then
    create policy "Users can delete own memory chunks"
      on public.memory_chunks for delete using (auth.uid() = user_id);
  end if;
end $$;
grant delete on public.memory_chunks to authenticated;

-- sensitive_facts
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sensitive_facts' and policyname='Users can delete own sensitive facts') then
    create policy "Users can delete own sensitive facts"
      on public.sensitive_facts for delete using (auth.uid() = user_id);
  end if;
end $$;
grant delete on public.sensitive_facts to authenticated;

-- gate_decisions
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='gate_decisions' and policyname='Users can delete own gate decisions') then
    create policy "Users can delete own gate decisions"
      on public.gate_decisions for delete using (auth.uid() = user_id);
  end if;
end $$;
grant delete on public.gate_decisions to authenticated;

-- capture_mismatches
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='capture_mismatches' and policyname='Users can delete own capture mismatches') then
    create policy "Users can delete own capture mismatches"
      on public.capture_mismatches for delete using (auth.uid() = user_id);
  end if;
end $$;
grant delete on public.capture_mismatches to authenticated;

-- extraction_failures
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='extraction_failures' and policyname='Users can delete own extraction failures') then
    create policy "Users can delete own extraction failures"
      on public.extraction_failures for delete using (auth.uid() = user_id);
  end if;
end $$;
grant delete on public.extraction_failures to authenticated;

-- profiles delete policy
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='Users can delete own profile') then
    create policy "Users can delete own profile"
      on public.profiles for delete using (auth.uid() = id);
  end if;
end $$;
grant delete on public.profiles to authenticated;
