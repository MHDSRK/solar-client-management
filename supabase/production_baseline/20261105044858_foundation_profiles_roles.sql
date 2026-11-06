-- Phase 01 / migration 1: enums, profiles, role helpers, signup bootstrap.
-- Targets a NEW, dedicated Supabase project. Never apply to any other project.

create extension if not exists pg_trgm with schema extensions;

create type public.app_role     as enum ('admin', 'manager', 'staff');
create type public.drive_status as enum ('pending', 'created', 'failed');
create type public.sync_status  as enum ('pending', 'processing', 'done', 'failed', 'dead');

-- Generic updated_at maintenance.
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  role       public.app_role not null default 'staff',
  active     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Role helpers. SECURITY DEFINER so RLS policies can call them without recursion.
-- They return NULL for unknown or inactive users, so "role is not null" means "authorised user".
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.user_id = auth.uid() and p.active
$$;

-- True only for the database's own trusted roles (migrations, service key).
-- Must stay SECURITY INVOKER: current_user has to be the caller's role.
create function public.is_trusted_db_role() returns boolean
language sql stable as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin')
$$;

revoke all on function public.current_app_role()   from public, anon;
revoke all on function public.is_trusted_db_role() from public, anon;
grant execute on function public.current_app_role()   to authenticated, service_role;
grant execute on function public.is_trusted_db_role() to authenticated, service_role;

-- New auth users get an INACTIVE staff profile, except the very first user,
-- who becomes the active administrator. Recommended: also disable open sign-ups
-- in the Supabase Auth settings and invite users instead.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_first boolean;
begin
  perform pg_advisory_xact_lock(7283940);
  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (user_id, full_name, email, role, active)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    new.email,
    case when is_first then 'admin'::public.app_role else 'staff'::public.app_role end,
    is_first
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The system must always keep at least one active administrator.
create function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (
       select 1 from public.profiles p
       where p.role = 'admin' and p.active and p.user_id <> old.user_id
     )
  then
    raise exception 'At least one active administrator is required' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger profiles_protect_last_admin
  before update or delete on public.profiles
  for each row execute function public.protect_last_admin();
