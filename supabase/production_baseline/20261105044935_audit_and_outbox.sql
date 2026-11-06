-- Phase 01 / migration 3: append-only audit log and transactional sync outbox.

-- ---------------------------------------------------------------- audit log
create table public.activity_logs (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,              -- auth.uid(); NULL for service-role / migration activity
  action      text not null check (action in ('insert', 'update', 'delete')),
  entity_type text not null,
  entity_id   text not null,
  before      jsonb,
  after       jsonb,
  reason      text
);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id, occurred_at desc);

-- Append-only: blocked by trigger for every role (including the table owner) ...
create function public.activity_logs_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'activity_logs is append-only' using errcode = '42501';
end $$;

create trigger activity_logs_no_update_delete
  before update or delete on public.activity_logs
  for each row execute function public.activity_logs_block_mutation();
create trigger activity_logs_no_truncate
  before truncate on public.activity_logs
  for each statement execute function public.activity_logs_block_mutation();

-- ... and by privileges for every API-facing role (grants are finalised in migration 4).
revoke all on public.activity_logs from public, anon, authenticated, service_role;
grant select on public.activity_logs to authenticated, service_role;

-- Generic row-change logger. TG_ARGV[0] = entity type, TG_ARGV[1] = key column.
create function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_j  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_j  jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  key_j  jsonb := coalesce(new_j, old_j);
begin
  -- Ignore updates that only touched updated_at.
  if tg_op = 'UPDATE' and (old_j - 'updated_at') = (new_j - 'updated_at') then
    return null;
  end if;

  insert into public.activity_logs (actor_id, action, entity_type, entity_id, before, after, reason)
  values (
    auth.uid(),
    lower(tg_op),
    tg_argv[0],
    key_j ->> tg_argv[1],
    old_j,
    new_j,
    nullif(btrim(coalesce(current_setting('app.change_reason', true), '')), '')
  );
  return null;
end $$;

create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function public.log_change('customer', 'id');
create trigger customer_details_audit
  after insert or update or delete on public.customer_details
  for each row execute function public.log_change('customer_details', 'customer_id');
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.log_change('profile', 'user_id');

-- ------------------------------------------------------------- sync outbox
-- Rows are written by triggers in the SAME transaction as the data change.
-- Phase 05 adds the worker that drains this table into Google Sheets.
create table public.sync_queue (
  id              bigint generated always as identity primary key,
  entity_type     text not null check (entity_type in ('customer')),
  entity_id       uuid not null,
  operation       text not null default 'upsert' check (operation in ('upsert', 'delete')),
  status          public.sync_status not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  processed_at    timestamptz
);

-- At most one waiting job per entity: later changes coalesce into it.
create unique index sync_queue_one_pending_per_entity
  on public.sync_queue (entity_type, entity_id) where status = 'pending';
create index sync_queue_due_idx on public.sync_queue (next_attempt_at) where status in ('pending', 'failed');

create function public.enqueue_customer_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
  op     text := 'upsert';
begin
  if tg_table_name = 'customers' then
    target := case when tg_op = 'DELETE' then old.id else new.id end;
    if tg_op = 'DELETE' then op := 'delete'; end if;
  else
    target := new.customer_id;
  end if;

  insert into public.sync_queue (entity_type, entity_id, operation)
  values ('customer', target, op)
  on conflict (entity_type, entity_id) where status = 'pending'
  do update set
    operation       = case when public.sync_queue.operation = 'delete' then 'delete' else excluded.operation end,
    next_attempt_at = least(public.sync_queue.next_attempt_at, now()),
    updated_at      = now();
  return null;
end $$;

create trigger customers_enqueue_sync
  after insert or update or delete on public.customers
  for each row execute function public.enqueue_customer_sync();
create trigger customer_details_enqueue_sync
  after insert or update on public.customer_details
  for each row execute function public.enqueue_customer_sync();

-- Worker API (service role only).
create function public.claim_sync_jobs(p_limit integer default 50) returns setof public.sync_queue
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.sync_queue q
     set status = 'processing', attempts = q.attempts + 1, updated_at = now()
   where q.id in (
     select s.id from public.sync_queue s
      where (s.status in ('pending', 'failed') and s.next_attempt_at <= now())
         or (s.status = 'processing' and s.updated_at < now() - interval '10 minutes')  -- crashed worker
      order by s.id
      limit greatest(1, least(p_limit, 200))
      for update skip locked
   )
  returning q.*;
end $$;

create function public.complete_sync_job(p_id bigint, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.sync_queue
       set status = 'done', processed_at = now(), last_error = null, updated_at = now()
     where id = p_id;
  else
    update public.sync_queue
       set status = case when attempts >= 8 then 'dead'::public.sync_status else 'failed'::public.sync_status end,
           next_attempt_at = now() + least(interval '1 hour', interval '15 seconds' * power(2, attempts)),
           last_error = left(p_error, 2000),
           updated_at = now()
     where id = p_id;
  end if;
end $$;

revoke all on function public.claim_sync_jobs(integer)             from public, anon, authenticated;
revoke all on function public.complete_sync_job(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_sync_jobs(integer)             to service_role;
grant execute on function public.complete_sync_job(bigint, boolean, text) to service_role;
