ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.panel_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.panel_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
FOR SELECT USING (auth.uid() = id OR auth.role() = 'authenticated');

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS customers_read ON public.customers;
CREATE POLICY customers_read ON public.customers
FOR SELECT USING (true);

DROP POLICY IF EXISTS customers_write ON public.customers;
CREATE POLICY customers_write ON public.customers
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS customers_modify ON public.customers;
CREATE POLICY customers_modify ON public.customers
FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS customers_delete ON public.customers;
CREATE POLICY customers_delete ON public.customers
FOR DELETE USING (auth.role() = 'authenticated' AND false);

DROP POLICY IF EXISTS activity_logs_read ON public.activity_logs;
CREATE POLICY activity_logs_read ON public.activity_logs
FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS activity_logs_append ON public.activity_logs;
CREATE POLICY activity_logs_append ON public.activity_logs
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

REVOKE UPDATE, DELETE ON TABLE public.activity_logs FROM PUBLIC;
REVOKE UPDATE, DELETE ON TABLE public.activity_logs FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.activity_logs FROM authenticated;

GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT SELECT, INSERT ON public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_details TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
