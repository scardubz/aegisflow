import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';

const cachedDocumentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // GET /documents/cached-cluster-cursor - Clustered cached pagination
  fastify.get('/documents/cached-cluster-cursor', async (request, reply) => {
    const tenantId = request.tenantId;
    const { limit = '20', cursor = '' } = request.query as { limit?: string; cursor?: string };
    const take = Math.min(parseInt(limit, 10), 100);

    // 1. Fetch current tenant version
    const version = await fastify.getTenantVersion(tenantId);

    // 2. Generate deterministic query hash
    const queryHash = crypto
      .createHash('sha256')
      .update(`${take}:${cursor}`)
      .digest('hex');

    // Hash tagged cache key guaranteeing slot collocation with the version counter
    const cacheKey = `tenant:{${tenantId}}:docs:cursor:${version}:${queryHash}`;

    // 3. Check Cluster Cache
    const cachedData = await fastify.redis.get(cacheKey);
    if (cachedData) {
      return { source: 'cache', ...JSON.parse(cachedData) };
    }

    // 4. Cache Miss: Execute DB Query
    const result = await request.withTenantTransaction(async (client) => {
      const query = `
        SELECT id, title, content, created_at 
        FROM documents 
        ORDER BY created_at DESC, id DESC 
        LIMIT $1
      `;
      const { rows } = await client.query(query, [take]);
      return { data: rows, pagination: { nextCursor: null, hasMore: false } };
    });

    // 5. Store in cluster cache with 60s TTL
    await fastify.redis.set(cacheKey, JSON.stringify(result), 'EX', 60);

    return { source: 'database', ...result };
  });

  // POST /documents - Write mutation that triggers O(1) version bump across cluster
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

    // Instantly invalidates all cached pages for this tenant across the cluster
    await fastify.bumpTenantVersion(tenantId);

    return reply.code(201).send({ data: newDoc });
  });
};

export default cachedDocumentRoutes;
