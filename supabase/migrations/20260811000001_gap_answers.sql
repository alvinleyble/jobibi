-- S5b: gap_answers for the ask path (D10)
-- Stores answers to Jobibi's gap questions, separate from qa_pairs.
-- Each answer is also chunked into memory_chunks (type gap_answer) for retrieval.

create table public.gap_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_asked text not null,
  answer_text text not null,
  anchored_chunk_id uuid references public.memory_chunks (id) on delete set null,
  original_question_norm text,
  application_id uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.gap_answers enable row level security;

create policy "Users can view own gap answers"
  on public.gap_answers
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own gap answers"
  on public.gap_answers
  for insert
  with check (auth.uid() = user_id);

grant select, insert on public.gap_answers to authenticated;

create index gap_answers_user_id_idx on public.gap_answers (user_id, created_at desc);
create index gap_answers_anchored_chunk_idx on public.gap_answers (anchored_chunk_id);

-- Allow authenticated to delete own (for D12 per-answer delete parity; optional but consistent)
create policy "Users can delete own gap answers"
  on public.gap_answers
  for delete
  using (auth.uid() = user_id);

grant delete on public.gap_answers to authenticated;
