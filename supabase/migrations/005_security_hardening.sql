CREATE OR REPLACE FUNCTION public.is_authorized_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.email(), ''))) = ANY (
    ARRAY[
      'solar.disunenergy@gmail.com',
      'mhdsharookh@gmail.com'
    ]
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_authorized_admin_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_admin_user() TO authenticated;

DO $$
DECLARE
  table_name TEXT;
  policy_record RECORD;
  managed_tables TEXT[] := ARRAY[
    'profiles',
    'customers',
    'customer_details',
    'plants',
    'panel_brands',
    'panel_rates',
    'payments',
    'expenses',
    'document_sections',
    'document_categories',
    'customer_documents',
    'document_files',
    'customer_notes',
    'google_integrations',
    'sync_queue',
    'activity_logs',
    'app_settings',
    'sync_run_log'
  ];
  regular_tables TEXT[] := ARRAY[
    'customers',
    'customer_details',
    'plants',
    'panel_brands',
    'panel_rates',
    'payments',
    'expenses',
    'document_sections',
    'document_categories',
    'customer_documents',
    'document_files',
    'google_integrations',
    'app_settings',
    'sync_queue'
  ];
  append_only_tables TEXT[] := ARRAY['customer_notes', 'activity_logs'];
  delete_tables TEXT[] := ARRAY[
    'customers',
    'document_sections',
    'document_categories',
    'customer_documents',
    'document_files'
  ];
BEGIN
  FOREACH table_name IN ARRAY managed_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    FOR policy_record IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, table_name);
    END LOOP;

    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      table_name
    );
  END LOOP;

  EXECUTE 'CREATE POLICY profiles_select ON public.profiles
    FOR SELECT TO authenticated USING (public.is_authorized_admin_user() AND auth.uid() = id)';
  EXECUTE 'CREATE POLICY profiles_insert ON public.profiles
    FOR INSERT TO authenticated WITH CHECK (public.is_authorized_admin_user() AND auth.uid() = id)';
  EXECUTE 'CREATE POLICY profiles_update ON public.profiles
    FOR UPDATE TO authenticated USING (public.is_authorized_admin_user() AND auth.uid() = id)
    WITH CHECK (public.is_authorized_admin_user() AND auth.uid() = id)';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated';

  FOREACH table_name IN ARRAY regular_tables LOOP
    EXECUTE format(
      'CREATE POLICY admin_select ON public.%I FOR SELECT TO authenticated USING (public.is_authorized_admin_user())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_authorized_admin_user())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING (public.is_authorized_admin_user()) WITH CHECK (public.is_authorized_admin_user())',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO authenticated',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY delete_tables LOOP
    EXECUTE format(
      'CREATE POLICY admin_delete ON public.%I FOR DELETE TO authenticated USING (public.is_authorized_admin_user())',
      table_name
    );
    EXECUTE format(
      'GRANT DELETE ON TABLE public.%I TO authenticated',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY append_only_tables LOOP
    EXECUTE format(
      'CREATE POLICY admin_select ON public.%I FOR SELECT TO authenticated USING (public.is_authorized_admin_user())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_authorized_admin_user())',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT ON TABLE public.%I TO authenticated',
      table_name
    );
  END LOOP;

  EXECUTE 'CREATE POLICY admin_sync_run_log_select ON public.sync_run_log
    FOR SELECT TO authenticated USING (public.is_authorized_admin_user())';
  EXECUTE 'GRANT SELECT ON public.sync_run_log TO authenticated';
END;
$$;

REVOKE UPDATE, DELETE ON TABLE public.activity_logs FROM authenticated;

ALTER VIEW public.customer_financial_summary SET (security_invoker = true);
REVOKE ALL ON TABLE public.customer_financial_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.customer_financial_summary TO authenticated;
