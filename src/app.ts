import fastify, { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import rlsPlugin from './plugins/rls';
import redisClusterPlugin from './plugins/redis-cluster';
import cachedDocumentRoutes from './routes/cached-documents';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({ logger: true });

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/app_db',
  });

  // Parse Redis cluster startup nodes from environment (e.g., "127.0.0.1:7000,127.0.0.1:7001")
  const redisNodesEnv = process.env.REDIS_CLUSTER_NODES || '127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002';
  const startupNodes = redisNodesEnv.split(',').map(nodeStr => {
    const [host, port] = nodeStr.split(':');
    return { host, port: parseInt(port, 10) };
  });

  // Register Redis Cluster Plugin
  await app.register(redisClusterPlugin, { startupNodes });

  // Register PostgreSQL RLS Plugin
  await app.register(rlsPlugin, { pool: pgPool });

  // Register Routes
  await app.register(cachedDocumentRoutes);

  return app;
}
