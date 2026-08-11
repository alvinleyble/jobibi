-- S5a: gate_decisions telemetry (D15)
-- Every gate decision records both axes, outcome, and what user did next
-- for calibration. RLS-scoped like all memory tables.

create table public.gate_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid,
  question_norm text not null,
  question_match double precision not null,
  role_match double precision not null,
  outcome text not null check (outcome in ('draft', 'ask', 'refuse')),
  user_action text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.gate_decisions enable row level security;

create policy "Users can view own gate decisions"
  on public.gate_decisions
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own gate decisions"
  on public.gate_decisions
  for insert
  with check (auth.uid() = user_id);

grant select, insert on public.gate_decisions to authenticated;

create index gate_decisions_user_id_idx on public.gate_decisions (user_id, created_at desc);
create index gate_decisions_outcome_idx on public.gate_decisions (outcome);
