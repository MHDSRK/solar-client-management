CREATE OR REPLACE FUNCTION public.prevent_activity_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries are append-only and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activity_log_protect ON public.activity_logs;
CREATE TRIGGER trg_activity_log_protect
BEFORE UPDATE OR DELETE ON public.activity_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_activity_log_mutation();

CREATE OR REPLACE FUNCTION public.enqueue_sync_job(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_entity_version BIGINT DEFAULT 1
)
RETURNS UUID AS $$
DECLARE
  v_job_id UUID;
BEGIN
  INSERT INTO public.sync_queue (entity_type, entity_id, entity_version, status, attempts, next_attempt_at, last_error)
  VALUES (p_entity_type, p_entity_id, p_entity_version, 'pending', 0, NOW(), NULL)
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_plants_updated_at ON public.plants;
CREATE TRIGGER trg_plants_updated_at
BEFORE UPDATE ON public.plants
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_sync_queue_updated_at ON public.sync_queue;
CREATE TRIGGER trg_sync_queue_updated_at
BEFORE UPDATE ON public.sync_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sync_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  jobs_total INTEGER NOT NULL DEFAULT 0,
  jobs_processed INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON public.sync_queue(entity_type, entity_id, entity_version);
