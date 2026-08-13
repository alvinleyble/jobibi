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
  type_attnum smallint;
begin
  -- find whichever check constraint currently guards memory_chunks.type, by
  -- matching on the constrained column itself (via conkey) rather than the
  -- rendered constraint text, since Postgres canonicalizes `IN (...)` to
  -- `= ANY (ARRAY[...])` and a text match on 'in' would never fire.
  select attnum into type_attnum
  from pg_attribute
  where attrelid = 'public.memory_chunks'::regclass
    and attname = 'type'
    and not attisdropped;

  for cname in
    select conname
    from pg_constraint
    where conrelid = 'public.memory_chunks'::regclass
      and contype = 'c'
      and conkey = array[type_attnum]
  loop
    execute format('alter table public.memory_chunks drop constraint %I', cname);
  end loop;
end $$;

-- also handle the named variant explicitly for idempotency when pg_constraint lookup misses
alter table public.memory_chunks drop constraint if exists memory_chunks_type_check;

alter table public.memory_chunks
  add constraint memory_chunks_type_check
  check (type in ('experience', 'skill', 'story', 'preference', 'gap_answer', 'qa_pair'));
