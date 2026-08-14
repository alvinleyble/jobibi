alter table public.profiles
  add column if not exists is_beta_tester boolean not null default false;

-- Update trigger function to prevent users from modifying is_beta_tester directly
create or replace function public.prevent_tier_self_update()
returns trigger as $$
begin
  if new.tier is distinct from old.tier and auth.role() <> 'service_role' then
    raise exception 'tier cannot be changed by the user';
  end if;
  if new.is_beta_tester is distinct from old.is_beta_tester and auth.role() <> 'service_role' then
    raise exception 'is_beta_tester cannot be changed by the user';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
