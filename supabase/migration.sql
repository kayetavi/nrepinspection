-- ============================================================================
-- NREP / KayetDMS — Supabase PostgreSQL Schema & Hardened RLS Migration
-- ============================================================================

-- 1. Equipment Master Table
CREATE TABLE IF NOT EXISTS public.equipment (
  id text PRIMARY KEY,
  "Unit" text NOT NULL DEFAULT 'RPTU',
  "SubUnit" text DEFAULT '',
  "SystemNo" text NOT NULL DEFAULT '',
  "EquipmentTagNo" text NOT NULL,
  "EquipmentDescription" text DEFAULT '',
  "EquipmentType" text DEFAULT '',
  "FormatIStatus" text DEFAULT 'Not Issued',
  "FormatIDate" text DEFAULT '',
  "FormatIIStatus" text DEFAULT 'Not Issued',
  "FormatIIDate" text DEFAULT '',
  "FormatIIIStatus" text DEFAULT 'Not Issued',
  "FormatIIIDate" text DEFAULT '',
  "InternalInspectionStatus" text DEFAULT 'No',
  "BaseLineUTG" text DEFAULT 'No',
  "PunchPointsCategoryClosed" text DEFAULT '',
  "FinalSystemAcceptance" text DEFAULT 'Not accept',
  "DocumentDrawing" text DEFAULT '',
  "Remarks" text DEFAULT '',
  "AreaPackage" text DEFAULT '',
  "RFINo" text DEFAULT '',
  "CategoryAStatus" text DEFAULT '',
  "MediaFillingClearance" text DEFAULT '',
  "LastInspectionDate" text DEFAULT '',
  "ResponsibleAgency" text DEFAULT '',
  "Link" text DEFAULT '',
  "updatedBy" text DEFAULT '',
  "updatedAt" text DEFAULT ''
);

-- 2. Users Table (uid corresponds to Supabase Auth auth.uid()::text)
CREATE TABLE IF NOT EXISTS public.users (
  uid text PRIMARY KEY,
  email text NOT NULL,
  "displayName" text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'lead_engineer', 'engineer', 'inspector', 'editor', 'viewer')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'suspended')),
  password text,
  "assignedUnits" text DEFAULT 'All',
  "createdAt" text DEFAULT '',
  "lastLoginAt" text DEFAULT ''
);

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'lead_engineer', 'engineer', 'inspector', 'editor', 'viewer'));

-- 3. Admins Table (uid corresponds to Supabase Auth auth.uid()::text)
CREATE TABLE IF NOT EXISTS public.admins (
  uid text PRIMARY KEY,
  email text NOT NULL,
  "assignedAt" text DEFAULT ''
);

-- 4. Audit Logs Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id text PRIMARY KEY,
  action text NOT NULL,
  target text NOT NULL,
  "userEmail" text NOT NULL,
  timestamp text NOT NULL,
  details text DEFAULT ''
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_equipment_unit ON public.equipment ("Unit");
CREATE INDEX IF NOT EXISTS idx_equipment_tag ON public.equipment ("EquipmentTagNo");
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs (timestamp DESC);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.equipment  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 7. Drop any legacy unrestricted public policies
DROP POLICY IF EXISTS "equipment_select_policy"  ON public.equipment;
DROP POLICY IF EXISTS "equipment_write_policy"   ON public.equipment;
DROP POLICY IF EXISTS "users_access_policy"      ON public.users;
DROP POLICY IF EXISTS "admins_access_policy"     ON public.admins;
DROP POLICY IF EXISTS "audit_logs_access_policy" ON public.audit_logs;

-- 8. Role-Based Authorization Helper Functions (bound to auth.uid())
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT u.role
      FROM public.users u
      WHERE (u.uid = auth.uid()::text OR lower(u.email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
        AND u.status = 'approved'
      LIMIT 1
    ),
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.admins a
        WHERE a.uid = auth.uid()::text
           OR lower(a.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      ) THEN 'admin'
      ELSE NULL
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.get_my_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.admins a
      WHERE a.uid = auth.uid()::text
         OR lower(a.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE (u.uid = auth.uid()::text OR lower(u.email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
        AND u.status = 'approved'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_equipment()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin()
    OR public.get_my_role() IN ('admin', 'lead_engineer', 'engineer', 'inspector', 'editor')
  );
$$;

-- 9. Strict Authenticated RLS Policies (No public USING(true) policies)

-- public.admins
DROP POLICY IF EXISTS "admins_select_authenticated" ON public.admins;
CREATE POLICY "admins_select_authenticated"
  ON public.admins FOR SELECT TO authenticated
  USING (public.is_admin() OR uid = auth.uid()::text);

DROP POLICY IF EXISTS "admins_insert_admin_only" ON public.admins;
CREATE POLICY "admins_insert_admin_only"
  ON public.admins FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins_update_admin_only" ON public.admins;
CREATE POLICY "admins_update_admin_only"
  ON public.admins FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins_delete_admin_only" ON public.admins;
CREATE POLICY "admins_delete_admin_only"
  ON public.admins FOR DELETE TO authenticated
  USING (public.is_admin() AND uid <> auth.uid()::text);

-- public.users
DROP POLICY IF EXISTS "users_select_self_or_admin" ON public.users;
CREATE POLICY "users_select_self_or_admin"
  ON public.users FOR SELECT TO authenticated
  USING (
    uid = auth.uid()::text
    OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "users_insert_admin_only" ON public.users;
CREATE POLICY "users_insert_admin_only"
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_update_admin_or_safe_self" ON public.users;
CREATE POLICY "users_update_admin_or_safe_self"
  ON public.users FOR UPDATE TO authenticated
  USING (public.is_admin() OR uid = auth.uid()::text)
  WITH CHECK (
    (
      public.is_admin()
      AND uid <> auth.uid()::text
      AND lower(email) <> lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
    OR
    (
      uid = auth.uid()::text
      AND role = (SELECT u_old.role FROM public.users u_old WHERE u_old.uid = auth.uid()::text)
      AND status = (SELECT u_old.status FROM public.users u_old WHERE u_old.uid = auth.uid()::text)
      AND COALESCE("assignedUnits", 'All') = COALESCE(
        (SELECT u_old."assignedUnits" FROM public.users u_old WHERE u_old.uid = auth.uid()::text),
        'All'
      )
    )
  );

DROP POLICY IF EXISTS "users_delete_admin_only" ON public.users;
CREATE POLICY "users_delete_admin_only"
  ON public.users FOR DELETE TO authenticated
  USING (
    public.is_admin()
    AND uid <> auth.uid()::text
    AND lower(email) <> lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

-- public.audit_logs (append-only for authenticated users; read-only for admin/lead_engineer; no update/delete)
DROP POLICY IF EXISTS "audit_logs_select_admin_or_lead" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin_or_lead"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_admin() OR public.get_my_role() = 'lead_engineer');

DROP POLICY IF EXISTS "audit_logs_insert_authenticated_only" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_authenticated_only"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_authenticated_approved_user());

-- public.equipment
DROP POLICY IF EXISTS "equipment_select_authenticated" ON public.equipment;
CREATE POLICY "equipment_select_authenticated"
  ON public.equipment FOR SELECT TO authenticated
  USING (public.is_authenticated_approved_user());

DROP POLICY IF EXISTS "equipment_insert_authorized_roles" ON public.equipment;
CREATE POLICY "equipment_insert_authorized_roles"
  ON public.equipment FOR INSERT TO authenticated
  WITH CHECK (public.can_write_equipment());

DROP POLICY IF EXISTS "equipment_update_authorized_roles" ON public.equipment;
CREATE POLICY "equipment_update_authorized_roles"
  ON public.equipment FOR UPDATE TO authenticated
  USING (public.can_write_equipment()) WITH CHECK (public.can_write_equipment());

DROP POLICY IF EXISTS "equipment_delete_admin_only" ON public.equipment;
CREATE POLICY "equipment_delete_admin_only"
  ON public.equipment FOR DELETE TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.admins     FROM anon;
REVOKE ALL ON public.users      FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.equipment  FROM anon;
