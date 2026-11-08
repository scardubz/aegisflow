import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { Pool } from 'pg';
import rlsPlugin from '../plugins/rls';
import documentRoutes from '../routes/documents';
import { seedTestDatabase, TestTenants } from './helpers/fixtures';

describe('Document API - Pagination & Sorting Integration Tests', () => {
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
    await pool.query('DELETE FROM documents');
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('should paginate results correctly using limit and offset', async () => {
    // Seed 5 documents for Tenant A
    await seedTestDatabase(pool, [
      { tenantId: TestTenants.TENANT_A, title: 'Document One', content: 'Content 1' },
      { tenantId: TestTenants.TENANT_A, title: 'Document Two', content: 'Content 2' },
      { tenantId: TestTenants.TENANT_A, title: 'Document Three', content: 'Content 3' },
      { tenantId: TestTenants.TENANT_A, title: 'Document Four', content: 'Content 4' },
      { tenantId: TestTenants.TENANT_A, title: 'Document Five', content: 'Content 5' },
    ]);

    // Request page 1 with limit 2
    const page1Res = await supertest(app.server)
      .get('/documents?limit=2&offset=0')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.data).toHaveLength(2);

    // Request page 2 with limit 2, offset 2
    const page2Res = await supertest(app.server)
      .get('/documents?limit=2&offset=2')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.data).toHaveLength(2);
    // Ensure no overlapping records between pages
    expect(page2Res.body.data[0].title).not.toBe(page1Res.body.data[0].title);
  });

  it('should sort documents alphabetically by title (ASC and DESC)', async () => {
    // Seed documents with non-alphabetical titles
    await seedTestDatabase(pool, [
      { tenantId: TestTenants.TENANT_A, title: 'Zebra Protocol', content: 'Z' },
      { tenantId: TestTenants.TENANT_A, title: 'Alpha Framework', content: 'A' },
      { tenantId: TestTenants.TENANT_A, title: 'Delta Architecture', content: 'D' },
    ]);

    // Test Ascending Order
    const ascRes = await supertest(app.server)
      .get('/documents?sort_by=title&order=ASC')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(ascRes.status).toBe(200);
    expect(ascRes.body.data.map((d: any) => d.title)).toEqual([
      'Alpha Framework',
      'Delta Architecture',
      'Zebra Protocol',
    ]);

    // Test Descending Order
    const descRes = await supertest(app.server)
      .get('/documents?sort_by=title&order=DESC')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(descRes.status).toBe(200);
    expect(descRes.body.data.map((d: any) => d.title)).toEqual([
      'Zebra Protocol',
      'Delta Architecture',
      'Alpha Framework',
    ]);
  });

  it('should maintain RLS isolation strictly across paginated queries', async () => {
    // Seed data for both Tenant A and Tenant B
    await seedTestDatabase(pool, [
      { tenantId: TestTenants.TENANT_A, title: 'Tenant A - Doc 1', content: 'A1' },
      { tenantId: TestTenants.TENANT_A, title: 'Tenant A - Doc 2', content: 'A2' },
      { tenantId: TestTenants.TENANT_B, title: 'Tenant B - Doc 1', content: 'B1' },
    ]);

    // Tenant B queries with pagination parameters
    const response = await supertest(app.server)
      .get('/documents?limit=10&offset=0')
      .set('x-tenant-id', TestTenants.TENANT_B);

    expect(response.status).toBe(200);
    // Tenant B should only see their single document, ignoring Tenant A's records entirely
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Tenant B - Doc 1');
  });
});
