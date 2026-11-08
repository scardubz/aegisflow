-- Enable pgcrypto extension for secure UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create primary multi-tenant documents table
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create highly optimized compound index for tenant-isolated keyset pagination
CREATE INDEX IF NOT EXISTS idx_documents_tenant_cursor 
ON documents (tenant_id, created_at DESC, id DESC);
