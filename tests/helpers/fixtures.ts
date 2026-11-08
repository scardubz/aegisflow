// tests/helpers/fixtures.ts
import { Pool, PoolClient } from 'pg';

export interface DocumentSeedInput {
  id?: string;
  tenantId: string;
  title: string;
  content: string;
  createdAt?: string;
}

/**
 * Inserts a single test document into the database.
 * Bypasses RLS if connected as superuser, making setup fast and direct.
 */
export async function createTestDocument(
  clientOrPool: Pool | PoolClient,
  input: DocumentSeedInput
) {
  const query = `
    INSERT INTO documents (tenant_id, title, content)
    VALUES ($1, $2, $3)
    RETURNING id, tenant_id, title, content, created_at
  `;
  const values = [input.tenantId, input.title, input.content];
  const { rows } = await clientOrPool.query(query, values);
  return rows[0];
}

/**
 * Seeds multiple documents across multiple tenants for complex test scenarios.
 */
export async function seedTestDatabase(
  pool: Pool,
  documents: DocumentSeedInput[]
) {
  const seededDocuments = [];
  for (const doc of documents) {
    const created = await createTestDocument(pool, doc);
    seededDocuments.push(created);
  }
  return seededDocuments;
}

/**
 * Standardized Tenant UUID constants for use across test suites.
 */
export const TestTenants = {
  TENANT_A: '11111111-1111-1111-1111-111111111111',
  TENANT_B: '22222222-2222-2222-2222-222222222222',
  TENANT_C: '33333333-3333-3333-3333-333333333333',
};
