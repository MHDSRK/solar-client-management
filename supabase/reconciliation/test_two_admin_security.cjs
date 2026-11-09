const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { resolve } = require("node:path");

const DRAFT_PATH = resolve(
  __dirname,
  "20261105125000_two_admin_security.sql",
);
const EMAILS = {
  first: "solar.disunenergy@gmail.com",
  second: "mhdsharookh@gmail.com",
  unauthorized: "not-approved@example.com",
};
const WORKER_RPC_STATE_QUERY = `
  SELECT
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_catalog.pg_get_function_arguments(p.oid) AS declared_args,
    pg_catalog.pg_get_function_result(p.oid) AS result_type,
    p.prosecdef AS security_definer,
    pg_catalog.pg_get_userbyid(p.proowner) AS owner,
    p.proconfig AS settings,
    l.lanname AS language,
    p.provolatile AS volatility,
    pg_catalog.pg_get_functiondef(p.oid) AS definition,
    pg_catalog.has_function_privilege('postgres', p.oid, 'EXECUTE') AS postgres_execute,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    ARRAY(
      SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(acl.grantee)
             END || ':' || acl.privilege_type || ':' || acl.is_grantable::text
      FROM pg_catalog.aclexplode(p.proacl) acl
      ORDER BY 1
    ) AS explicit_acl
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.proname IN ('claim_sync_jobs', 'complete_sync_job')
  ORDER BY p.proname;
`;

async function assertTriggerFunctionsNotDirectlyExecutable(
  db,
  role,
  claimRole,
  email,
  subject,
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(
    `SELECT set_config('request.jwt.claim.role', $1, false),
      set_config('request.jwt.claim.email', $2, false),
      set_config('request.jwt.claim.sub', $3, false)`,
    [claimRole, email, subject],
  );
  for (const signature of ["public.handle_new_user()", "public.customers_guard()"]) {
    await assert.rejects(
      db.query(`SELECT ${signature}`),
      /permission denied|trigger functions can only be called as triggers/i,
      `${role} must not directly invoke ${signature}`,
    );
  }
  await db.exec("RESET ROLE");
}

async function captureRollbackState(db) {
  const functions = await db.query(`
    SELECT p.oid::regprocedure::text AS signature,
      pg_catalog.pg_get_functiondef(p.oid) AS definition,
      pg_catalog.pg_get_userbyid(p.proowner) AS owner,
      p.prosecdef AS security_definer,
      p.proconfig AS settings,
      p.proacl::text AS acl,
      p.provolatile AS volatility,
      l.lanname AS language
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
    ORDER BY signature;
  `);
  const relations = await db.query(`
    SELECT c.oid::regclass::text AS name,
      c.relkind,
      pg_catalog.pg_get_userbyid(c.relowner) AS owner,
      c.relacl::text AS acl,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS force_rls
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY[
        'profiles', 'customers', 'customer_details', 'activity_logs', 'sync_queue',
        'activity_logs_id_seq', 'customer_serial_seq', 'sync_queue_id_seq'
      ])
    ORDER BY name;
  `);
  const columnAcls = await db.query(`
    SELECT c.relname AS table_name, a.attname AS column_name, a.attacl::text AS acl
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY[
        'profiles', 'customers', 'customer_details', 'activity_logs', 'sync_queue'
      ])
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY table_name, a.attnum;
  `);
  const policies = await db.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `);
  const triggers = await db.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name,
      t.tgname AS trigger_name, t.tgenabled AS enabled,
      pg_catalog.pg_get_triggerdef(t.oid) AS definition
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
    ORDER BY schema_name, table_name, trigger_name;
  `);
  const indexes = await db.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;
  `);
  const profiles = await db.query(`
    SELECT user_id::text, full_name, email, role::text, active, created_at, updated_at
    FROM public.profiles
    ORDER BY user_id;
  `);
  const audit = await db.query(`
    SELECT COALESCE(
      jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id),
      '[]'::jsonb
    ) AS rows
    FROM public.activity_logs row_data;
  `);
  const syncQueue = await db.query(`
    SELECT COALESCE(
      jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id),
      '[]'::jsonb
    ) AS rows
    FROM public.sync_queue row_data;
  `);

  return {
    functions: functions.rows,
    relations: relations.rows,
    columnAcls: columnAcls.rows,
    policies: policies.rows,
    triggers: triggers.rows,
    indexes: indexes.rows,
    profiles: profiles.rows,
    audit: audit.rows,
    syncQueue: syncQueue.rows,
  };
}

const liveSchema = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
      EXECUTE 'CREATE ROLE postgres';
    END IF;
  END
  $$;

  CREATE SCHEMA auth;
  CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'staff');
  CREATE TYPE public.drive_status AS ENUM ('pending', 'created', 'failed');
  CREATE TYPE public.sync_status AS ENUM ('pending', 'processing', 'done', 'failed', 'dead');
  CREATE SEQUENCE public.customer_serial_seq;

  CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb
  );
  CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.email', true) $$;
  CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
  CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.email(), auth.role(), auth.uid()
    TO authenticated, service_role;

  CREATE TABLE public.profiles (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    email text,
    role public.app_role NOT NULL DEFAULT 'staff',
    active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_no integer NOT NULL UNIQUE,
    customer_code text NOT NULL UNIQUE,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    contract_date date NOT NULL DEFAULT current_date,
    contract_value numeric NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
    drive_folder_id text,
    drive_status public.drive_status NOT NULL DEFAULT 'pending',
    archived_at timestamptz,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.customer_details (
    customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
    place text,
    consumer_id text,
    phone text,
    email text,
    address text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.activity_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_id uuid,
    action text NOT NULL CHECK (action = ANY (ARRAY['insert', 'update', 'delete'])),
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    before jsonb,
    after jsonb,
    reason text
  );
  CREATE TABLE public.sync_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type text NOT NULL CHECK (entity_type = 'customer'),
    entity_id uuid NOT NULL,
    operation text NOT NULL DEFAULT 'upsert' CHECK (operation = ANY (ARRAY['upsert', 'delete'])),
    status public.sync_status NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
  );
  CREATE UNIQUE INDEX sync_queue_pending_unique
    ON public.sync_queue (entity_type, entity_id)
    WHERE status = 'pending';

  CREATE FUNCTION public.claim_sync_jobs(p_limit integer DEFAULT 50)
  RETURNS SETOF public.sync_queue
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
  AS $function$
  begin
    return query
    update public.sync_queue q
       set status = 'processing',
           attempts = q.attempts + 1,
           updated_at = now()
     where q.id in (
       select s.id
         from public.sync_queue s
        where (s.status in ('pending', 'failed')
               and s.next_attempt_at <= now())
           or (s.status = 'processing'
               and s.updated_at < now() - interval '10 minutes')
        order by s.id
        limit greatest(1, least(p_limit, 200))
        for update skip locked
     )
    returning q.*;
  end
  $function$;
  ALTER FUNCTION public.claim_sync_jobs(integer) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.claim_sync_jobs(integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.claim_sync_jobs(integer) TO postgres, service_role;

  CREATE FUNCTION public.complete_sync_job(
    p_id bigint,
    p_ok boolean,
    p_error text DEFAULT NULL::text
  )
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
  AS $function$
  begin
    if p_ok then
      update public.sync_queue
         set status = 'done',
             processed_at = now(),
             last_error = null,
             updated_at = now()
       where id = p_id;
    else
      update public.sync_queue
         set status = case
               when attempts >= 8 then 'dead'::public.sync_status
               else 'failed'::public.sync_status
             end,
             next_attempt_at = now()
               + least(interval '1 hour',
                       interval '15 seconds' * power(2, attempts)),
             last_error = left(p_error, 2000),
             updated_at = now()
       where id = p_id;
    end if;
  end
  $function$;
  ALTER FUNCTION public.complete_sync_job(bigint, boolean, text) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.complete_sync_job(bigint, boolean, text)
    FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.complete_sync_job(bigint, boolean, text)
    TO postgres, service_role;

  CREATE FUNCTION public.current_app_role()
  RETURNS public.app_role
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  AS $function$
    SELECT p.role
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.active
  $function$;
  CREATE FUNCTION public.is_trusted_db_role()
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $function$
    SELECT current_user IN ('postgres', 'service_role', 'supabase_admin')
  $function$;
  CREATE FUNCTION public.activity_logs_block_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
  BEGIN
    RAISE EXCEPTION 'activity_logs is append-only' USING ERRCODE = '42501';
  END
  $function$;
  CREATE FUNCTION public.set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END
  $function$;
  CREATE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  DECLARE is_first boolean;
  BEGIN
    PERFORM pg_advisory_xact_lock(7283940);
    SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first;
    INSERT INTO public.profiles (user_id, full_name, email, role, active)
    VALUES (
      NEW.id,
      NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), ''),
      NEW.email,
      CASE WHEN is_first THEN 'admin'::public.app_role ELSE 'staff'::public.app_role END,
      is_first
    );
    RETURN NEW;
  END
  $function$;
  CREATE FUNCTION public.log_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  DECLARE
    old_j jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN TO_JSONB(OLD) END;
    new_j jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN TO_JSONB(NEW) END;
    key_j jsonb := COALESCE(new_j, old_j);
  BEGIN
    IF TG_OP = 'UPDATE' AND (old_j - 'updated_at') = (new_j - 'updated_at') THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.activity_logs
      (actor_id, action, entity_type, entity_id, before, after, reason)
    VALUES (
      auth.uid(), LOWER(TG_OP), TG_ARGV[0], key_j ->> TG_ARGV[1],
      old_j, new_j,
      NULLIF(BTRIM(COALESCE(CURRENT_SETTING('app.change_reason', true), '')), '')
    );
    RETURN NULL;
  END
  $function$;
  CREATE FUNCTION public.enqueue_customer_sync()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  DECLARE
    target uuid;
    op text := 'upsert';
  BEGIN
    IF TG_TABLE_NAME = 'customers' THEN
      target := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
      IF TG_OP = 'DELETE' THEN op := 'delete'; END IF;
    ELSE
      target := NEW.customer_id;
    END IF;
    INSERT INTO public.sync_queue (entity_type, entity_id, operation)
    VALUES ('customer', target, op)
    ON CONFLICT (entity_type, entity_id) WHERE status = 'pending'
    DO UPDATE SET
      operation = CASE
        WHEN public.sync_queue.operation = 'delete' THEN 'delete'
        ELSE EXCLUDED.operation
      END,
      next_attempt_at = LEAST(public.sync_queue.next_attempt_at, NOW()),
      updated_at = NOW();
    RETURN NULL;
  END
  $function$;
  CREATE FUNCTION public.protect_last_admin()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  BEGIN
    IF OLD.role = 'admin' AND OLD.active
      AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NOT NEW.active)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.role = 'admin' AND p.active AND p.user_id <> OLD.user_id
      )
    THEN
      RAISE EXCEPTION 'At least one active administrator is required'
        USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END
  $function$;

  CREATE FUNCTION public.customers_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
  DECLARE
    can_edit_value boolean :=
      public.is_trusted_db_role()
      OR public.current_app_role() IN ('admin', 'manager');
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NOT public.is_trusted_db_role() AND public.current_app_role() IS NULL THEN
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
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Customer identity fields cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.contract_value IS DISTINCT FROM OLD.contract_value THEN
      IF NOT can_edit_value THEN
        RAISE EXCEPTION 'Only managers and admins can change the contract value'
          USING ERRCODE = '42501';
      END IF;
      IF NULLIF(BTRIM(COALESCE(CURRENT_SETTING('app.change_reason', true), '')), '') IS NULL THEN
        RAISE EXCEPTION 'A reason is required to change the contract value'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
      AND NOT (public.is_trusted_db_role() OR public.current_app_role() = 'admin') THEN
      RAISE EXCEPTION 'Only administrators can archive or restore customers'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END
  $function$;
  CREATE FUNCTION public.create_customer(
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
  AS $function$
  DECLARE v public.customers;
  BEGIN
    INSERT INTO public.customers (name, contract_date, contract_value)
    VALUES (BTRIM(p_name), COALESCE(p_contract_date, CURRENT_DATE), COALESCE(p_contract_value, 0))
    RETURNING * INTO v;
    INSERT INTO public.customer_details (customer_id, place, phone, email, consumer_id, address)
    VALUES (
      v.id, NULLIF(BTRIM(p_place), ''), NULLIF(BTRIM(p_phone), ''),
      NULLIF(BTRIM(p_email), ''), NULLIF(BTRIM(p_consumer_id), ''),
      NULLIF(BTRIM(p_address), '')
    );
    RETURN v;
  END
  $function$;
  CREATE FUNCTION public.search_customers(
    p_search text DEFAULT NULL::text,
    p_include_archived boolean DEFAULT false,
    p_sort text DEFAULT 'created_at'::text,
    p_dir text DEFAULT 'desc'::text,
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
  )
  RETURNS TABLE (
    id uuid, customer_code text, serial_no integer, name text, place text,
    phone text, consumer_id text, contract_date date, contract_value numeric,
    drive_status public.drive_status, archived_at timestamptz,
    created_at timestamptz, total_count bigint
  )
  LANGUAGE sql STABLE
  AS $function$
    WITH s AS (
      SELECT NULLIF(BTRIM(COALESCE(p_search, '')), '') AS term
    ),
    pat AS (
      SELECT CASE WHEN term IS NULL THEN NULL
        ELSE '%' || REPLACE(REPLACE(REPLACE(term, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_') || '%'
      END AS p
      FROM s
    )
    SELECT c.id, c.customer_code, c.serial_no, c.name, d.place, d.phone,
      d.consumer_id, c.contract_date, c.contract_value, c.drive_status,
      c.archived_at, c.created_at, COUNT(*) OVER () AS total_count
    FROM public.customers c
    LEFT JOIN public.customer_details d ON d.customer_id = c.id
    CROSS JOIN pat
    WHERE (p_include_archived OR c.archived_at IS NULL)
      AND (pat.p IS NULL OR c.name ILIKE pat.p OR c.customer_code ILIKE pat.p
        OR d.phone ILIKE pat.p OR d.consumer_id ILIKE pat.p)
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
  CREATE FUNCTION public.set_contract_value(
    p_customer_id uuid, p_value numeric, p_reason text
  )
  RETURNS public.customers
  LANGUAGE plpgsql
  AS $function$
  DECLARE v public.customers;
  BEGIN
    IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'A reason is required to change the contract value'
        USING ERRCODE = '23514';
    END IF;
    PERFORM SET_CONFIG('app.change_reason', BTRIM(p_reason), true);
    UPDATE public.customers SET contract_value = p_value
    WHERE id = p_customer_id RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found or not accessible' USING ERRCODE = 'P0002';
    END IF;
    RETURN v;
  END
  $function$;

  CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  CREATE TRIGGER profiles_audit AFTER INSERT OR DELETE OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.log_change('profile', 'user_id');
  CREATE TRIGGER profiles_protect_last_admin BEFORE DELETE OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();
  CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  CREATE TRIGGER customers_audit AFTER INSERT OR DELETE OR UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.log_change('customer', 'id');
  CREATE TRIGGER customers_enqueue_sync AFTER INSERT OR DELETE OR UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_customer_sync();
  CREATE TRIGGER customers_guard_trg BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.customers_guard();
  CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  CREATE TRIGGER customer_details_audit AFTER INSERT OR UPDATE OR DELETE ON public.customer_details
    FOR EACH ROW EXECUTE FUNCTION public.log_change('customer_details', 'customer_id');
  CREATE TRIGGER customer_details_enqueue_sync AFTER INSERT OR UPDATE ON public.customer_details
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_customer_sync();
  CREATE TRIGGER activity_logs_no_truncate BEFORE TRUNCATE ON public.activity_logs
    FOR EACH STATEMENT EXECUTE FUNCTION public.activity_logs_block_mutation();
  CREATE TRIGGER activity_logs_no_update_delete BEFORE DELETE OR UPDATE ON public.activity_logs
    FOR EACH ROW EXECUTE FUNCTION public.activity_logs_block_mutation();

  GRANT USAGE, SELECT, UPDATE ON SEQUENCE
    public.activity_logs_id_seq,
    public.customer_serial_seq,
    public.sync_queue_id_seq
  TO PUBLIC, anon, authenticated;
  GRANT USAGE, SELECT, UPDATE ON SEQUENCE
    public.activity_logs_id_seq,
    public.customer_serial_seq,
    public.sync_queue_id_seq
  TO service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.profiles, public.customers, public.customer_details,
    public.activity_logs, public.sync_queue
  TO service_role;

  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.customer_details ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;
  CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()) OR (SELECT public.current_app_role()) IS NOT NULL);
  CREATE POLICY profiles_update_admin ON public.profiles FOR UPDATE TO authenticated
    USING ((SELECT public.current_app_role()) = 'admin'::public.app_role)
    WITH CHECK ((SELECT public.current_app_role()) = 'admin'::public.app_role);
  CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) IS NOT NULL);
  CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.current_app_role()) IS NOT NULL);
  CREATE POLICY customers_update ON public.customers FOR UPDATE TO authenticated
    USING ((SELECT public.current_app_role()) IS NOT NULL
      AND (archived_at IS NULL OR (SELECT public.current_app_role()) = 'admin'::public.app_role))
    WITH CHECK ((SELECT public.current_app_role()) IS NOT NULL);
  CREATE POLICY customers_delete ON public.customers FOR DELETE TO authenticated
    USING ((SELECT public.current_app_role()) = 'admin'::public.app_role AND archived_at IS NOT NULL);
  CREATE POLICY customer_details_select ON public.customer_details FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) IS NOT NULL);
  CREATE POLICY customer_details_insert ON public.customer_details FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.current_app_role()) IS NOT NULL);
  CREATE POLICY customer_details_update ON public.customer_details FOR UPDATE TO authenticated
    USING ((SELECT public.current_app_role()) IS NOT NULL)
    WITH CHECK ((SELECT public.current_app_role()) IS NOT NULL);
  CREATE POLICY activity_logs_select ON public.activity_logs FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) = 'admin'::public.app_role);
  CREATE POLICY sync_queue_select ON public.sync_queue FOR SELECT TO authenticated
    USING ((SELECT public.current_app_role()) = 'admin'::public.app_role);

  GRANT SELECT ON TABLE public.profiles TO authenticated;
  GRANT UPDATE (full_name, role, active) ON TABLE public.profiles TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO authenticated;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_details TO authenticated;
  GRANT SELECT ON TABLE public.activity_logs, public.sync_queue TO authenticated;
  GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated, postgres, service_role;
  GRANT EXECUTE ON FUNCTION public.is_trusted_db_role() TO authenticated, postgres, service_role;
  GRANT EXECUTE ON FUNCTION public.create_customer(text,date,numeric,text,text,text,text,text)
    TO authenticated;
  GRANT EXECUTE ON FUNCTION public.search_customers(text,boolean,text,text,integer,integer)
    TO authenticated;
  GRANT EXECUTE ON FUNCTION public.set_contract_value(uuid,numeric,text) TO authenticated;
`;

async function main() {
  assert.equal(
    EMAILS.first,
    "solar.disunenergy@gmail.com",
    "Use the literal admin email, not Markdown mailto markup",
  );
  assert.equal(
    EMAILS.second,
    "mhdsharookh@gmail.com",
    "Use the literal admin email, not Markdown mailto markup",
  );
  assert.equal(
    EMAILS.unauthorized,
    "not-approved@example.com",
    "Use a literal non-allowlisted email",
  );

  const draft = readFileSync(DRAFT_PATH, "utf8");
  const db = new PGlite();
  try {
    await db.exec(liveSchema);

    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('33333333-3333-4333-8333-333333333333', '${EMAILS.unauthorized}', '{}'),
        ('6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f', '${EMAILS.first}', '{"full_name":"Admin One"}');
    `);

    const triggerInventoryBefore = await db.query(`
      SELECT n.nspname AS schema_name, c.relname AS table_name,
        t.tgname AS trigger_name, t.tgenabled AS enabled,
        pg_catalog.pg_get_triggerdef(t.oid) AS definition
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
      ORDER BY n.nspname, c.relname, t.tgname;
    `);

    const workerFunctionsBefore = await db.query(WORKER_RPC_STATE_QUERY);
    assert.equal(workerFunctionsBefore.rows.length, 2);

    const signaturesBefore = await db.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
        pg_get_function_arguments(p.oid) AS args,
        pg_get_function_result(p.oid) AS result
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('customers_guard', 'create_customer', 'search_customers', 'set_contract_value')
      ORDER BY p.proname;
    `);

    await db.exec(draft);
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (
        'd2914556-10a7-4954-8ee0-8cdbdb649830',
        'admin.two.updated@example.com',
        '{"full_name":"Admin Two"}'
      );
    `);
    const uuidProvisionedProfile = await db.query(`
      SELECT email, role::text, active
      FROM public.profiles
      WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830';
    `);
    assert.deepEqual(uuidProvisionedProfile.rows[0], {
      email: "admin.two.updated@example.com",
      role: "admin",
      active: true,
    });

    const firstRunSideEffects = await db.query(`
      SELECT
        (SELECT count(*)::int FROM public.profiles) AS profiles,
        (SELECT count(*)::int FROM public.activity_logs) AS activity_logs,
        (SELECT count(*)::int FROM public.sync_queue) AS sync_queue;
    `);
    await db.exec(draft);
    const secondRunSideEffects = await db.query(`
      SELECT
        (SELECT count(*)::int FROM public.profiles) AS profiles,
        (SELECT count(*)::int FROM public.activity_logs) AS activity_logs,
        (SELECT count(*)::int FROM public.sync_queue) AS sync_queue;
    `);
    assert.deepEqual(secondRunSideEffects.rows, firstRunSideEffects.rows);

    const workerFunctionsAfter = await db.query(WORKER_RPC_STATE_QUERY);
    assert.deepEqual(workerFunctionsAfter.rows, workerFunctionsBefore.rows);
    const expectedWorkerRpcMetadata = {
      claim_sync_jobs: {
        identity_args: "p_limit integer",
        declared_args: "p_limit integer DEFAULT 50",
        result_type: "SETOF sync_queue",
      },
      complete_sync_job: {
        identity_args: "p_id bigint, p_ok boolean, p_error text",
        declared_args: "p_id bigint, p_ok boolean, p_error text DEFAULT NULL::text",
        result_type: "void",
      },
    };
    for (const fn of workerFunctionsAfter.rows) {
      const expected = expectedWorkerRpcMetadata[fn.proname];
      assert(expected, `unexpected worker RPC ${fn.proname}`);
      assert.equal(fn.identity_args, expected.identity_args);
      assert.equal(fn.declared_args, expected.declared_args);
      assert.equal(fn.result_type, expected.result_type);
      assert.equal(fn.owner, "postgres");
      assert.equal(fn.security_definer, true);
      assert.equal(fn.language, "plpgsql");
      assert.equal(fn.volatility, "v");
      assert.deepEqual(fn.settings, ['search_path=""']);
      assert.equal(fn.postgres_execute, true);
      assert.equal(fn.service_role_execute, true);
      assert.equal(fn.authenticated_execute, false);
      assert.equal(fn.anon_execute, false);
      assert.deepEqual(fn.explicit_acl, [
        "postgres:EXECUTE:false",
        "service_role:EXECUTE:false",
      ]);
    }

    const triggerInventoryAfter = await db.query(`
      SELECT n.nspname AS schema_name, c.relname AS table_name,
        t.tgname AS trigger_name, t.tgenabled AS enabled,
        pg_catalog.pg_get_triggerdef(t.oid) AS definition
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
      ORDER BY n.nspname, c.relname, t.tgname;
    `);
    const emailSyncTrigger = triggerInventoryAfter.rows.find(
      (trigger) => trigger.trigger_name === "auth_users_sync_profile_email",
    );
    assert(emailSyncTrigger, "auth.users email synchronization trigger must exist");
    assert.equal(emailSyncTrigger.schema_name, "auth");
    assert.equal(emailSyncTrigger.table_name, "users");
    assert.equal(emailSyncTrigger.enabled, "O");
    assert.match(emailSyncTrigger.definition, /AFTER UPDATE OF email ON auth\.users/i);
    assert.match(
      emailSyncTrigger.definition,
      /EXECUTE FUNCTION (public\.)?sync_profile_email_from_auth_user\(\)/i,
    );
    assert.deepEqual(
      triggerInventoryAfter.rows.filter(
        (trigger) => trigger.trigger_name !== "auth_users_sync_profile_email",
      ),
      triggerInventoryBefore.rows,
    );

    const emailSyncFunction = await db.query(`
      SELECT p.prosecdef AS security_definer,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner,
        p.proconfig AS settings,
        pg_catalog.has_function_privilege('postgres', p.oid, 'EXECUTE') AS postgres_execute,
        pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
        pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
        pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'sync_profile_email_from_auth_user';
    `);
    assert.equal(emailSyncFunction.rows.length, 1);
    assert.equal(emailSyncFunction.rows[0].security_definer, true);
    assert.equal(emailSyncFunction.rows[0].owner, "postgres");
    assert.deepEqual(emailSyncFunction.rows[0].settings, ['search_path=""']);
    assert.equal(emailSyncFunction.rows[0].postgres_execute, true);
    assert.equal(emailSyncFunction.rows[0].service_role_execute, false);
    assert.equal(emailSyncFunction.rows[0].authenticated_execute, false);
    assert.equal(emailSyncFunction.rows[0].anon_execute, false);

    const signaturesAfter = await db.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
        pg_get_function_arguments(p.oid) AS args,
        pg_get_function_result(p.oid) AS result
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('customers_guard', 'create_customer', 'search_customers', 'set_contract_value')
      ORDER BY p.proname;
    `);
    assert.deepEqual(signaturesAfter.rows, signaturesBefore.rows);

    const adminProfiles = await db.query(`
      SELECT count(*)::int AS count
      FROM public.profiles
      WHERE role = 'admin' AND active
        AND user_id IN (
          '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f',
          'd2914556-10a7-4954-8ee0-8cdbdb649830'
        );
    `);
    assert.equal(adminProfiles.rows[0].count, 2);

    await db.query(
      "UPDATE auth.users SET email = upper(email) WHERE id = $1::uuid",
      ["6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const caseUpdatedProfile = await db.query(`
      SELECT email, role::text, active
      FROM public.profiles
      WHERE user_id = '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f';
    `);
    assert.deepEqual(caseUpdatedProfile.rows[0], {
      email: EMAILS.first.toUpperCase(),
      role: "admin",
      active: true,
    });

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.first.toUpperCase(), "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const caseUpdatedAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(caseUpdatedAuthorization.rows[0].authorized, true);
    await db.exec("RESET ROLE");

    await db.query(
      "UPDATE auth.users SET email = $1 WHERE id = $2::uuid",
      ["solar.admin.updated@example.com", "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const changedEmailProfile = await db.query(`
      SELECT email, role::text, active
      FROM public.profiles
      WHERE user_id = '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f';
    `);
    assert.deepEqual(changedEmailProfile.rows[0], {
      email: "solar.admin.updated@example.com",
      role: "admin",
      active: true,
    });

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", "solar.admin.updated@example.com", "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const changedEmailAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(changedEmailAuthorization.rows[0].authorized, true);
    await db.exec("RESET ROLE");

    await db.query(
      "UPDATE auth.users SET email = NULL WHERE id = $1::uuid",
      ["6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const nullUpdatedProfile = await db.query(`
      SELECT email, role::text, active
      FROM public.profiles
      WHERE user_id = '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f';
    `);
    assert.deepEqual(nullUpdatedProfile.rows[0], {
      email: null,
      role: "admin",
      active: true,
    });

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", "", "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const nullEmailAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(nullEmailAuthorization.rows[0].authorized, true);
    await db.exec("RESET ROLE");

    await db.query(
      "UPDATE auth.users SET email = $1 WHERE id = $2::uuid",
      [EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const restoredProfile = await db.query(`
      SELECT email, role::text, active
      FROM public.profiles
      WHERE user_id = '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f';
    `);
    assert.deepEqual(restoredProfile.rows[0], {
      email: EMAILS.first,
      role: "admin",
      active: true,
    });

    const authorizationHelper = await db.query(`
      SELECT p.prosecdef AS security_definer,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner,
        p.proconfig AS settings,
        pg_catalog.pg_get_functiondef(p.oid) AS definition,
        pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
        pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'is_authorized_admin_user';
    `);
    assert.equal(authorizationHelper.rows.length, 1);
    assert.equal(authorizationHelper.rows[0].security_definer, true);
    assert.equal(authorizationHelper.rows[0].owner, "postgres");
    assert.deepEqual(authorizationHelper.rows[0].settings, ['search_path=""']);
    assert.equal(authorizationHelper.rows[0].authenticated_execute, true);
    assert.equal(authorizationHelper.rows[0].anon_execute, false);
    assert.equal(authorizationHelper.rows[0].public_execute, false);
    assert.match(
      authorizationHelper.rows[0].definition,
      /6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f/i,
    );
    assert.match(
      authorizationHelper.rows[0].definition,
      /d2914556-10a7-4954-8ee0-8cdbdb649830/i,
    );
    assert.doesNotMatch(authorizationHelper.rows[0].definition, /auth\.email\(\)/i);

    const signupFunction = await db.query(`
      SELECT pg_catalog.pg_get_functiondef(
        'public.handle_new_user()'::regprocedure
      ) AS definition;
    `);
    assert.match(
      signupFunction.rows[0].definition,
      /6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f/i,
    );
    assert.match(
      signupFunction.rows[0].definition,
      /d2914556-10a7-4954-8ee0-8cdbdb649830/i,
    );
    assert.doesNotMatch(
      signupFunction.rows[0].definition,
      /solar\.disunenergy@gmail\.com|mhdsharookh@gmail\.com/i,
    );

    const profileRls = await db.query(`
      SELECT
        pg_catalog.pg_get_userbyid(c.relowner) AS owner,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS force_rls
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'profiles';
    `);
    assert.deepEqual(profileRls.rows[0], {
      owner: "postgres",
      rls_enabled: true,
      force_rls: false,
    });

    const unauthorizedProfile = await db.query(`
      SELECT role::text, active FROM public.profiles WHERE email = '${EMAILS.unauthorized}';
    `);
    assert.equal(unauthorizedProfile.rows[0].active, false);

    const matrix = await db.query(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
        COALESCE(string_agg(DISTINCT p.cmd, ','), '') AS policy_commands,
        COALESCE(string_agg(DISTINCT array_to_string(p.roles, ','), ','), '') AS policy_roles,
        has_table_privilege('authenticated', c.oid, 'SELECT') AS can_select,
        has_table_privilege('authenticated', c.oid, 'INSERT') AS can_insert,
        has_table_privilege('authenticated', c.oid, 'UPDATE') AS can_update,
        has_table_privilege('authenticated', c.oid, 'DELETE') AS can_delete,
        has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_policies p
        ON p.schemaname = n.nspname AND p.tablename = c.relname
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      GROUP BY c.oid, c.relname, c.relrowsecurity;
    `);

    const expectedPolicies = {
      profiles: ["SELECT", "UPDATE"],
      customers: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      customer_details: ["INSERT", "SELECT", "UPDATE"],
      activity_logs: ["SELECT"],
      sync_queue: ["SELECT"],
    };
    const expectedGrants = {
      profiles: ["SELECT"],
      customers: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      customer_details: ["INSERT", "SELECT", "UPDATE"],
      activity_logs: ["SELECT"],
      sync_queue: ["SELECT"],
    };
    assert.equal(matrix.rows.length, Object.keys(expectedPolicies).length);
    for (const row of matrix.rows) {
      if (row.anon_select) {
        console.error("Unexpected anon table grant:", row.table_name);
      }
      const actualCommands = row.policy_commands.split(",").filter(Boolean).sort();
      assert.equal(row.rls_enabled, true, `${row.table_name}: RLS must be enabled`);
      assert.deepEqual(
        actualCommands,
        expectedPolicies[row.table_name].slice().sort(),
        `${row.table_name}: unexpected policy commands`,
      );
      assert(
        row.policy_roles.split(",").every((role) => role === "authenticated"),
        `${row.table_name}: policies must target authenticated only`,
      );
      const actualGrants = ["SELECT", "INSERT", "UPDATE", "DELETE"]
        .filter((privilege) => row[`can_${privilege.toLowerCase()}`])
        .sort();
      assert.deepEqual(
        actualGrants,
        expectedGrants[row.table_name].slice().sort(),
        `${row.table_name}: unexpected authenticated grants`,
      );
      assert.equal(row.anon_select, false, `${row.table_name}: anon must not read`);
    }

    const profilePrivileges = await db.query(`
      SELECT
        has_table_privilege('authenticated', 'public.profiles', 'SELECT') AS authenticated_select,
        has_table_privilege('authenticated', 'public.profiles', 'UPDATE') AS authenticated_table_update,
        has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') AS authenticated_full_name_update,
        has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') AS authenticated_role_update,
        has_column_privilege('authenticated', 'public.profiles', 'active', 'UPDATE') AS authenticated_active_update,
        has_table_privilege('anon', 'public.profiles', 'UPDATE') AS anon_table_update,
        has_column_privilege('anon', 'public.profiles', 'full_name', 'UPDATE') AS anon_full_name_update,
        has_column_privilege('anon', 'public.profiles', 'role', 'UPDATE') AS anon_role_update,
        has_column_privilege('anon', 'public.profiles', 'active', 'UPDATE') AS anon_active_update;
    `);
    assert.deepEqual(profilePrivileges.rows[0], {
      authenticated_select: true,
      authenticated_table_update: false,
      authenticated_full_name_update: true,
      authenticated_role_update: true,
      authenticated_active_update: true,
      anon_table_update: false,
      anon_full_name_update: false,
      anon_role_update: false,
      anon_active_update: false,
    });

    const profileUpdatePolicy = await db.query(`
      SELECT roles, cmd, qual, with_check
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
        AND policyname = 'profiles_update_admin';
    `);
    assert.equal(profileUpdatePolicy.rows.length, 1);
    assert.deepEqual(profileUpdatePolicy.rows[0].roles, ["authenticated"]);
    assert.equal(profileUpdatePolicy.rows[0].cmd, "UPDATE");
    assert.match(profileUpdatePolicy.rows[0].qual, /is_authorized_admin_user/i);
    assert.match(profileUpdatePolicy.rows[0].with_check, /is_authorized_admin_user/i);

    const functionConfigs = await db.query(`
      SELECT p.proname, p.proconfig,
        p.prosecdef AS security_definer,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner,
        pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'current_app_role', 'is_authorized_admin_user', 'set_updated_at', 'is_trusted_db_role',
          'customers_guard', 'activity_logs_block_mutation',
          'enqueue_customer_sync', 'log_change', 'protect_last_admin',
          'handle_new_user', 'create_customer', 'search_customers',
          'set_contract_value'
        );
    `);
    assert.equal(functionConfigs.rows.length, 13);
    for (const fn of functionConfigs.rows) {
      assert(
        fn.proconfig?.some((config) => config.startsWith("search_path=")),
        `${fn.proname}: function search_path must be fixed`,
      );
    }
    const guard = functionConfigs.rows.find((fn) => fn.proname === "customers_guard");
    assert.equal(guard.security_definer, true);
    assert.equal(guard.owner, "postgres");
    assert.equal(guard.authenticated_can_execute, false);
    const authorizationFn = functionConfigs.rows.find(
      (fn) => fn.proname === "is_authorized_admin_user",
    );
    assert.equal(authorizationFn.security_definer, true);
    assert.equal(authorizationFn.owner, "postgres");
    assert.equal(authorizationFn.authenticated_can_execute, true);
    const guardDefinition = await db.query(`
      SELECT pg_catalog.pg_get_functiondef('public.customers_guard()'::regprocedure) AS definition;
    `);
    assert.match(guardDefinition.rows[0].definition, /auth\.role\(\)\s*=\s*'service_role'/i);
    assert.match(guardDefinition.rows[0].definition, /public\.is_authorized_admin_user\(\)/i);
    assert.doesNotMatch(
      guardDefinition.rows[0].definition,
      /is_trusted_db_role|current_user/i,
    );
    const guardExecGrants = await db.query(`
      SELECT
        has_function_privilege('anon', 'public.customers_guard()', 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', 'public.customers_guard()', 'EXECUTE') AS authenticated_can_execute,
        has_function_privilege('service_role', 'public.customers_guard()', 'EXECUTE') AS service_role_can_execute,
        has_function_privilege('postgres', 'public.customers_guard()', 'EXECUTE') AS postgres_can_execute;
    `);
    assert.deepEqual(guardExecGrants.rows[0], {
      anon_can_execute: false,
      authenticated_can_execute: false,
      service_role_can_execute: false,
      postgres_can_execute: true,
    });
    const signupExecGrants = await db.query(`
      SELECT
        has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') AS authenticated_can_execute,
        has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE') AS service_role_can_execute,
        has_function_privilege('postgres', 'public.handle_new_user()', 'EXECUTE') AS postgres_can_execute;
    `);
    assert.deepEqual(signupExecGrants.rows[0], {
      anon_can_execute: false,
      authenticated_can_execute: false,
      service_role_can_execute: false,
      postgres_can_execute: true,
    });
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(guardExecGrants.rows[0][`${role}_can_execute`], false);
      assert.equal(signupExecGrants.rows[0][`${role}_can_execute`], false);
    }
    await assertTriggerFunctionsNotDirectlyExecutable(
      db,
      "anon",
      "anon",
      "",
      "",
    );
    await assertTriggerFunctionsNotDirectlyExecutable(
      db,
      "authenticated",
      "authenticated",
      EMAILS.unauthorized,
      "33333333-3333-4333-8333-333333333333",
    );
    await assertTriggerFunctionsNotDirectlyExecutable(
      db,
      "authenticated",
      "authenticated",
      EMAILS.second,
      "d2914556-10a7-4954-8ee0-8cdbdb649830",
    );
    await assertTriggerFunctionsNotDirectlyExecutable(
      db,
      "service_role",
      "service_role",
      "",
      "",
    );

    const serialHelper = await db.query(`
      SELECT count(*)::int AS count
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'next_customer_serial';
    `);
    assert.equal(serialHelper.rows[0].count, 0);

    const sequencePrivileges = await db.query(`
      SELECT
        has_sequence_privilege('authenticated', 'public.activity_logs_id_seq', 'USAGE')
          OR has_sequence_privilege('authenticated', 'public.activity_logs_id_seq', 'SELECT')
          OR has_sequence_privilege('authenticated', 'public.activity_logs_id_seq', 'UPDATE') AS auth_activity,
        has_sequence_privilege('authenticated', 'public.customer_serial_seq', 'USAGE')
          OR has_sequence_privilege('authenticated', 'public.customer_serial_seq', 'SELECT')
          OR has_sequence_privilege('authenticated', 'public.customer_serial_seq', 'UPDATE') AS auth_customer,
        has_sequence_privilege('authenticated', 'public.sync_queue_id_seq', 'USAGE')
          OR has_sequence_privilege('authenticated', 'public.sync_queue_id_seq', 'SELECT')
          OR has_sequence_privilege('authenticated', 'public.sync_queue_id_seq', 'UPDATE') AS auth_sync,
        has_sequence_privilege('anon', 'public.activity_logs_id_seq', 'USAGE')
          OR has_sequence_privilege('anon', 'public.activity_logs_id_seq', 'SELECT')
          OR has_sequence_privilege('anon', 'public.activity_logs_id_seq', 'UPDATE') AS anon_activity,
        has_sequence_privilege('anon', 'public.customer_serial_seq', 'USAGE')
          OR has_sequence_privilege('anon', 'public.customer_serial_seq', 'SELECT')
          OR has_sequence_privilege('anon', 'public.customer_serial_seq', 'UPDATE') AS anon_customer,
        has_sequence_privilege('anon', 'public.sync_queue_id_seq', 'USAGE')
          OR has_sequence_privilege('anon', 'public.sync_queue_id_seq', 'SELECT')
          OR has_sequence_privilege('anon', 'public.sync_queue_id_seq', 'UPDATE') AS anon_sync,
        has_sequence_privilege('service_role', 'public.activity_logs_id_seq', 'USAGE')
          AND has_sequence_privilege('service_role', 'public.activity_logs_id_seq', 'SELECT')
          AND has_sequence_privilege('service_role', 'public.activity_logs_id_seq', 'UPDATE') AS service_activity,
        has_sequence_privilege('service_role', 'public.customer_serial_seq', 'USAGE')
          AND has_sequence_privilege('service_role', 'public.customer_serial_seq', 'SELECT')
          AND has_sequence_privilege('service_role', 'public.customer_serial_seq', 'UPDATE') AS service_customer,
        has_sequence_privilege('service_role', 'public.sync_queue_id_seq', 'USAGE')
          AND has_sequence_privilege('service_role', 'public.sync_queue_id_seq', 'SELECT')
          AND has_sequence_privilege('service_role', 'public.sync_queue_id_seq', 'UPDATE') AS service_sync;
    `);
    assert.deepEqual(
      Object.values(sequencePrivileges.rows[0]),
      [false, false, false, false, false, false, true, true, true],
    );

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.second, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );

    const visibleProfiles = await db.query("SELECT count(*)::int AS count FROM public.profiles");
    assert.equal(visibleProfiles.rows[0].count, 3);
    const firstAdminAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(firstAdminAuthorization.rows[0].authorized, true);

    await db.query(
      "SELECT set_config('request.jwt.claim.sub', $1, false)",
      ["99999999-9999-4999-8999-999999999999"],
    );
    const missingProfileAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(missingProfileAuthorization.rows[0].authorized, false);

    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.first, "d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    const firstEmailSecondUserAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(firstEmailSecondUserAuthorization.rows[0].authorized, true);

    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.second, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const secondEmailFirstUserAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(secondEmailFirstUserAuthorization.rows[0].authorized, true);

    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.second, "d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    const secondAdminAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(secondAdminAuthorization.rows[0].authorized, true);

    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );

    await db.query(
      "UPDATE public.profiles SET role = 'staff' WHERE user_id = $1::uuid",
      ["d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.second, "d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    const nonAdminRoleAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(nonAdminRoleAuthorization.rows[0].authorized, false);
    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    await db.query(
      "UPDATE public.profiles SET role = 'admin' WHERE user_id = $1::uuid",
      ["d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );

    await assert.rejects(
      db.query("SELECT public.customers_guard()"),
      /permission denied|trigger functions can only be called as triggers/i,
    );
    await assert.rejects(
      db.query("SELECT nextval('public.customer_serial_seq')"),
      /permission denied/i,
    );

    const auditBefore = await db.query(
      "SELECT count(*)::int AS count FROM public.activity_logs",
    );

    const created = await db.query(
      `SELECT (public.create_customer(
        ' Exact Behavior ', CURRENT_DATE, 1200, ' Place ', ' 1234567 ',
        'solar@example.com', 'CID-1', ' Address '
      )).id::text AS id`,
    );
    const customerId = created.rows[0].id;
    await db.exec("RESET ROLE");
    const serialBeforePrivilegeBoundaryChecks = await db.query(
      "SELECT last_value, is_called FROM public.customer_serial_seq",
    );
    await db.exec("SET ROLE authenticated");
    const customer = await db.query(
      "SELECT serial_no, customer_code, name, contract_value, created_by::text FROM public.customers WHERE id = $1",
      [customerId],
    );
    assert.equal(customer.rows[0].serial_no, 1);
    assert.equal(customer.rows[0].customer_code, "CUST-0001");
    assert.equal(customer.rows[0].name, "Exact Behavior");
    assert.equal(Number(customer.rows[0].contract_value), 1200);
    assert.equal(customer.rows[0].created_by, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f");

    const unauthorizedIdentityCases = [
      {
        email: EMAILS.first,
        subject: "33333333-3333-4333-8333-333333333333",
      },
      {
        email: EMAILS.second,
        subject: "55555555-5555-4555-8555-555555555555",
      },
    ];
    for (const testCase of unauthorizedIdentityCases) {
      await db.query(
        "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
        [testCase.email, testCase.subject],
      );
      const unauthorizedIdentityCustomers = await db.query(
        "SELECT id FROM public.customers",
      );
      assert.equal(unauthorizedIdentityCustomers.rows.length, 0);

      const unauthorizedIdentityUpdate = await db.query(
        "UPDATE public.customers SET name = 'Unauthorized Identity Change' WHERE id = $1 RETURNING id",
        [customerId],
      );
      assert.equal(unauthorizedIdentityUpdate.rows.length, 0);
      await assert.rejects(
        db.query("INSERT INTO public.customers (name) VALUES ('Unauthorized Identity Insert')"),
        /row-level security|not authorized/i,
      );
    }

    await db.exec("RESET ROLE");
    const serialAfterUnauthorizedAttempts = await db.query(
      "SELECT last_value, is_called FROM public.customer_serial_seq",
    );
    assert.deepEqual(
      serialAfterUnauthorizedAttempts.rows,
      serialBeforePrivilegeBoundaryChecks.rows,
      "unapproved authenticated identities must not consume customer serials",
    );
    const crossIdentityUnchangedCustomer = await db.query(
      "SELECT name FROM public.customers WHERE id = $1",
      [customerId],
    );
    assert.equal(crossIdentityUnchangedCustomer.rows[0].name, "Exact Behavior");
    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.second, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const uuidAdminSeesCustomerWithMismatchedEmail = await db.query(
      "SELECT count(*)::int AS count FROM public.customers",
    );
    assert.equal(uuidAdminSeesCustomerWithMismatchedEmail.rows[0].count, 1);

    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.unauthorized, "33333333-3333-4333-8333-333333333333"],
    );
    const nonAdminProfileMutation = await db.query(
      "UPDATE public.profiles SET role = 'admin', active = true WHERE user_id = $1::uuid RETURNING user_id",
      ["33333333-3333-4333-8333-333333333333"],
    );
    assert.equal(nonAdminProfileMutation.rows.length, 0);
    await db.exec("RESET ROLE");
    const unchangedNonAdminProfile = await db.query(`
      SELECT role::text, active
      FROM public.profiles
      WHERE user_id = '33333333-3333-4333-8333-333333333333';
    `);
    assert.deepEqual(unchangedNonAdminProfile.rows[0], {
      role: "staff",
      active: false,
    });

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );

    await db.query(
      "UPDATE public.profiles SET active = false WHERE user_id = $1::uuid",
      ["d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.second, "d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    const inactiveAdminAuthorization = await db.query(
      "SELECT public.is_authorized_admin_user() AS authorized",
    );
    assert.equal(inactiveAdminAuthorization.rows[0].authorized, false);
    const inactiveProfileMutation = await db.query(
      "UPDATE public.profiles SET role = 'staff', active = true WHERE user_id = $1::uuid RETURNING user_id",
      ["d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    assert.equal(inactiveProfileMutation.rows.length, 0);
    const inactiveAdminUpdate = await db.query(
      "UPDATE public.customers SET name = 'Inactive Admin Change' WHERE id = $1 RETURNING id",
      [customerId],
    );
    assert.equal(inactiveAdminUpdate.rows.length, 0);
    await assert.rejects(
      db.query("INSERT INTO public.customers (name) VALUES ('Inactive Admin Insert')"),
      /row-level security|not authorized/i,
    );
    await db.exec("RESET ROLE");
    const unchangedInactiveAdminProfile = await db.query(`
      SELECT role::text, active
      FROM public.profiles
      WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830';
    `);
    assert.deepEqual(unchangedInactiveAdminProfile.rows[0], {
      role: "admin",
      active: false,
    });
    await db.exec("RESET ROLE");
    const unchangedCustomerAfterInactiveAdminAttempts = await db.query(
      "SELECT name, contract_value FROM public.customers WHERE id = $1",
      [customerId],
    );
    assert.equal(unchangedCustomerAfterInactiveAdminAttempts.rows[0].name, "Exact Behavior");
    assert.equal(
      Number(unchangedCustomerAfterInactiveAdminAttempts.rows[0].contract_value),
      1200,
    );
    const serialAfterInactiveAdminAttempts = await db.query(
      "SELECT last_value, is_called FROM public.customer_serial_seq",
    );
    assert.deepEqual(
      serialAfterInactiveAdminAttempts.rows,
      serialBeforePrivilegeBoundaryChecks.rows,
      "inactive Admin must not consume customer serials",
    );
    await db.exec("SET ROLE authenticated");

    await db.query(
      "SELECT set_config('request.jwt.claim.email', $1, false), set_config('request.jwt.claim.sub', $2, false)",
      [EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    const activeAdminUpdate = await db.query(
      "UPDATE public.customers SET name = name WHERE id = $1 RETURNING id",
      [customerId],
    );
    assert.equal(activeAdminUpdate.rows.length, 1);
    await db.query(
      "UPDATE public.profiles SET active = true WHERE user_id = $1::uuid",
      ["d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    await db.exec("RESET ROLE");

    await db.exec("SET ROLE anon");
    await assert.rejects(
      db.query(
        "UPDATE public.profiles SET role = 'admin', active = true WHERE user_id = $1::uuid",
        ["33333333-3333-4333-8333-333333333333"],
      ),
      /permission denied/i,
    );
    await db.exec("RESET ROLE");
    const unchangedAfterAnonProfileMutation = await db.query(`
      SELECT role::text, active
      FROM public.profiles
      WHERE user_id = '33333333-3333-4333-8333-333333333333';
    `);
    assert.deepEqual(unchangedAfterAnonProfileMutation.rows[0], {
      role: "staff",
      active: false,
    });
    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );

    const details = await db.query(
      "SELECT place, phone, consumer_id, address FROM public.customer_details WHERE customer_id = $1",
      [customerId],
    );
    assert.deepEqual(details.rows[0], {
      place: "Place",
      phone: "1234567",
      consumer_id: "CID-1",
      address: "Address",
    });
    const detailInsertAudit = await db.query(`
      SELECT action, entity_type, entity_id
      FROM public.activity_logs
      WHERE entity_type = 'customer_details' AND entity_id = $1
      ORDER BY id;
    `, [customerId]);
    assert.deepEqual(detailInsertAudit.rows, [{
      action: "insert",
      entity_type: "customer_details",
      entity_id: customerId,
    }]);

    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE public.sync_queue SET status = 'processing' WHERE entity_id = $1",
      [customerId],
    );
    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    await db.query(
      "UPDATE public.customer_details SET address = 'Updated Address' WHERE customer_id = $1",
      [customerId],
    );
    const detailUpdateAudit = await db.query(`
      SELECT action, entity_type, entity_id
      FROM public.activity_logs
      WHERE entity_type = 'customer_details' AND entity_id = $1
      ORDER BY id;
    `, [customerId]);
    assert.deepEqual(
      detailUpdateAudit.rows.map((row) => row.action),
      ["insert", "update"],
    );
    assert(detailUpdateAudit.rows.every((row) => row.entity_type === "customer_details"));
    const detailUpdateSync = await db.query(`
      SELECT status::text
      FROM public.sync_queue
      WHERE entity_id = $1
      ORDER BY id;
    `, [customerId]);
    assert.deepEqual(detailUpdateSync.rows.map((row) => row.status), [
      "processing",
      "pending",
    ]);

    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE public.sync_queue SET status = 'processing' WHERE entity_id = $1 AND status = 'pending'",
      [customerId],
    );
    const queueCountBeforeDetailDelete = await db.query(
      "SELECT count(*)::int AS count FROM public.sync_queue WHERE entity_id = $1",
      [customerId],
    );
    await db.exec("SET ROLE postgres");
    await db.query(`
      SELECT
        set_config('request.jwt.claim.role', '', false),
        set_config('request.jwt.claim.email', '', false),
        set_config('request.jwt.claim.sub', '', false);
    `);
    await db.query(
      "DELETE FROM public.customer_details WHERE customer_id = $1",
      [customerId],
    );
    const detailDeleteAudit = await db.query(`
      SELECT action, entity_type, entity_id
      FROM public.activity_logs
      WHERE entity_type = 'customer_details' AND entity_id = $1
      ORDER BY id;
    `, [customerId]);
    assert.deepEqual(
      detailDeleteAudit.rows.map((row) => row.action),
      ["insert", "update", "delete"],
    );
    assert(detailDeleteAudit.rows.every((row) => row.entity_type === "customer_details"));
    const queueCountAfterDetailDelete = await db.query(
      "SELECT count(*)::int AS count FROM public.sync_queue WHERE entity_id = $1",
      [customerId],
    );
    assert.equal(
      queueCountAfterDetailDelete.rows[0].count,
      queueCountBeforeDetailDelete.rows[0].count,
      "deleting customer_details must not enqueue another sync job",
    );
    await db.exec("RESET ROLE");
    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );

    const search = await db.query(
      "SELECT customer_code, total_count FROM public.search_customers($1, false, 'name', 'asc', 25, 0)",
      ["Exact"],
    );
    assert.equal(search.rows.length, 1);
    assert.equal(search.rows[0].customer_code, "CUST-0001");
    assert.equal(Number(search.rows[0].total_count), 1);

    const specialSearchCases = [
      { name: "Literal % Marker", term: "%" },
      { name: "Literal _ Marker", term: "_" },
      { name: "Literal \\ Marker", term: "\\" },
    ];
    for (const testCase of specialSearchCases) {
      await db.query(
        "SELECT public.create_customer($1, CURRENT_DATE, 0)",
        [testCase.name],
      );
      const matches = await db.query(
        "SELECT name FROM public.search_customers($1, false, 'name', 'asc', 25, 0)",
        [testCase.term],
      );
      assert.deepEqual(
        matches.rows.map((row) => row.name),
        [testCase.name],
        `search term ${JSON.stringify(testCase.term)} should match only its literal character`,
      );
    }

    await assert.rejects(
      db.query("SELECT public.set_contract_value($1::uuid, 1500, '   ')", [customerId]),
      /reason is required/i,
    );
    await db.query(
      "SELECT public.set_contract_value($1::uuid, 1500, 'approved test reason')",
      [customerId],
    );
    const updatedValue = await db.query(
      "SELECT contract_value FROM public.customers WHERE id = $1",
      [customerId],
    );
    assert.equal(Number(updatedValue.rows[0].contract_value), 1500);

    const syncRows = await db.query(
      "SELECT count(*)::int AS count FROM public.sync_queue WHERE entity_id = $1",
      [customerId],
    );
    assert.equal(syncRows.rows[0].count, 3);
    const detailAudit = await db.query(`
      SELECT count(*)::int AS count
      FROM public.activity_logs
      WHERE entity_type = 'customer_details' AND entity_id = $1;
    `, [customerId]);
    assert.equal(detailAudit.rows[0].count, 3);
    const auditAfter = await db.query(
      "SELECT count(*)::int AS count FROM public.activity_logs",
    );
    assert.equal(auditAfter.rows[0].count - auditBefore.rows[0].count, 13);
    await db.exec("RESET ROLE");

    await db.exec("SET ROLE anon");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false)",
      ["anon"],
    );
    await assert.rejects(
      db.query("SELECT nextval('public.customer_serial_seq')"),
      /permission denied/i,
    );
    await db.exec("RESET ROLE");

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.second, "d2914556-10a7-4954-8ee0-8cdbdb649830"],
    );
    const secondCreated = await db.query(
      "SELECT (public.create_customer('Admin Two Customer', CURRENT_DATE, 0)).id::text AS id",
    );
    const secondCustomerId = secondCreated.rows[0].id;
    const secondCustomer = await db.query(
      "SELECT serial_no, customer_code FROM public.customers WHERE id = $1",
      [secondCustomerId],
    );
    assert.equal(secondCustomer.rows[0].serial_no, 5);
    assert.equal(secondCustomer.rows[0].customer_code, "CUST-0005");
    await db.query(
      "SELECT public.set_contract_value($1::uuid, 1800, 'admin two test reason')",
      [customerId],
    );
    await db.query(
      "UPDATE public.customers SET name = 'Admin Two Updated' WHERE id = $1",
      [secondCustomerId],
    );
    const secondUpdated = await db.query(
      "SELECT name FROM public.customers WHERE id = $1",
      [secondCustomerId],
    );
    assert.equal(secondUpdated.rows[0].name, "Admin Two Updated");
    await db.exec("RESET ROLE");

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.unauthorized, "33333333-3333-4333-8333-333333333333"],
    );
    const hiddenCustomers = await db.query("SELECT count(*)::int AS count FROM public.customers");
    assert.equal(hiddenCustomers.rows[0].count, 0);
    const hiddenProfiles = await db.query("SELECT count(*)::int AS count FROM public.profiles");
    assert.equal(hiddenProfiles.rows[0].count, 0);
    await assert.rejects(
      db.query("SELECT public.create_customer('Denied', CURRENT_DATE, 0)"),
    );
    await db.query(
      "UPDATE public.customers SET name = 'Unauthorized Change' WHERE id = $1",
      [customerId],
    );
    let unauthorizedInsertError;
    try {
      await db.query(`
        INSERT INTO public.customers (name, contract_date, contract_value)
        VALUES ('Unauthorized Direct Insert', CURRENT_DATE, 0);
      `);
    } catch (error) {
      unauthorizedInsertError = error;
    }
    assert(unauthorizedInsertError, "unauthorized direct customer insert must fail");
    assert.equal(unauthorizedInsertError.code, "42501");
    assert.match(
      unauthorizedInsertError.message,
      /not authorized to modify customers/i,
    );
    await db.exec("RESET ROLE");
    const unauthorizedUpdate = await db.query(
      "SELECT name, contract_value FROM public.customers WHERE id = $1",
      [customerId],
    );
    assert.equal(unauthorizedUpdate.rows[0].name, "Exact Behavior");
    assert.equal(Number(unauthorizedUpdate.rows[0].contract_value), 1800);

    await db.exec("SET ROLE service_role");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["service_role", "", ""],
    );
    const backendClaims = await db.query(
      "SELECT auth.role() AS role, auth.email() AS email",
    );
    assert.equal(backendClaims.rows[0].role, "service_role");
    assert.equal(backendClaims.rows[0].email, "");
    const backendInsert = await db.query(`
      INSERT INTO public.customers (name, contract_date, contract_value)
      VALUES ('Trusted Backend Customer', CURRENT_DATE, 0)
      RETURNING id::text, serial_no, customer_code, created_by;
    `);
    assert.equal(backendInsert.rows[0].serial_no, 6);
    assert.equal(backendInsert.rows[0].customer_code, "CUST-0006");
    assert.equal(backendInsert.rows[0].created_by, null);
    await db.exec("RESET ROLE");
    const backendEffects = await db.query(`
      SELECT
        (SELECT count(*)::int FROM public.activity_logs
          WHERE entity_type = 'customer' AND entity_id = $1) AS audit_rows,
        (SELECT count(*)::int FROM public.sync_queue
          WHERE entity_id = $1::uuid) AS sync_rows;
    `, [backendInsert.rows[0].id]);
    assert.deepEqual(backendEffects.rows[0], { audit_rows: 1, sync_rows: 1 });

    await db.exec("SET ROLE postgres");
    await db.query(`
      SELECT
        set_config('request.jwt.claim.role', '', false),
        set_config('request.jwt.claim.email', '', false),
        set_config('request.jwt.claim.sub', '', false);
    `);
    const maintenanceClaims = await db.query(
      "SELECT auth.role() AS role, auth.email() AS email, auth.uid() AS user_id",
    );
    assert.deepEqual(maintenanceClaims.rows[0], {
      role: "",
      email: "",
      user_id: null,
    });
    let maintenanceInsertError;
    try {
      await db.query(`
        INSERT INTO public.customers (name, contract_date, contract_value)
        VALUES ('Postgres Maintenance Customer', CURRENT_DATE, 0);
      `);
    } catch (error) {
      maintenanceInsertError = error;
    }
    assert(maintenanceInsertError, "postgres maintenance insert must follow explicit trigger authorization");
    assert.equal(maintenanceInsertError.code, "42501");
    assert.match(
      maintenanceInsertError.message,
      /not authorized to modify customers/i,
    );
    await db.exec("RESET ROLE");

    await db.query(
      "UPDATE auth.users SET email = 'temporary-email-test@example.com' WHERE id = $1::uuid",
      ["6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );
    await assert.rejects(
      db.exec(`
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES ('44444444-4444-4444-8444-444444444444', '${EMAILS.first}', '{}');
      `),
      /not authorized/i,
    );
    const rejectedSignup = await db.query(`
      SELECT count(*)::int AS count
      FROM auth.users
      WHERE id = '44444444-4444-4444-8444-444444444444';
    `);
    assert.equal(rejectedSignup.rows[0].count, 0);
    await db.query(
      "UPDATE auth.users SET email = $1 WHERE id = $2::uuid",
      [EMAILS.first, "6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f"],
    );

    console.log("PASS: production Auth UUIDs, not test fixture IDs, define the admin allowlist");
    console.log("PASS: migration applies twice without profile/audit/sync side effects");
    console.log("PASS: customer RPC signatures and return contracts are preserved");
    console.log("PASS: claim_sync_jobs and complete_sync_job definitions, defaults, owners, security settings, and restricted EXECUTE ACLs are unchanged");
    console.log("PASS: RLS policies and table grants match all five live tables");
    console.log("PASS: profile column UPDATE grants, table-level UPDATE denial, anon denial, and admin RLS policy");
    console.log("PASS: profiles is postgres-owned with RLS enabled and FORCE RLS disabled");
    console.log("PASS: approved UUID signup is independent of email; approved email alone cannot authorize a new UUID");
    console.log("PASS: auth.users email and NULL updates synchronize profiles.email without changing role or active");
    console.log("PASS: changed email is synchronized independently; UUID authorization ignores email claims");
    console.log("PASS: authorization requires an allowlisted Auth UUID and matching active Admin profile");
    console.log("PASS: non-allowlisted UUIDs are denied by customer SELECT, UPDATE, and INSERT policies despite approved email claims");
    console.log("PASS: inactive admin cannot modify customers while the other active admin retains access");
    console.log("PASS: non-admin and inactive-admin profile role/active changes are blocked by RLS");
    console.log("PASS: anon profile role/active changes are blocked by table privileges");
    console.log("PASS: all seven flagged functions have fixed search_path");
    console.log("PASS: literal %, _, and backslash searches match only their intended customer records");
    console.log("PASS: both approved admins create customers with consecutive numbers and update customer data");
    console.log("PASS: direct serial allocation and trigger-function execution are denied");
    console.log("PASS: anon, authenticated (including inactive Admin), and service_role cannot directly execute trigger functions");
    console.log("PASS: activity and sync triggers record customer and details changes");
    console.log("PASS: customer_details audit uses the exact plural entity type; INSERT and UPDATE enqueue, DELETE does not");
    console.log("PASS: anonymous and authenticated sequence privileges are revoked");
    console.log("PASS: unauthorized authenticated INSERT fails with SQLSTATE 42501 and the trigger denial message");
    console.log("PASS: service_role JWT with no email can insert through the trigger and audit/sync remain functional");
    console.log("PASS: postgres with cleared JWT claims is denied by the trigger with SQLSTATE 42501");
    console.log("PASS: unauthorized database access, modification, and signup are denied");
    console.log("PASS: unapproved identities and inactive Admin cannot alter customers or consume serial numbers");
  } finally {
    await db.close();
  }

  await testNoApprovedAdminState(draft);
  console.log("PASS: no-approved-admin state preserves legacy profiles while RLS denies access");
  await testProfileRollback(draft);
  console.log("PASS: rollback restores the pre-deployment inactive Staff profile while retaining the other active Admin");
  await testAtomicRollback(draft);
  console.log("PASS: transaction rollback restores function definitions/owners/settings/ACLs, table/column grants and RLS, triggers, indexes, profiles, audit, and sync data");
}

async function testNoApprovedAdminState(draft) {
  const db = new PGlite();
  try {
    await db.exec(liveSchema);
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('55555555-5555-4555-8555-555555555555', '${EMAILS.unauthorized}', '{}');
    `);
    await db.exec(draft);

    const legacyProfile = await db.query(`
      SELECT role::text, active
      FROM public.profiles
      WHERE user_id = '55555555-5555-4555-8555-555555555555';
    `);
    assert.deepEqual(legacyProfile.rows[0], { role: "admin", active: true });

    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.email', $2, false), set_config('request.jwt.claim.sub', $3, false)",
      ["authenticated", EMAILS.unauthorized, "55555555-5555-4555-8555-555555555555"],
    );
    const visibleProfiles = await db.query(
      "SELECT count(*)::int AS count FROM public.profiles",
    );
    const visibleCustomers = await db.query(
      "SELECT count(*)::int AS count FROM public.customers",
    );
    assert.equal(visibleProfiles.rows[0].count, 0);
    assert.equal(visibleCustomers.rows[0].count, 0);
  } finally {
    await db.close();
  }
}

async function testProfileRollback(draft) {
  const db = new PGlite();
  try {
    await db.exec(liveSchema);
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f', '${EMAILS.first}', '{"full_name":"Admin One"}'),
        ('d2914556-10a7-4954-8ee0-8cdbdb649830', '${EMAILS.second}', '{"full_name":"Admin Two"}');

      CREATE TEMP TABLE predeployment_profile_snapshot ON COMMIT PRESERVE ROWS AS
      SELECT user_id, full_name, email, role, active
      FROM public.profiles
      WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830';
    `);

    const before = await db.query(`
      SELECT role::text, active
      FROM public.profiles
      WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830';
    `);
    assert.deepEqual(before.rows[0], { role: "staff", active: false });

    await db.exec(draft);
    const afterMigration = await db.query(`
      SELECT role::text, active
      FROM public.profiles
      WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830';
    `);
    assert.deepEqual(afterMigration.rows[0], { role: "admin", active: true });

    await db.exec(`
      BEGIN;
      UPDATE public.profiles p
      SET full_name = snapshot.full_name,
          email = snapshot.email,
          role = snapshot.role,
          active = snapshot.active
      FROM predeployment_profile_snapshot snapshot
      WHERE p.user_id = snapshot.user_id;
      COMMIT;
    `);
    const restored = await db.query(`
      SELECT full_name, email, role::text, active
      FROM public.profiles
      WHERE user_id = 'd2914556-10a7-4954-8ee0-8cdbdb649830';
    `);
    assert.deepEqual(restored.rows[0], {
      full_name: "Admin Two",
      email: EMAILS.second,
      role: "staff",
      active: false,
    });

    const retainedAdmin = await db.query(`
      SELECT role::text, active
      FROM public.profiles
      WHERE user_id = '6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f';
    `);
    assert.deepEqual(retainedAdmin.rows[0], { role: "admin", active: true });
  } finally {
    await db.close();
  }
}

async function testAtomicRollback(draft) {
  const db = new PGlite();
  try {
    await db.exec(liveSchema);
    await db.exec(`
      ALTER FUNCTION public.customers_guard() SET search_path = '';
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f', '${EMAILS.first}', '{"full_name":"Admin One"}'),
        ('d2914556-10a7-4954-8ee0-8cdbdb649830', '${EMAILS.second}', '{"full_name":"Admin Two"}');
    `);

    const before = await captureRollbackState(db);

    await db.exec("BEGIN");
    await db.exec(draft);
    await assert.rejects(db.exec("SELECT 1 / 0"), /division by zero/i);
    await db.exec("ROLLBACK");

    const after = await captureRollbackState(db);
    assert.deepEqual(after, before);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
