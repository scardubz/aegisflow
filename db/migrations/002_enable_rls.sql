-- Enable PostgreSQL Row-Level Security
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if re-running migration
DROP POLICY IF EXISTS tenant_isolation_policy ON documents;

-- Enforce strict fail-closed multi-tenant data segregation
CREATE POLICY tenant_isolation_policy ON documents
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
