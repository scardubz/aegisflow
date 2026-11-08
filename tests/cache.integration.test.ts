import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { Pool } from 'pg';
import rlsPlugin from '../plugins/rls';
import redisCachePlugin from '../plugins/redis-cache';
import cachedDocumentRoutes from '../routes/cached-documents';
import { TestTenants } from './helpers/fixtures';

describe('Redis Cache, Cache Miss, and Version Invalidation Integration Tests', () => {
  let app: FastifyInstance;
  let pgPool: Pool;

  beforeAll(async () => {
    pgPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    app = fastify({ logger: false });
    
    // Register plugins using Testcontainers environment variables
    await app.register(redisCachePlugin, { redisUrl: process.env.TEST_REDIS_URL! });
    await app.register(rlsPlugin, { pool: pgPool });
    await app.register(cachedDocumentRoutes);

    await app.ready();
  });

  beforeEach(async () => {
    // Reset database state and flush Redis cache between tests
    await pgPool.query('DELETE FROM documents');
    await app.redis.flushall();
  });

  afterAll(async () => {
    await pgPool.end();
    await app.close();
  });

  it('should result in a Cache Miss on first request and a Cache Hit on the second request', async () => {
    // 1. Seed initial test document
    await pgPool.query(
      `INSERT INTO documents (tenant_id, title, content) VALUES ($1, $2, $3)`,
      [TestTenants.TENANT_A, 'Caching Test Doc', 'Initial content']
    );

    // 2. First Request (Cache Miss)
    const res1 = await supertest(app.server)
      .get('/documents/cached-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(res1.status).toBe(200);
    expect(res1.body.source).toBe('database');
    expect(res1.body.data).toHaveLength(1);
    expect(res1.body.data[0].title).toBe('Caching Test Doc');

    // 3. Second Identical Request (Cache Hit)
    const res2 = await supertest(app.server)
      .get('/documents/cached-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(res2.status).toBe(200);
    expect(res2.body.source).toBe('cache');
    expect(res2.body.data).toHaveLength(1);
    expect(res2.body.data[0].title).toBe('Caching Test Doc');
  });

  it('should invalidate cache instantly via version increment when a write mutation occurs', async () => {
    // 1. Seed initial document and populate cache
    await pgPool.query(
      `INSERT INTO documents (tenant_id, title, content) VALUES ($1, $2, $3)`,
      [TestTenants.TENANT_A, 'Doc 1', 'Content 1']
    );

    const initialRes = await supertest(app.server)
      .get('/documents/cached-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(initialRes.body.source).toBe('database');

    // Confirm cache is active
    const hitRes = await supertest(app.server)
      .get('/documents/cached-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(hitRes.body.source).toBe('cache');

    // 2. Execute a write mutation (POST) which bumps the tenant version counter in Redis
    const postRes = await supertest(app.server)
      .post('/documents')
      .set('x-tenant-id', TestTenants.TENANT_A)
      .send({ title: 'Doc 2 (Mutation)', content: 'New content' });

    expect(postRes.status).toBe(201);

    // 3. Subsequent Request after write mutation (Expected Cache Miss due to version bump)
    const postInvalidationRes = await supertest(app.server)
      .get('/documents/cached-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(postInvalidationRes.status).toBe(200);
    expect(postInvalidationRes.body.source).toBe('database');
    expect(postInvalidationRes.body.data).toHaveLength(2); // Returns updated record set
  });

  it('should maintain strict tenant isolation across Redis cache keys', async () => {
    // 1. Tenant A inserts a record and caches the query result
    await pgPool.query(
      `INSERT INTO documents (tenant_id, title, content) VALUES ($1, $2, $3)`,
      [TestTenants.TENANT_A, 'Tenant A Secret', 'Confidential']
    );

    const resA = await supertest(app.server)
      .get('/documents/cached-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(resA.body.source).toBe('database');
    expect(resA.body.data).toHaveLength(1);

    // 2. Tenant B requests documents (Expected cache miss and empty set, unaffected by Tenant A cache)
    const resB = await supertest(app.server)
      .get('/documents/cached-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_B);

    expect(resB.status).toBe(200);
    expect(resB.body.source).toBe('database');
    expect(resB.body.data).toHaveLength(0);
  });
});
