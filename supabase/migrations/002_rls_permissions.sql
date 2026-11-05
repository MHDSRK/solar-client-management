CREATE OR REPLACE FUNCTION public.is_authorized_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(trim(COALESCE(auth.email(), ''))) = ANY (
    ARRAY[
      'solar.disunenergy@gmail.com',
      'mhdsharookh@gmail.com'
    ]
  );
$$;

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
FOR SELECT USING (public.is_authorized_admin_user() AND auth.uid() = id);

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
FOR INSERT WITH CHECK (public.is_authorized_admin_user() AND auth.uid() = id);

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
FOR UPDATE USING (public.is_authorized_admin_user() AND auth.uid() = id);

DROP POLICY IF EXISTS customers_read ON public.customers;
CREATE POLICY customers_read ON public.customers
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS customers_write ON public.customers;
CREATE POLICY customers_write ON public.customers
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS customers_modify ON public.customers;
CREATE POLICY customers_modify ON public.customers
FOR UPDATE USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS customers_delete ON public.customers;
CREATE POLICY customers_delete ON public.customers
FOR DELETE USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS customer_details_read ON public.customer_details;
CREATE POLICY customer_details_read ON public.customer_details
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS customer_details_write ON public.customer_details;
CREATE POLICY customer_details_write ON public.customer_details
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS customer_details_modify ON public.customer_details;
CREATE POLICY customer_details_modify ON public.customer_details
FOR UPDATE USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS plants_read ON public.plants;
CREATE POLICY plants_read ON public.plants
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS plants_write ON public.plants;
CREATE POLICY plants_write ON public.plants
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS plants_modify ON public.plants;
CREATE POLICY plants_modify ON public.plants
FOR UPDATE USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS payments_read ON public.payments;
CREATE POLICY payments_read ON public.payments
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS payments_write ON public.payments;
CREATE POLICY payments_write ON public.payments
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS payments_modify ON public.payments;
CREATE POLICY payments_modify ON public.payments
FOR UPDATE USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS expenses_read ON public.expenses;
CREATE POLICY expenses_read ON public.expenses
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS expenses_write ON public.expenses;
CREATE POLICY expenses_write ON public.expenses
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS expenses_modify ON public.expenses;
CREATE POLICY expenses_modify ON public.expenses
FOR UPDATE USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS settings_read ON public.app_settings;
CREATE POLICY settings_read ON public.app_settings
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS settings_write ON public.app_settings;
CREATE POLICY settings_write ON public.app_settings
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS settings_modify ON public.app_settings;
CREATE POLICY settings_modify ON public.app_settings
FOR UPDATE USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS activity_logs_read ON public.activity_logs;
CREATE POLICY activity_logs_read ON public.activity_logs
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS activity_logs_append ON public.activity_logs;
CREATE POLICY activity_logs_append ON public.activity_logs
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS sync_queue_read ON public.sync_queue;
CREATE POLICY sync_queue_read ON public.sync_queue
FOR SELECT USING (public.is_authorized_admin_user());

DROP POLICY IF EXISTS sync_queue_write ON public.sync_queue;
CREATE POLICY sync_queue_write ON public.sync_queue
FOR INSERT WITH CHECK (public.is_authorized_admin_user());

DROP POLICY IF EXISTS sync_queue_modify ON public.sync_queue;
CREATE POLICY sync_queue_modify ON public.sync_queue
FOR UPDATE USING (public.is_authorized_admin_user());

REVOKE ALL ON TABLE public.activity_logs FROM PUBLIC;
REVOKE ALL ON TABLE public.customers FROM PUBLIC;
REVOKE ALL ON TABLE public.customer_details FROM PUBLIC;
REVOKE ALL ON TABLE public.plants FROM PUBLIC;
REVOKE ALL ON TABLE public.payments FROM PUBLIC;
REVOKE ALL ON TABLE public.expenses FROM PUBLIC;
REVOKE ALL ON TABLE public.app_settings FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_details TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sync_queue TO authenticated;
