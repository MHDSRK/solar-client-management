-- Phase 01 / migration 5: customer RPCs.
-- All three are SECURITY INVOKER: row-level security and the guard triggers apply to the caller.

-- Atomic customer + details creation. Code and serial number come from the guard trigger.
create function public.create_customer(
  p_name           text,
  p_contract_date  date    default current_date,
  p_contract_value numeric default 0,
  p_place          text    default null,
  p_phone          text    default null,
  p_email          text    default null,
  p_consumer_id    text    default null,
  p_address        text    default null
) returns public.customers
language plpgsql as $$
declare
  v public.customers;
begin
  insert into public.customers (name, contract_date, contract_value)
  values (btrim(p_name), coalesce(p_contract_date, current_date), coalesce(p_contract_value, 0))
  returning * into v;

  insert into public.customer_details (customer_id, place, phone, email, consumer_id, address)
  values (
    v.id,
    nullif(btrim(p_place), ''),
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_email), ''),
    nullif(btrim(p_consumer_id), ''),
    nullif(btrim(p_address), '')
  );
  return v;
end $$;

-- The only supported way to change a contract value: requires a reason, which is audit-logged.
create function public.set_contract_value(p_customer_id uuid, p_value numeric, p_reason text)
returns public.customers
language plpgsql as $$
declare
  v public.customers;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required to change the contract value' using errcode = '23514';
  end if;
  perform set_config('app.change_reason', btrim(p_reason), true);

  update public.customers set contract_value = p_value where id = p_customer_id returning * into v;
  if not found then
    raise exception 'Customer not found or not accessible' using errcode = 'P0002';
  end if;
  return v;
end $$;

-- Server-side search, sort and pagination for the customer list.
create function public.search_customers(
  p_search           text    default null,
  p_include_archived boolean default false,
  p_sort             text    default 'created_at',
  p_dir              text    default 'desc',
  p_limit            integer default 25,
  p_offset           integer default 0
) returns table (
  id uuid, customer_code text, serial_no integer, name text, place text, phone text,
  consumer_id text, contract_date date, contract_value numeric, drive_status public.drive_status,
  archived_at timestamptz, created_at timestamptz, total_count bigint
)
language sql stable as $$
  with s as (
    select nullif(btrim(coalesce(p_search, '')), '') as term
  ), pat as (
    select case when term is null then null
           else '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' end as p
    from s
  )
  select c.id, c.customer_code, c.serial_no, c.name, d.place, d.phone, d.consumer_id,
         c.contract_date, c.contract_value, c.drive_status, c.archived_at, c.created_at,
         count(*) over () as total_count
  from public.customers c
  left join public.customer_details d on d.customer_id = c.id
  cross join pat
  where (p_include_archived or c.archived_at is null)
    and (pat.p is null
         or c.name          ilike pat.p
         or c.customer_code ilike pat.p
         or d.phone         ilike pat.p
         or d.consumer_id   ilike pat.p)
  order by
    case when p_sort = 'name'           and p_dir = 'asc'  then c.name end asc,
    case when p_sort = 'name'           and p_dir = 'desc' then c.name end desc,
    case when p_sort = 'contract_date'  and p_dir = 'asc'  then c.contract_date end asc,
    case when p_sort = 'contract_date'  and p_dir = 'desc' then c.contract_date end desc,
    case when p_sort = 'contract_value' and p_dir = 'asc'  then c.contract_value end asc,
    case when p_sort = 'contract_value' and p_dir = 'desc' then c.contract_value end desc,
    case when p_sort = 'created_at'     and p_dir = 'asc'  then c.created_at end asc,
    case when p_sort = 'created_at'     and p_dir = 'desc' then c.created_at end desc,
    c.serial_no desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0))
$$;

revoke all on function public.create_customer(text, date, numeric, text, text, text, text, text) from public, anon;
revoke all on function public.set_contract_value(uuid, numeric, text)                              from public, anon;
revoke all on function public.search_customers(text, boolean, text, text, integer, integer)       from public, anon;
grant execute on function public.create_customer(text, date, numeric, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.set_contract_value(uuid, numeric, text)                              to authenticated, service_role;
grant execute on function public.search_customers(text, boolean, text, text, integer, integer)       to authenticated, service_role;
