-- Reference-only copy of production migration 20261106142827.
-- SQL was supplied from the live migration ledger; it has not been independently re-fetched.
-- Do not place in supabase/migrations or apply it to production.

-- Phase 01 / migration 6: pin search_path on invoker-rights functions (Supabase advisor lint 0011).
-- All object references inside these functions are already schema-qualified.
alter function public.set_updated_at()                  set search_path = '';
alter function public.is_trusted_db_role()              set search_path = '';
alter function public.customers_guard()                 set search_path = '';
alter function public.activity_logs_block_mutation()    set search_path = '';
alter function public.create_customer(text, date, numeric, text, text, text, text, text)
  set search_path = '';
alter function public.set_contract_value(uuid, numeric, text)
  set search_path = '';
alter function public.search_customers(text, boolean, text, text, integer, integer)
  set search_path = '';
