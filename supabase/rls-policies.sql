-- EventArk Multi-tenant RLS Policies
-- Run AFTER schema.sql in Supabase SQL Editor

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_orders ENABLE ROW LEVEL SECURITY;

-- ─── projects: tenant isolation ───
DROP POLICY IF EXISTS "eventark_tenant_projects_all" ON projects;
CREATE POLICY "eventark_tenant_projects_all"
  ON projects FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "eventark_public_read_projects" ON projects;
CREATE POLICY "eventark_public_read_projects"
  ON projects FOR SELECT
  TO anon
  USING (true);

-- ─── project_configs: owner via project ───
DROP POLICY IF EXISTS "eventark_tenant_configs_all" ON project_configs;
CREATE POLICY "eventark_tenant_configs_all"
  ON project_configs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_configs.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_configs.project_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "eventark_public_read_project_configs" ON project_configs;
CREATE POLICY "eventark_public_read_project_configs"
  ON project_configs FOR SELECT
  TO anon
  USING (true);

-- ─── guests: owner write, public read for H5 check-in ───
DROP POLICY IF EXISTS "eventark_tenant_guests_all" ON guests;
CREATE POLICY "eventark_tenant_guests_all"
  ON guests FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = guests.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = guests.project_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "eventark_public_read_guests" ON guests;
CREATE POLICY "eventark_public_read_guests"
  ON guests FOR SELECT
  TO anon
  USING (true);

-- ─── checkin_logs: public insert for H5, owner read ───
DROP POLICY IF EXISTS "eventark_public_insert_checkin_logs" ON checkin_logs;
CREATE POLICY "eventark_public_insert_checkin_logs"
  ON checkin_logs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "eventark_tenant_read_checkin_logs" ON checkin_logs;
CREATE POLICY "eventark_tenant_read_checkin_logs"
  ON checkin_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = checkin_logs.project_id AND p.user_id = auth.uid()
    )
  );

-- ─── user_subscriptions: own row only ───
DROP POLICY IF EXISTS "eventark_own_subscription" ON user_subscriptions;
CREATE POLICY "eventark_own_subscription"
  ON user_subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ─── tenant_orders: own rows only ───
DROP POLICY IF EXISTS "eventark_own_orders" ON tenant_orders;
CREATE POLICY "eventark_own_orders"
  ON tenant_orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role bypasses RLS for webhook updates (use SUPABASE_SERVICE_ROLE_KEY)
