-- DRAFT ONLY. Never apply to production without independent review and a fresh snapshot.
-- Reverses the two-admin reconciliation on the exact captured schema lineage.
-- It preserves customer rows, Auth email changes, audit rows, and sequence values.
-- Intended to run as one transaction through the validated migration runner.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- Match signup/email-update lock order: auth.users, signup advisory lock, profiles.
-- The table locks also stop ordinary profile edits while preflight and restoration run.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
SELECT pg_catalog.pg_advisory_xact_lock(7283940);
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  profile_count integer;
  policy_names text[];
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations
      WHERE version = '20261109165000'
    )
  THEN
    RAISE EXCEPTION
      'Forward candidate migration 20261109165000 is not recorded; stop and inspect the ledger';
  END IF;

  IF to_regprocedure('public.is_authorized_admin_user()') IS NULL
    OR to_regprocedure('public.sync_profile_email_from_auth_user()') IS NULL
    OR to_regprocedure('public.customers_guard()') IS NULL
    OR to_regprocedure('public.handle_new_user()') IS NULL
    OR to_regclass('public.customers_created_by_idx') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'auth'
        AND c.relname = 'users'
        AND t.tgname = 'auth_users_sync_profile_email'
        AND NOT t.tgisinternal
    )
  THEN
    RAISE EXCEPTION 'Candidate objects are incomplete; stop and inspect before recovery';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('is_authorized_admin_user', true, true, false, true, 'b6849924808e5165493a1a2ea8e5ffde'),
        ('sync_profile_email_from_auth_user', true, false, false, false, 'a16bc4aa39b3a3f845ff68c9c481020b'),
        ('handle_new_user', true, false, false, false, 'b90084a6ee9e9e7f953e74f003e3e0ff'),
        ('customers_guard', true, false, false, false, 'aa976020c243a7fcfe39953e0b9891a8'),
        ('create_customer', false, true, false, true, '4f7ade487ad6966cfc61e617171e1f63'),
        ('set_contract_value', false, true, false, true, '6f8facd1f67cce632845b86fb79bb460'),
        ('search_customers', false, true, false, true, '769b82e08fcc2077d31b09cda042c6e3')
    ) expected(name, is_definer, authenticated_exec, anon_exec, service_exec, source_md5)
    LEFT JOIN LATERAL (
      SELECT p.prosecdef, p.proconfig,
        pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' AS postgres_owner,
        pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
        pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec,
        pg_catalog.md5(replace(p.prosrc, E'\r\n', E'\n')) AS source_md5,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS public_exec
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = expected.name
    ) actual ON true
    WHERE actual.prosecdef IS DISTINCT FROM expected.is_definer
      OR actual.postgres_owner IS DISTINCT FROM true
      OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR actual.authenticated_exec IS DISTINCT FROM expected.authenticated_exec
      OR actual.anon_exec IS DISTINCT FROM expected.anon_exec
      OR actual.service_exec IS DISTINCT FROM expected.service_exec
      OR actual.source_md5 IS DISTINCT FROM expected.source_md5
      OR actual.public_exec IS DISTINCT FROM false
  )
  THEN
    RAISE EXCEPTION
      'Candidate function ownership, security settings, or EXECUTE ACLs differ; inspect before recovery';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
  INTO policy_names
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'profiles', 'customers', 'customer_details', 'activity_logs', 'sync_queue'
    );
  IF policy_names IS DISTINCT FROM ARRAY[
    'activity_logs_select',
    'customer_details_insert',
    'customer_details_select',
    'customer_details_update',
    'customers_delete',
    'customers_insert',
    'customers_select',
    'customers_update',
    'profiles_select',
    'profiles_update_admin',
    'sync_queue_select'
  ]::text[]
    OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('profiles_select', 'SELECT', '4a952ec130c2c43fe6d779f9848d6044'),
        ('profiles_update_admin', 'UPDATE', 'c84cd452b1895c8dd13d006aa04e1f7a'),
        ('customers_select', 'SELECT', '4a952ec130c2c43fe6d779f9848d6044'),
        ('customers_insert', 'INSERT', '4812e383d89f648ba60dcdcf3a418ee1'),
        ('customers_update', 'UPDATE', 'c84cd452b1895c8dd13d006aa04e1f7a'),
        ('customers_delete', 'DELETE', '538ee536bbf48da6f40261d13dd1e724'),
        ('customer_details_select', 'SELECT', '4a952ec130c2c43fe6d779f9848d6044'),
        ('customer_details_insert', 'INSERT', '7586c58ec03128e1c37b64dea1ba5582'),
        ('customer_details_update', 'UPDATE', 'c84cd452b1895c8dd13d006aa04e1f7a'),
        ('activity_logs_select', 'SELECT', '4a952ec130c2c43fe6d779f9848d6044'),
        ('sync_queue_select', 'SELECT', '4a952ec130c2c43fe6d779f9848d6044')
      ) expected(policyname, cmd, definition_md5)
      LEFT JOIN pg_catalog.pg_policies actual
        ON actual.schemaname = 'public'
        AND actual.policyname = expected.policyname
        AND actual.tablename IN (
          'profiles', 'customers', 'customer_details', 'activity_logs', 'sync_queue'
        )
      WHERE actual.policyname IS NULL
        OR actual.cmd IS DISTINCT FROM expected.cmd
        OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
        OR pg_catalog.md5(pg_catalog.concat_ws(
          E'\n',
          actual.cmd,
          actual.permissive::text,
          pg_catalog.array_to_string(actual.roles::text[], ','),
          COALESCE(actual.qual, ''),
          COALESCE(actual.with_check, '')
        )) IS DISTINCT FROM expected.definition_md5
        OR position(
          'is_authorized_admin_user'
          IN COALESCE(actual.qual, '') || COALESCE(actual.with_check, '')
        ) = 0
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'profiles', 'customers', 'customer_details', 'activity_logs', 'sync_queue'
        )
        AND (
          roles IS DISTINCT FROM ARRAY['authenticated']::name[]
          OR position(
            'is_authorized_admin_user'
            IN COALESCE(qual, '') || COALESCE(with_check, '')
          ) = 0
        )
    )
  THEN
    RAISE EXCEPTION
      'Candidate RLS policy inventory or predicates differ; inspect before recovery';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('profiles'),
      ('customers'),
      ('customer_details'),
      ('activity_logs'),
      ('sync_queue')
    ) expected(name)
    LEFT JOIN pg_catalog.pg_class c
      ON c.oid = pg_catalog.to_regclass('public.' || expected.name)
    WHERE c.oid IS NULL
      OR NOT c.relrowsecurity
      OR c.relforcerowsecurity
  )
    OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
    OR NOT pg_catalog.has_column_privilege(
      'authenticated', 'public.profiles', 'full_name', 'UPDATE'
    )
    OR NOT pg_catalog.has_column_privilege(
      'authenticated', 'public.profiles', 'role', 'UPDATE'
    )
    OR NOT pg_catalog.has_column_privilege(
      'authenticated', 'public.profiles', 'active', 'UPDATE'
    )
    OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('profiles', true, false, false, false),
        ('customers', true, true, true, true),
        ('customer_details', true, true, true, false),
        ('activity_logs', true, false, false, false),
        ('sync_queue', true, false, false, false)
      ) expected(name, can_select, can_insert, can_update, can_delete)
      WHERE pg_catalog.has_table_privilege(
          'authenticated', 'public.' || expected.name, 'SELECT'
        ) IS DISTINCT FROM expected.can_select
        OR pg_catalog.has_table_privilege(
          'authenticated', 'public.' || expected.name, 'INSERT'
        ) IS DISTINCT FROM expected.can_insert
        OR pg_catalog.has_table_privilege(
          'authenticated', 'public.' || expected.name, 'UPDATE'
        ) IS DISTINCT FROM expected.can_update
        OR pg_catalog.has_table_privilege(
          'authenticated', 'public.' || expected.name, 'DELETE'
        ) IS DISTINCT FROM expected.can_delete
        OR pg_catalog.has_table_privilege(
          'anon', 'public.' || expected.name, 'SELECT'
        )
        OR pg_catalog.has_table_privilege(
          'anon', 'public.' || expected.name, 'INSERT'
        )
        OR pg_catalog.has_table_privilege(
          'anon', 'public.' || expected.name, 'UPDATE'
        )
        OR pg_catalog.has_table_privilege(
          'anon', 'public.' || expected.name, 'DELETE'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) acl
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'profiles', 'customers', 'customer_details', 'activity_logs', 'sync_queue'
        )
        AND acl.grantee = 0
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.profiles'::regclass
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname NOT IN ('full_name', 'role', 'active')
        AND pg_catalog.has_column_privilege(
          'authenticated', a.attrelid, a.attnum, 'UPDATE'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('activity_logs_id_seq'),
        ('customer_serial_seq'),
        ('sync_queue_id_seq')
      ) expected(name)
      WHERE pg_catalog.has_sequence_privilege(
          'anon', 'public.' || expected.name, 'USAGE'
        )
        OR pg_catalog.has_sequence_privilege(
          'anon', 'public.' || expected.name, 'SELECT'
        )
        OR pg_catalog.has_sequence_privilege(
          'anon', 'public.' || expected.name, 'UPDATE'
        )
        OR pg_catalog.has_sequence_privilege(
          'authenticated', 'public.' || expected.name, 'USAGE'
        )
        OR pg_catalog.has_sequence_privilege(
          'authenticated', 'public.' || expected.name, 'SELECT'
        )
        OR pg_catalog.has_sequence_privilege(
          'authenticated', 'public.' || expected.name, 'UPDATE'
        )
        OR NOT pg_catalog.has_sequence_privilege(
          'service_role', 'public.' || expected.name, 'USAGE'
        )
        OR NOT pg_catalog.has_sequence_privilege(
          'service_role', 'public.' || expected.name, 'SELECT'
        )
        OR NOT pg_catalog.has_sequence_privilege(
          'service_role', 'public.' || expected.name, 'UPDATE'
        )
    )
  THEN
    RAISE EXCEPTION
      'Candidate table RLS or profile UPDATE privilege scope differs; inspect before recovery';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'auth_users_sync_profile_email'
      AND NOT t.tgisinternal
      AND pg_catalog.pg_get_triggerdef(t.oid)
        LIKE 'CREATE TRIGGER auth_users_sync_profile_email AFTER UPDATE OF email ON auth.users%'
      AND t.tgfoid = 'public.sync_profile_email_from_auth_user()'::regprocedure
  ) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'customers_created_by_idx'
        AND indexdef =
          'CREATE INDEX customers_created_by_idx ON public.customers USING btree (created_by)'
    )
  THEN
    RAISE EXCEPTION
      'Candidate trigger or index definition differs; inspect before recovery';
  END IF;

  SELECT count(*) INTO profile_count FROM public.profiles;
  IF profile_count <> 2
    OR NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE user_id = '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f'::uuid
        AND role = 'admin'::public.app_role
        AND active
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid
        AND role = 'admin'::public.app_role
        AND active
    )
  THEN
    RAISE EXCEPTION
      'Profile state differs from the expected post-candidate state; preserve current data and investigate';
  END IF;
END;
$preflight$;

DROP TRIGGER auth_users_sync_profile_email ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  is_first boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(7283940);
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first;

  INSERT INTO public.profiles (user_id, full_name, email, role, active)
  VALUES (
    NEW.id,
    NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NEW.email,
    CASE
      WHEN is_first THEN 'admin'::public.app_role
      ELSE 'staff'::public.app_role
    END,
    is_first
  );
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.customers_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  can_edit_value boolean :=
    public.is_trusted_db_role()
    OR public.current_app_role() IN ('admin', 'manager');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_trusted_db_role()
      AND public.current_app_role() IS NULL
    THEN
      RAISE EXCEPTION 'No active profile' USING ERRCODE = '42501';
    END IF;
    IF NEW.contract_value <> 0 AND NOT can_edit_value THEN
      RAISE EXCEPTION 'Only managers and admins can set a contract value'
        USING ERRCODE = '42501';
    END IF;
    NEW.serial_no := NEXTVAL('public.customer_serial_seq');
    NEW.customer_code := 'CUST-' || LPAD(NEW.serial_no::text, 4, '0');
    NEW.created_by := auth.uid();
    NEW.archived_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.serial_no IS DISTINCT FROM OLD.serial_no
    OR NEW.customer_code IS DISTINCT FROM OLD.customer_code
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Customer identity fields cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.contract_value IS DISTINCT FROM OLD.contract_value THEN
    IF NOT can_edit_value THEN
      RAISE EXCEPTION 'Only managers and admins can change the contract value'
        USING ERRCODE = '42501';
    END IF;
    IF NULLIF(
      BTRIM(COALESCE(CURRENT_SETTING('app.change_reason', true), '')),
      ''
    ) IS NULL THEN
      RAISE EXCEPTION 'A reason is required to change the contract value'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
    AND NOT (
      public.is_trusted_db_role()
      OR public.current_app_role() = 'admin'
    )
  THEN
    RAISE EXCEPTION 'Only administrators can archive or restore customers'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.customers_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.customers_guard()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customers_guard() TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.create_customer(
  p_name text,
  p_contract_date date DEFAULT CURRENT_DATE,
  p_contract_value numeric DEFAULT 0,
  p_place text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_consumer_id text DEFAULT NULL,
  p_address text DEFAULT NULL
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
    BTRIM(p_name),
    COALESCE(p_contract_date, CURRENT_DATE),
    COALESCE(p_contract_value, 0)
  )
  RETURNING * INTO v;

  INSERT INTO public.customer_details
    (customer_id, place, phone, email, consumer_id, address)
  VALUES (
    v.id,
    NULLIF(BTRIM(p_place), ''),
    NULLIF(BTRIM(p_phone), ''),
    NULLIF(BTRIM(p_email), ''),
    NULLIF(BTRIM(p_consumer_id), ''),
    NULLIF(BTRIM(p_address), '')
  );
  RETURN v;
END
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
  IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to change the contract value'
      USING ERRCODE = '23514';
  END IF;
  PERFORM SET_CONFIG('app.change_reason', BTRIM(p_reason), true);

  UPDATE public.customers
  SET contract_value = p_value
  WHERE id = p_customer_id
  RETURNING * INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found or not accessible'
      USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public.search_customers(
  p_search text DEFAULT NULL,
  p_include_archived boolean DEFAULT false,
  p_sort text DEFAULT 'created_at',
  p_dir text DEFAULT 'desc',
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
  archived_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH s AS (
    SELECT NULLIF(BTRIM(COALESCE(p_search, '')), '') AS term
  ), pat AS (
    SELECT CASE
      WHEN term IS NULL THEN NULL
      ELSE '%' || REPLACE(REPLACE(REPLACE(term, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
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

ALTER FUNCTION public.create_customer(text, date, numeric, text, text, text, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.set_contract_value(uuid, numeric, text) OWNER TO postgres;
ALTER FUNCTION public.search_customers(text, boolean, text, text, integer, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.create_customer(text, date, numeric, text, text, text, text, text),
  public.set_contract_value(uuid, numeric, text),
  public.search_customers(text, boolean, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.create_customer(text, date, numeric, text, text, text, text, text),
  public.set_contract_value(uuid, numeric, text),
  public.search_customers(text, boolean, text, text, integer, integer)
  TO authenticated, service_role, postgres;

DROP POLICY profiles_select ON public.profiles;
DROP POLICY profiles_update_admin ON public.profiles;
DROP POLICY customers_select ON public.customers;
DROP POLICY customers_insert ON public.customers;
DROP POLICY customers_update ON public.customers;
DROP POLICY customers_delete ON public.customers;
DROP POLICY customer_details_select ON public.customer_details;
DROP POLICY customer_details_insert ON public.customer_details;
DROP POLICY customer_details_update ON public.customer_details;
DROP POLICY activity_logs_select ON public.activity_logs;
DROP POLICY sync_queue_select ON public.sync_queue;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.current_app_role()) IS NOT NULL
  );
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT public.current_app_role()) = 'admin')
  WITH CHECK ((SELECT public.current_app_role()) = 'admin');
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING ((SELECT public.current_app_role()) IS NOT NULL);
CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_app_role()) IS NOT NULL);
CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.current_app_role()) IS NOT NULL
    AND (archived_at IS NULL OR (SELECT public.current_app_role()) = 'admin')
  )
  WITH CHECK ((SELECT public.current_app_role()) IS NOT NULL);
CREATE POLICY customers_delete ON public.customers
  FOR DELETE TO authenticated
  USING (
    (SELECT public.current_app_role()) = 'admin'
    AND archived_at IS NOT NULL
  );
CREATE POLICY customer_details_select ON public.customer_details
  FOR SELECT TO authenticated
  USING ((SELECT public.current_app_role()) IS NOT NULL);
CREATE POLICY customer_details_insert ON public.customer_details
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.current_app_role()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_id
        AND c.archived_at IS NULL
    )
  );
CREATE POLICY customer_details_update ON public.customer_details
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.current_app_role()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_id
        AND (c.archived_at IS NULL OR (SELECT public.current_app_role()) = 'admin')
    )
  )
  WITH CHECK ((SELECT public.current_app_role()) IS NOT NULL);
CREATE POLICY activity_logs_select ON public.activity_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.current_app_role()) IN ('admin', 'manager'));
CREATE POLICY sync_queue_select ON public.sync_queue
  FOR SELECT TO authenticated
  USING ((SELECT public.current_app_role()) = 'admin');

DROP FUNCTION public.is_authorized_admin_user();
DROP FUNCTION public.sync_profile_email_from_auth_user();

REVOKE ALL ON TABLE
  public.profiles, public.customers, public.customer_details,
  public.activity_logs, public.sync_queue
  FROM PUBLIC, anon, authenticated;
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
GRANT USAGE, SELECT, UPDATE ON SEQUENCE
  public.activity_logs_id_seq, public.sync_queue_id_seq
  TO anon, authenticated;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE
  public.customer_serial_seq
  TO authenticated;

DROP INDEX public.customers_created_by_idx;

UPDATE public.profiles
SET role = 'staff'::public.app_role,
    active = false
WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830'::uuid;

COMMIT;
