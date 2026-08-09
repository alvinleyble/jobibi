alter table public.profiles
  drop constraint profiles_id_fkey,
  add constraint profiles_id_fkey
    foreign key (id) references auth.users (id) on delete cascade;
