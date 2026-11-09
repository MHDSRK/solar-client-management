-- Review-only draft for the live PostgreSQL 17 schema.
-- Do not apply until the repository migration history has been reconciled.

CREATE OR REPLACE FUNCTION public.is_authorized_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    auth.uid() = ANY (
      ARRAY[
        '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid,
        'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
      ]
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.active
        AND p.role = 'admin'::public.app_role
    );
$function$;

ALTER FUNCTION public.is_authorized_admin_user() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_authorized_admin_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_admin_user()
  TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE user_id = NEW.id
    AND email IS DISTINCT FROM NEW.email;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.sync_profile_email_from_auth_user() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.sync_profile_email_from_auth_user()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_profile_email_from_auth_user() TO postgres;

DROP TRIGGER IF EXISTS auth_users_sync_profile_email ON auth.users;
CREATE TRIGGER auth_users_sync_profile_email
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_from_auth_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.id <> ALL (
    ARRAY[
      '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid,
      'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
    ]::uuid[]
  ) THEN
    RAISE EXCEPTION 'This account is not authorized for the Solar Client Management portal.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(7283940);

  INSERT INTO public.profiles (user_id, full_name, email, role, active)
  VALUES (
    NEW.id,
    NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NEW.email,
    'admin'::public.app_role,
    true
  )
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      email = EXCLUDED.email,
      role = 'admin'::public.app_role,
      active = true,
      updated_at = pg_catalog.now()
  WHERE public.profiles.full_name IS DISTINCT FROM EXCLUDED.full_name
    OR public.profiles.email IS DISTINCT FROM EXCLUDED.email
    OR public.profiles.role IS DISTINCT FROM EXCLUDED.role
    OR public.profiles.active IS DISTINCT FROM EXCLUDED.active;

  UPDATE public.profiles
  SET role = 'staff'::public.app_role,
      active = false
  WHERE user_id <> ALL (
      ARRAY[
        '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid,
        'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
      ]::uuid[]
    )
    AND (role <> 'staff'::public.app_role OR active)
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.role = 'admin'::public.app_role
        AND p.active
        AND p.user_id = ANY (
          ARRAY[
            '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid,
            'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
          ]::uuid[]
        )
    );

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.customers_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  can_edit_value boolean :=
    auth.role() = 'service_role'
    OR public.is_authorized_admin_user();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND NOT public.is_authorized_admin_user() THEN
    RAISE EXCEPTION 'This account is not authorized to modify customers'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.contract_value <> 0 AND NOT can_edit_value THEN
      RAISE EXCEPTION 'Only authorized administrators can set a contract value'
        USING ERRCODE = '42501';
    END IF;

    NEW.serial_no := pg_catalog.nextval('public.customer_serial_seq')::integer;
    NEW.customer_code := 'CUST-' || pg_catalog.lpad(NEW.serial_no::text, 4, '0');
    NEW.created_by := auth.uid();
    NEW.archived_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.serial_no IS DISTINCT FROM OLD.serial_no
    OR NEW.customer_code IS DISTINCT FROM OLD.customer_code
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Customer identity fields cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.contract_value IS DISTINCT FROM OLD.contract_value THEN
    IF NOT can_edit_value THEN
      RAISE EXCEPTION 'Only authorized administrators can change the contract value'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(
      pg_catalog.btrim(COALESCE(pg_catalog.current_setting('app.change_reason', true), '')),
      ''
    ) IS NULL THEN
      RAISE EXCEPTION 'A reason is required to change the contract value'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
    AND NOT can_edit_value THEN
    RAISE EXCEPTION 'Only authorized administrators can archive or restore customers'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.customers_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.customers_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customers_guard() TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.create_customer(
  p_name text,
  p_contract_date date DEFAULT CURRENT_DATE,
  p_contract_value numeric DEFAULT 0,
  p_place text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_consumer_id text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
)
RETURNS public.customers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v public.customers;
BEGIN
  INSERT INTO public.customers (name, contract_date, contract_value)
  VALUES (
    pg_catalog.btrim(p_name),
    COALESCE(p_contract_date, CURRENT_DATE),
    COALESCE(p_contract_value, 0)
  )
  RETURNING * INTO v;

  INSERT INTO public.customer_details (customer_id, place, phone, email, consumer_id, address)
  VALUES (
    v.id,
    NULLIF(pg_catalog.btrim(p_place), ''),
    NULLIF(pg_catalog.btrim(p_phone), ''),
    NULLIF(pg_catalog.btrim(p_email), ''),
    NULLIF(pg_catalog.btrim(p_consumer_id), ''),
    NULLIF(pg_catalog.btrim(p_address), '')
  );

  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_customers(
  p_search text DEFAULT NULL::text,
  p_include_archived boolean DEFAULT false,
  p_sort text DEFAULT 'created_at'::text,
  p_dir text DEFAULT 'desc'::text,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  customer_code text,
  serial_no integer,
  name text,
  place text,
  phone text,
  consumer_id text,
  contract_date date,
  contract_value numeric,
  drive_status public.drive_status,
  archived_at timestamp with time zone,
  created_at timestamp with time zone,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH s AS (
    SELECT NULLIF(pg_catalog.btrim(COALESCE(p_search, '')), '') AS term
  ),
  pat AS (
    SELECT CASE
      WHEN term IS NULL THEN NULL
      ELSE '%' || replace(replace(replace(term, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
    END AS p
    FROM s
  )
  SELECT
    c.id,
    c.customer_code,
    c.serial_no,
    c.name,
    d.place,
    d.phone,
    d.consumer_id,
    c.contract_date,
    c.contract_value,
    c.drive_status,
    c.archived_at,
    c.created_at,
    count(*) OVER () AS total_count
  FROM public.customers c
  LEFT JOIN public.customer_details d ON d.customer_id = c.id
  CROSS JOIN pat
  WHERE (p_include_archived OR c.archived_at IS NULL)
    AND (
      pat.p IS NULL
      OR c.name ILIKE pat.p
      OR c.customer_code ILIKE pat.p
      OR d.phone ILIKE pat.p
      OR d.consumer_id ILIKE pat.p
    )
  ORDER BY
    CASE WHEN p_sort = 'name' AND p_dir = 'asc' THEN c.name END ASC,
    CASE WHEN p_sort = 'name' AND p_dir = 'desc' THEN c.name END DESC,
    CASE WHEN p_sort = 'contract_date' AND p_dir = 'asc' THEN c.contract_date END ASC,
    CASE WHEN p_sort = 'contract_date' AND p_dir = 'desc' THEN c.contract_date END DESC,
    CASE WHEN p_sort = 'contract_value' AND p_dir = 'asc' THEN c.contract_value END ASC,
    CASE WHEN p_sort = 'contract_value' AND p_dir = 'desc' THEN c.contract_value END DESC,
    CASE WHEN p_sort = 'created_at' AND p_dir = 'asc' THEN c.created_at END ASC,
    CASE WHEN p_sort = 'created_at' AND p_dir = 'desc' THEN c.created_at END DESC,
    c.serial_no DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
  OFFSET GREATEST(0, COALESCE(p_offset, 0))
$function$;

CREATE OR REPLACE FUNCTION public.set_contract_value(
  p_customer_id uuid,
  p_value numeric,
  p_reason text
)
RETURNS public.customers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v public.customers;
BEGIN
  IF NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to change the contract value'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.set_config('app.change_reason', pg_catalog.btrim(p_reason), true);

  UPDATE public.customers
  SET contract_value = p_value
  WHERE id = p_customer_id
  RETURNING * INTO v;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found or not accessible' USING ERRCODE = 'P0002';
  END IF;

  RETURN v;
END;
$function$;

ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.is_trusted_db_role() SET search_path = '';
ALTER FUNCTION public.activity_logs_block_mutation() SET search_path = '';
ALTER FUNCTION public.enqueue_customer_sync() SET search_path = '';
ALTER FUNCTION public.log_change() SET search_path = '';
ALTER FUNCTION public.protect_last_admin() SET search_path = '';
ALTER FUNCTION public.current_app_role() SET search_path = '';

INSERT INTO public.profiles (user_id, full_name, email, role, active)
SELECT
  u.id,
  NULLIF(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  u.email,
  'admin'::public.app_role,
  true
FROM auth.users u
WHERE u.id = ANY (
  ARRAY[
    '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid,
    'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
  ]::uuid[]
)
ON CONFLICT (user_id) DO UPDATE
SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    email = EXCLUDED.email,
    role = 'admin'::public.app_role,
    active = true,
    updated_at = pg_catalog.now()
WHERE public.profiles.full_name IS DISTINCT FROM EXCLUDED.full_name
  OR public.profiles.email IS DISTINCT FROM EXCLUDED.email
  OR public.profiles.role IS DISTINCT FROM EXCLUDED.role
  OR public.profiles.active IS DISTINCT FROM EXCLUDED.active;

UPDATE public.profiles
SET role = 'staff'::public.app_role,
    active = false
WHERE user_id <> ALL (
    ARRAY[
      '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid,
      'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
    ]::uuid[]
  )
  AND (role <> 'staff'::public.app_role OR active)
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.role = 'admin'::public.app_role
      AND p.active
      AND p.user_id = ANY (
        ARRAY[
          '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid,
          'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
        ]::uuid[]
      )
  );

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
DROP POLICY IF EXISTS customers_select ON public.customers;
DROP POLICY IF EXISTS customers_insert ON public.customers;
DROP POLICY IF EXISTS customers_update ON public.customers;
DROP POLICY IF EXISTS customers_delete ON public.customers;
DROP POLICY IF EXISTS customer_details_select ON public.customer_details;
DROP POLICY IF EXISTS customer_details_insert ON public.customer_details;
DROP POLICY IF EXISTS customer_details_update ON public.customer_details;
DROP POLICY IF EXISTS activity_logs_select ON public.activity_logs;
DROP POLICY IF EXISTS sync_queue_select ON public.sync_queue;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_authorized_admin_user());
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_authorized_admin_user())
  WITH CHECK (public.is_authorized_admin_user());

CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (public.is_authorized_admin_user());
CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_authorized_admin_user());
CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated
  USING (public.is_authorized_admin_user())
  WITH CHECK (public.is_authorized_admin_user());
CREATE POLICY customers_delete ON public.customers
  FOR DELETE TO authenticated
  USING (public.is_authorized_admin_user() AND archived_at IS NOT NULL);

CREATE POLICY customer_details_select ON public.customer_details
  FOR SELECT TO authenticated
  USING (public.is_authorized_admin_user());
CREATE POLICY customer_details_insert ON public.customer_details
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_authorized_admin_user()
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_details.customer_id
        AND c.archived_at IS NULL
    )
  );
CREATE POLICY customer_details_update ON public.customer_details
  FOR UPDATE TO authenticated
  USING (public.is_authorized_admin_user())
  WITH CHECK (public.is_authorized_admin_user());

CREATE POLICY activity_logs_select ON public.activity_logs
  FOR SELECT TO authenticated
  USING (public.is_authorized_admin_user());
CREATE POLICY sync_queue_select ON public.sync_queue
  FOR SELECT TO authenticated
  USING (public.is_authorized_admin_user());

REVOKE ALL ON TABLE public.profiles, public.customers, public.customer_details,
  public.activity_logs, public.sync_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, role, active) ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_details TO authenticated;
GRANT SELECT ON TABLE public.activity_logs, public.sync_queue TO authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE
  public.activity_logs_id_seq,
  public.customer_serial_seq,
  public.sync_queue_id_seq
FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS customers_created_by_idx
  ON public.customers (created_by);
