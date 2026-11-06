-- ============================================================================
-- KayetDMS / NREP — Critical Supabase RLS Security Remediation
-- ============================================================================
-- Fixes audit findings:
--   - public.admins:     Replaces unrestricted public ALL policy with strict authenticated RBAC
--   - public.users:      Replaces unrestricted public ALL policy with strict authenticated RBAC + self-role protection
--   - public.audit_logs: Replaces unrestricted public ALL policy with non-public append-only audit trail
--   - public.equipment:  Replaces unrestricted public SELECT/ALL policies with role-based authenticated policies
-- ============================================================================

BEGIN;

-- 1. Expand role constraint on public.users to support all 5 required roles + legacy editor
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'lead_engineer', 'engineer', 'inspector', 'editor', 'viewer'));

-- 2. Enable & Force Row Level Security on all 4 tables
ALTER TABLE public.admins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment  ENABLE ROW LEVEL SECURITY;

-- 3. Drop ALL legacy unrestricted public policies
DROP POLICY IF EXISTS "admins_access_policy"     ON public.admins;
DROP POLICY IF EXISTS "users_access_policy"      ON public.users;
DROP POLICY IF EXISTS "audit_logs_access_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "equipment_select_policy"  ON public.equipment;
DROP POLICY IF EXISTS "equipment_write_policy"   ON public.equipment;

-- Drop any previously created remediation policies so this script is idempotent
DROP POLICY IF EXISTS "admins_select_authenticated"           ON public.admins;
DROP POLICY IF EXISTS "admins_insert_admin_only"              ON public.admins;
DROP POLICY IF EXISTS "admins_update_admin_only"              ON public.admins;
DROP POLICY IF EXISTS "admins_delete_admin_only"              ON public.admins;

DROP POLICY IF EXISTS "users_select_self_or_admin"            ON public.users;
DROP POLICY IF EXISTS "users_insert_admin_only"               ON public.users;
DROP POLICY IF EXISTS "users_update_admin_or_safe_self"       ON public.users;
DROP POLICY IF EXISTS "users_delete_admin_only"               ON public.users;

DROP POLICY IF EXISTS "audit_logs_select_admin_or_lead"       ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_authenticated_only"  ON public.audit_logs;

DROP POLICY IF EXISTS "equipment_select_authenticated"        ON public.equipment;
DROP POLICY IF EXISTS "equipment_insert_authorized_roles"     ON public.equipment;
DROP POLICY IF EXISTS "equipment_update_authorized_roles"     ON public.equipment;
DROP POLICY IF EXISTS "equipment_delete_admin_only"           ON public.equipment;

-- 4. Create SECURITY DEFINER helper functions bound to Supabase Auth JWT identity (auth.uid())
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
RETURNS NULL ON NULL INPUT
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

REVOKE ALL ON FUNCTION public.get_my_role()                    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin()                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_authenticated_approved_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_equipment()            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_role()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_authenticated_approved_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_equipment()            TO authenticated;

-- ============================================================================
-- 5. TABLE POLICIES: public.admins
--    - Only administrators or the matching authenticated user can view admin row
--    - Only authorized administrators can INSERT, UPDATE, or DELETE admins
--    - An administrator cannot delete their own admin row
-- ============================================================================

CREATE POLICY "admins_select_authenticated"
  ON public.admins
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR uid = auth.uid()::text
  );

CREATE POLICY "admins_insert_admin_only"
  ON public.admins
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
  );

CREATE POLICY "admins_update_admin_only"
  ON public.admins
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
  )
  WITH CHECK (
    public.is_admin()
  );

CREATE POLICY "admins_delete_admin_only"
  ON public.admins
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin() AND uid <> auth.uid()::text
  );

-- ============================================================================
-- 6. TABLE POLICIES: public.users
--    - SELECT: Own profile (uid = auth.uid()::text) or Administrator
--    - INSERT: Only authorized administrators can create user profiles
--    - UPDATE:
--        * Administrators can update other users' profiles/roles, OR update
--          their own non-role/non-status fields
--        * Non-admin users can only update their own profile AND must never
--          modify their own role, status, or assignedUnits
--    - DELETE: Only authorized administrators can delete users (never self)
-- ============================================================================

CREATE POLICY "users_select_self_or_admin"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (
    uid = auth.uid()::text
    OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    OR public.is_admin()
  );

CREATE POLICY "users_insert_admin_only"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
  );

CREATE POLICY "users_update_admin_or_safe_self"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() OR uid = auth.uid()::text
  )
  WITH CHECK (
    (
      -- Admin updating another user
      public.is_admin()
      AND uid <> auth.uid()::text
      AND lower(email) <> lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
    OR
    (
      -- Any user (including admin) updating their OWN row:
      -- role, status, and assignedUnits MUST remain unchanged (Requirement 5)
      uid = auth.uid()::text
      AND role = (SELECT u_old.role FROM public.users u_old WHERE u_old.uid = auth.uid()::text)
      AND status = (SELECT u_old.status FROM public.users u_old WHERE u_old.uid = auth.uid()::text)
      AND COALESCE("assignedUnits", 'All') = COALESCE(
        (SELECT u_old."assignedUnits" FROM public.users u_old WHERE u_old.uid = auth.uid()::text),
        'All'
      )
    )
  );

CREATE POLICY "users_delete_admin_only"
  ON public.users
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
    AND uid <> auth.uid()::text
    AND lower(email) <> lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

-- ============================================================================
-- 7. TABLE POLICIES: public.audit_logs
--    - SELECT: Strictly non-public; only 'admin' and 'lead_engineer'
--    - INSERT: Authenticated approved users only (append-only)
--    - UPDATE: No policy (DENIED for all client roles)
--    - DELETE: No policy (DENIED for all client roles)
-- ============================================================================

CREATE POLICY "audit_logs_select_admin_or_lead"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR public.get_my_role() = 'lead_engineer'
  );

CREATE POLICY "audit_logs_insert_authenticated_only"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_authenticated_approved_user()
  );

-- ============================================================================
-- 8. TABLE POLICIES: public.equipment
--    - SELECT: Authenticated approved users only (admin, lead_engineer, engineer, inspector, editor, viewer)
--    - INSERT: Authorized write roles only (admin, lead_engineer, engineer, inspector, editor)
--    - UPDATE: Authorized write roles only (admin, lead_engineer, engineer, inspector, editor)
--    - DELETE: Authorized administrators only (admin)
-- ============================================================================

CREATE POLICY "equipment_select_authenticated"
  ON public.equipment
  FOR SELECT
  TO authenticated
  USING (
    public.is_authenticated_approved_user()
  );

CREATE POLICY "equipment_insert_authorized_roles"
  ON public.equipment
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_equipment()
  );

CREATE POLICY "equipment_update_authorized_roles"
  ON public.equipment
  FOR UPDATE
  TO authenticated
  USING (
    public.can_write_equipment()
  )
  WITH CHECK (
    public.can_write_equipment()
  );

CREATE POLICY "equipment_delete_admin_only"
  ON public.equipment
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
  );

-- 9. Revoke direct table privileges from anon so anonymous requests are blocked at both Grant and RLS layers
REVOKE ALL ON public.admins     FROM anon;
REVOKE ALL ON public.users      FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.equipment  FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admins     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users      TO authenticated;
GRANT SELECT, INSERT                 ON public.audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment  TO authenticated;

COMMIT;
