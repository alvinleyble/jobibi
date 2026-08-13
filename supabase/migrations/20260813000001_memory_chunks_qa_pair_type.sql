-- Fix S7A live bug: memory_chunks.type check rejected 'qa_pair' (2026-08-13)
-- Both capture (S6) and manual-input (S7A) insert type='qa_pair' for retrieval,
-- but the original check in 20260810001000 only allowed
-- ('experience','skill','story','preference','gap_answer').
-- 20260812000000 attempted to extend it, but use a robust drop that handles
-- any auto-named constraint variant (inline CHECK without explicit name).
-- This migration is idempotent: safe to run even if qa_pair already present.

do $$
declare
  cname text;
begin
  -- find whichever check constraint currently guards memory_chunks.type
  select conname into cname
  from pg_constraint
  where conrelid = 'public.memory_chunks'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type%in%';

  if cname is not null then
    execute format('alter table public.memory_chunks drop constraint %I', cname);
  end if;
end $$;

-- also handle the named variant explicitly for idempotency when pg_constraint lookup misses
alter table public.memory_chunks drop constraint if exists memory_chunks_type_check;

alter table public.memory_chunks
  add constraint memory_chunks_type_check
  check (type in ('experience', 'skill', 'story', 'preference', 'gap_answer', 'qa_pair'));
