drop policy "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create function public.prevent_tier_self_update()
returns trigger as $$
begin
  if new.tier is distinct from old.tier and auth.role() <> 'service_role' then
    raise exception 'tier cannot be changed by the user';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger profiles_protect_tier
  before update on public.profiles
  for each row execute procedure public.prevent_tier_self_update();
