import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';

const cachedDocumentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // GET /documents/cached-cursor - Cached cursor pagination endpoint
  fastify.get('/documents/cached-cursor', async (request, reply) => {
    const tenantId = request.tenantId;
    const { limit = '20', cursor = '' } = request.query as { limit?: string; cursor?: string };
    const take = Math.min(parseInt(limit, 10), 100);

    // 1. Fetch current tenant version for namespace isolation
    const version = await fastify.getTenantVersion(tenantId);

    // 2. Generate a deterministic cache key hash for this specific query parameters
    const queryHash = crypto
      .createHash('sha256')
      .update(`${take}:${cursor}`)
      .digest('hex');

    const cacheKey = `tenant:${tenantId}:docs:cursor:${version}:${queryHash}`;

    // 3. Check Redis Cache
    const cachedData = await fastify.redis.get(cacheKey);
    if (cachedData) {
      return { 
        source: 'cache', 
        ...JSON.parse(cachedData) 
      };
    }

    // 4. Cache Miss: Execute PostgreSQL Keyset Query
    // (Decodes cursor and queries DB as shown in previous step)
    const result = await request.withTenantTransaction(async (client) => {
      // Database query logic here...
      return { data: [], pagination: { nextCursor: null, hasMore: false } };
    });

    // 5. Store result in Redis with a 60-second TTL
    await fastify.redis.set(cacheKey, JSON.stringify(result), 'EX', 60);

    return { 
      source: 'database', 
      ...result 
    };
  });

  // POST /documents - Write operation that invalidates cache instantly
  fastify.post('/documents', async (request, reply) => {
    const tenantId = request.tenantId;
    const { title, content } = request.body as { title: string; content: string };

    const newDoc = await request.withTenantTransaction(async (client) => {
      const query = `
        INSERT INTO documents (tenant_id, title, content) 
        VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2) 
        RETURNING id, title, created_at
      `;
      const { rows } = await client.query(query, [title, content]);
      return rows[0];
    });

    // O(1) Invalidation: Bump tenant version counter so all existing page caches expire
    await fastify.bumpTenantVersion(tenantId);

    return reply.code(201).send({ data: newDoc });
  });
};

export default cachedDocumentRoutes;
