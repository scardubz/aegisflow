import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { Pool } from 'pg';
import rlsPlugin from '../src/plugins/rls';
import redisClusterPlugin from '../src/plugins/redis-cluster';
import cachedDocumentRoutes from '../src/routes/cached-documents';
import { TestTenants } from './helpers/fixtures';

describe('AegisFlow Cluster Cache & RLS Integration Tests', () => {
  let app: FastifyInstance;
  let pgPool: Pool;

  beforeAll(async () => {
    pgPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    app = fastify({ logger: false });
    
    // Parse test Redis cluster nodes from environment
    const redisUrl = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
    const startupNodes = [{ host: '127.0.0.1', port: 6379 }]; // Maps to Testcontainers Redis instance

    await app.register(redisClusterPlugin, { startupNodes });
    await app.register(rlsPlugin, { pool: pgPool });
    await app.register(cachedDocumentRoutes);

    await app.ready();
  });

  beforeEach(async () => {
    await pgPool.query('DELETE FROM documents');
    await app.redis.flushall();
  });

  afterAll(async () => {
    await pgPool.end();
    await app.close();
  });

  it('should handle cache misses, populate cluster cache, and serve subsequent cache hits', async () => {
    await pgPool.query(
      `INSERT INTO documents (tenant_id, title, content) VALUES ($1, $2, $3)`,
      [TestTenants.TENANT_A, 'Cluster Test Doc', 'Secure cluster content']
    );

    // 1. First Request -> Cache Miss (Database query)
    const res1 = await supertest(app.server)
      .get('/documents/cached-cluster-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(res1.status).toBe(200);
    expect(res1.body.source).toBe('database');
    expect(res1.body.data[0].title).toBe('Cluster Test Doc');

    // 2. Second Request -> Cache Hit (Redis Cluster)
    const res2 = await supertest(app.server)
      .get('/documents/cached-cluster-cursor?limit=10')
      .set('x-tenant-id', TestTenants.TENANT_A);

    expect(res2.status).toBe(200);
    expect(res2.body.source).toBe('cache');
    expect(res2.body.data[0].title).toBe('Cluster Test Doc');
  });
});
