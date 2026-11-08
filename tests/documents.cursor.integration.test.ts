import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { Pool } from 'pg';
import rlsPlugin from '../plugins/rls';
import cursorPaginationRoutes from '../routes/cursor-pagination'; // Assuming route is defined here
import { TestTenants } from './helpers/fixtures';

describe('Cursor-Based Keyset Pagination Integration Tests', () => {
  let app: FastifyInstance;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    app = fastify({ logger: false });
    await app.register(rlsPlugin, { pool });
    await app.register(cursorPaginationRoutes);
    await app.ready();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM documents');
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('should correctly traverse multiple pages and return accurate nextCursor tokens', async () => {
    // 1. Seed 4 sequential documents with distinct timestamps
    await pool.query(`
      INSERT INTO documents (tenant_id, title, content, created_at) VALUES 
      ($1, 'Doc 4', 'Content 4', '2026-11-08T12:00:00Z'),
      ($1, 'Doc 3', 'Content 3', '2026-11-08T11:00:00Z'),
      ($1, 'Doc 2', 'Content 2', '2026-11-08T10:00:00Z'),
      ($1, 'Doc 1', 'Content 1', '2026-11-08T09:00:00Z')
    `, [TestTenants.TENANT_A]);

    // 2. Request Page 1 with limit = 2
    const page1Res = await supertest(app.server)
      .get('/documents/cursor?limit=2')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.data).toHaveLength(2);
    expect(page1Res.body.data[0].title).toBe('Doc 4');
    expect(page1Res.body.data[1].title).toBe('Doc 3');
    expect(page1Res.body.pagination.hasMore).toBe(true);
    expect(page1Res.body.pagination.nextCursor).toBeDefined();

    const cursor = page1Res.body.pagination.nextCursor;

    // 3. Request Page 2 using the nextCursor token
    const page2Res = await supertest(app.server)
      .get(`/documents/cursor?limit=2&cursor=${cursor}`)
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.data).toHaveLength(2);
    expect(page2Res.body.data[0].title).toBe('Doc 2');
    expect(page2Res.body.data[1].title).toBe('Doc 1');
    expect(page2Res.body.pagination.hasMore).toBe(false);
    expect(page2Res.body.pagination.nextCursor).toBeNull();
  });

  it('should handle identical timestamp tie-breaking deterministically using UUIDs', async () => {
    // 1. Seed multiple documents sharing the EXACT same created_at timestamp
    // We explicitly insert them to guarantee predictable primary key ordering
    const identicalTimestamp = '2026-11-08T15:00:00Z';
    
    await pool.query(`
      INSERT INTO documents (id, tenant_id, title, content, created_at) VALUES 
      ('55555555-5555-5555-5555-555555555555', $1, 'Doc C (Same Time)', 'C', $2),
      ('33333333-3333-3333-3333-333333333333', $1, 'Doc B (Same Time)', 'B', $2),
      ('11111111-1111-1111-1111-111111111111', $1, 'Doc A (Same Time)', 'A', $2)
    `, [TestTenants.TENANT_A, identicalTimestamp]);

    // Because sort is ORDER BY created_at DESC, id DESC:
    // UUIDs compared lexicographically: '55' > '33' > '11'
    // Expected order: Doc C -> Doc B -> Doc A

    // 2. Fetch page 1 with limit = 1
    const page1Res = await supertest(app.server)
      .get('/documents/cursor?limit=1')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.data).toHaveLength(1);
    expect(page1Res.body.data[0].title).toBe('Doc C (Same Time)');

    // 3. Fetch page 2 using cursor
    const cursor1 = page1Res.body.pagination.nextCursor;
    const page2Res = await supertest(app.server)
      .get(`/documents/cursor?limit=1&cursor=${cursor1}`)
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.data).toHaveLength(1);
    expect(page2Res.body.data[0].title).toBe('Doc B (Same Time)');

    // 4. Fetch page 3 using cursor
    const cursor2 = page2Res.body.pagination.nextCursor;
    const page3Res = await supertest(app.server)
      .get(`/documents/cursor?limit=1&cursor=${cursor2}`)
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(page3Res.status).toBe(200);
    expect(page3Res.body.data).toHaveLength(1);
    expect(page3Res.body.data[0].title).toBe('Doc A (Same Time)');
    expect(page3Res.body.pagination.hasMore).toBe(false);
  });
});
