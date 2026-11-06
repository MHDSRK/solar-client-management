-- Phase 01 / migration 4: Row Level Security and least-privilege grants.
-- Default Supabase privileges grant broad table access to API roles; reset them first.

revoke all on public.profiles, public.customers, public.customer_details, public.sync_queue
  from public, anon, authenticated;

alter table public.profiles         enable row level security;
alter table public.customers        enable row level security;
alter table public.customer_details enable row level security;
alter table public.activity_logs    enable row level security;
alter table public.sync_queue       enable row level security;

-- ---------------------------------------------------------------- profiles
-- Everyone can read their own row (so an inactive user can see "pending approval");
-- active users can read the team list. Only administrators change roles / status.
grant select on public.profiles to authenticated;
grant update (full_name, role, active) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.current_app_role()) is not null);

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using      ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

-- --------------------------------------------------------------- customers
grant select, insert, update, delete on public.customers        to authenticated;
grant select, insert, update         on public.customer_details to authenticated;

create policy customers_select on public.customers
  for select to authenticated
  using ((select public.current_app_role()) is not null);

create policy customers_insert on public.customers
  for insert to authenticated
  with check ((select public.current_app_role()) is not null);

-- Archived customers are read-only for everyone except administrators.
create policy customers_update on public.customers
  for update to authenticated
  using (
    (select public.current_app_role()) is not null
    and (archived_at is null or (select public.current_app_role()) = 'admin')
  )
  with check ((select public.current_app_role()) is not null);

-- Permanent deletion: administrators only, and only after archiving.
create policy customers_delete on public.customers
  for delete to authenticated
  using ((select public.current_app_role()) = 'admin' and archived_at is not null);

create policy customer_details_select on public.customer_details
  for select to authenticated
  using ((select public.current_app_role()) is not null);

create policy customer_details_insert on public.customer_details
  for insert to authenticated
  with check (
    (select public.current_app_role()) is not null
    and exists (select 1 from public.customers c where c.id = customer_id and c.archived_at is null)
  );

create policy customer_details_update on public.customer_details
  for update to authenticated
  using (
    (select public.current_app_role()) is not null
    and exists (
      select 1 from public.customers c
      where c.id = customer_id
        and (c.archived_at is null or (select public.current_app_role()) = 'admin')
    )
  )
  with check ((select public.current_app_role()) is not null);

-- ------------------------------------------------------ audit log and outbox
-- No insert/update/delete policies exist: rows are written only by SECURITY DEFINER triggers.
create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using ((select public.current_app_role()) in ('admin', 'manager'));

grant select on public.sync_queue to authenticated, service_role;
create policy sync_queue_select on public.sync_queue
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');

-- service_role (server-side only) keeps working access to the business tables.
grant select, insert, update, delete on public.profiles, public.customers, public.customer_details to service_role;

-- Trigger and internal functions are never callable through the API.
revoke all on function public.set_updated_at()                from public, anon, authenticated;
revoke all on function public.handle_new_user()               from public, anon, authenticated;
revoke all on function public.protect_last_admin()            from public, anon, authenticated;
revoke all on function public.customers_guard()               from public, anon, authenticated;
revoke all on function public.log_change()                    from public, anon, authenticated;
revoke all on function public.enqueue_customer_sync()         from public, anon, authenticated;
revoke all on function public.activity_logs_block_mutation()  from public, anon, authenticated;

-- The guard trigger calls nextval() as the invoking user.
revoke all on sequence public.customer_serial_seq from public, anon;
grant usage on sequence public.customer_serial_seq to authenticated, service_role;
