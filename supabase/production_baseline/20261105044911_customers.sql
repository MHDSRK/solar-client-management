-- Phase 01 / migration 2: customers, customer details, guards, indexes.

create sequence public.customer_serial_seq;

create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  serial_no      integer not null unique,
  customer_code  text    not null unique,
  name           text    not null check (length(btrim(name)) > 0),
  contract_date  date    not null default current_date,
  contract_value numeric(14, 2) not null default 0 check (contract_value >= 0),
  drive_folder_id text,
  drive_status   public.drive_status not null default 'pending',
  archived_at    timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.customer_details (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  place       text,
  consumer_id text,
  phone       text,
  email       text,
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint customer_details_consumer_id_not_blank check (consumer_id is null or btrim(consumer_id) <> ''),
  constraint customer_details_email_format check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint customer_details_phone_format check (phone is null or phone ~ '^[+]?[0-9 ()-]{7,20}$')
);

-- One consumer ID per customer record, ever (archived customers included).
create unique index customer_details_consumer_id_key
  on public.customer_details (consumer_id) where consumer_id is not null;

create index customers_name_trgm       on public.customers        using gin (name         extensions.gin_trgm_ops);
create index customer_details_phone_trgm on public.customer_details using gin (phone        extensions.gin_trgm_ops);
create index customer_details_cid_trgm   on public.customer_details using gin (consumer_id   extensions.gin_trgm_ops);
create index customers_contract_date_idx on public.customers (contract_date);
create index customers_active_idx        on public.customers (archived_at) where archived_at is null;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();
create trigger customer_details_set_updated_at
  before update on public.customer_details
  for each row execute function public.set_updated_at();

-- Server-side guard. SECURITY INVOKER on purpose (see is_trusted_db_role).
--  * customer id / serial / code are generated here; client-supplied values are ignored
--  * identity columns are immutable
--  * contract value: set at creation only by manager/admin; changed only by manager/admin
--    and only with a reason (transaction setting app.change_reason, see set_contract_value())
--  * archiving is admin-only
create function public.customers_guard() returns trigger
language plpgsql as $$
declare
  can_edit_value boolean := public.is_trusted_db_role()
                            or public.current_app_role() in ('admin', 'manager');
begin
  if tg_op = 'INSERT' then
    -- Reject unauthorized inserts BEFORE consuming a serial number, so they cannot burn customer codes.
    if not public.is_trusted_db_role() and public.current_app_role() is null then
      raise exception 'No active profile' using errcode = '42501';
    end if;
    if new.contract_value <> 0 and not can_edit_value then
      raise exception 'Only managers and admins can set a contract value' using errcode = '42501';
    end if;
    new.serial_no     := nextval('public.customer_serial_seq');
    new.customer_code := 'CUST-' || lpad(new.serial_no::text, 4, '0');
    new.created_by    := auth.uid();
    new.archived_at   := null;
    return new;
  end if;

  -- UPDATE
  if new.id            is distinct from old.id
     or new.serial_no     is distinct from old.serial_no
     or new.customer_code is distinct from old.customer_code
     or new.created_by    is distinct from old.created_by
     or new.created_at    is distinct from old.created_at then
    raise exception 'Customer identity fields cannot be changed' using errcode = '42501';
  end if;

  if new.contract_value is distinct from old.contract_value then
    if not can_edit_value then
      raise exception 'Only managers and admins can change the contract value' using errcode = '42501';
    end if;
    if nullif(btrim(coalesce(current_setting('app.change_reason', true), '')), '') is null then
      raise exception 'A reason is required to change the contract value' using errcode = '23514';
    end if;
  end if;

  if new.archived_at is distinct from old.archived_at
     and not (public.is_trusted_db_role() or public.current_app_role() = 'admin') then
    raise exception 'Only administrators can archive or restore customers' using errcode = '42501';
  end if;

  return new;
end $$;

create trigger customers_guard_trg
  before insert or update on public.customers
  for each row execute function public.customers_guard();
