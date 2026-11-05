CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.user_role AS ENUM ('admin', 'manager', 'staff');
CREATE TYPE public.payment_method AS ENUM ('cash', 'bank_transfer', 'upi', 'cheque', 'other');
CREATE TYPE public.payment_status AS ENUM ('pending', 'confirmed', 'void');
CREATE TYPE public.expense_status AS ENUM ('pending', 'confirmed', 'void');
CREATE TYPE public.drive_status AS ENUM ('pending', 'ready', 'error', 'disabled');
CREATE TYPE public.sync_status AS ENUM ('pending', 'processing', 'success', 'failed', 'dead');

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role public.user_role NOT NULL DEFAULT 'staff',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT NOT NULL UNIQUE,
  serial_no TEXT,
  customer_name TEXT NOT NULL,
  contract_date DATE NOT NULL,
  contract_value NUMERIC(14,2) NOT NULL CHECK (contract_value >= 0),
  drive_folder_id TEXT,
  drive_status public.drive_status NOT NULL DEFAULT 'pending',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.customer_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  place TEXT,
  consumer_id TEXT UNIQUE,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.panel_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.panel_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_brand_id UUID NOT NULL REFERENCES public.panel_brands(id) ON DELETE RESTRICT,
  wattage NUMERIC(10,2) NOT NULL CHECK (wattage > 0),
  disun_rate_per_kw NUMERIC(14,2) NOT NULL CHECK (disun_rate_per_kw >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  version_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  UNIQUE (panel_brand_id, wattage, effective_from, version_id)
);

CREATE TABLE IF NOT EXISTS public.plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  panel_brand_id UUID REFERENCES public.panel_brands(id),
  wattage NUMERIC(10,2),
  panel_qty INTEGER NOT NULL CHECK (panel_qty >= 0),
  capacity_kw NUMERIC(12,2) NOT NULL CHECK (capacity_kw >= 0),
  price NUMERIC(14,2) CHECK (price >= 0),
  rate_version_id UUID REFERENCES public.panel_rates(id),
  disun_rate_per_kw_snapshot NUMERIC(14,2),
  disun_cost_snapshot NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  method public.payment_method NOT NULL,
  transaction_reference TEXT,
  notes TEXT,
  receipt_attachment TEXT,
  status public.payment_status NOT NULL DEFAULT 'pending',
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  plant_id UUID REFERENCES public.plants(id) ON DELETE SET NULL,
  expense_date DATE NOT NULL,
  disun_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (disun_cost >= 0),
  kseb NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (kseb >= 0),
  meter_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (meter_cost >= 0),
  structure NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (structure >= 0),
  material NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (material >= 0),
  electrical NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (electrical >= 0),
  paperwork NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paperwork >= 0),
  notes TEXT,
  status public.expense_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  section_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.document_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.document_sections(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.customer_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES public.document_sections(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.document_categories(id) ON DELETE CASCADE,
  document_label TEXT NOT NULL,
  document_type TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.document_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_document_id UUID NOT NULL REFERENCES public.customer_documents(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  storage_provider TEXT NOT NULL DEFAULT 'google_drive',
  drive_file_id TEXT,
  file_url TEXT,
  hash_sha256 TEXT,
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.customer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.google_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'google',
  account_email TEXT,
  oauth_access_token TEXT,
  oauth_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  drive_root_folder_id TEXT,
  spreadsheet_id TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  entity_version BIGINT NOT NULL DEFAULT 1,
  status public.sync_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id),
  entity TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  before_values JSONB,
  after_values JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.generate_customer_code()
RETURNS trigger AS $$
BEGIN
  IF NEW.customer_code IS NULL OR NEW.customer_code = '' THEN
    NEW.customer_code := 'CUST-' || LPAD(CAST(COALESCE((SELECT MAX(CAST(SUBSTRING(customer_code FROM 6) AS integer)) FROM public.customers), 0) + 1 AS TEXT), 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_customer_code
BEFORE INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.generate_customer_code();

CREATE INDEX IF NOT EXISTS idx_customers_customer_code ON public.customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_customers_customer_name ON public.customers(customer_name);
CREATE INDEX IF NOT EXISTS idx_customers_contract_date ON public.customers(contract_date);
CREATE INDEX IF NOT EXISTS idx_plants_customer_id ON public.plants(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_expenses_customer_id ON public.expenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_next_attempt ON public.sync_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_id ON public.activity_logs(entity, entity_id);
