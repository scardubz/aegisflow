import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { Pool } from 'pg';
import rlsPlugin from '../plugins/rls';
import documentRoutes from '../routes/documents';
import { seedTestDatabase, TestTenants } from './helpers/fixtures';

describe('Document API Integration Tests with Fixtures', () => {
  let app: FastifyInstance;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    app = fastify({ logger: false });
    await app.register(rlsPlugin, { pool });
    await app.register(documentRoutes);
    await app.ready();
  });

  beforeEach(async () => {
    // Reset state before each test
    await pool.query('DELETE FROM documents');
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('should list only documents belonging to Tenant A using seeded fixtures', async () => {
    // Seed multi-tenant data in one clean function call
    await seedTestDatabase(pool, [
      { tenantId: TestTenants.TENANT_A, title: 'Alpha Note', content: 'Secret A' },
      { tenantId: TestTenants.TENANT_A, title: 'Beta Note', content: 'Secret A2' },
      { tenantId: TestTenants.TENANT_B, title: 'Gamma Note', content: 'Secret B' },
    ]);

    // Request as Tenant A
    const response = await supertest(app.server)
      .get('/documents')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.map((d: any) => d.title)).toEqual(
      expect.arrayContaining(['Alpha Note', 'Beta Note'])
    );
  });
});
