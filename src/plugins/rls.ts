import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Pool, PoolClient } from 'pg';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    withTenantTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  }
}

export interface RlsPluginOptions {
  pool: Pool;
}

const rlsPlugin: FastifyPluginAsync<RlsPluginOptions> = async (fastify, options) => {
  const { pool } = options;

  fastify.decorateRequest('tenantId', '');
  fastify.decorateRequest('withTenantTransaction', null);

  // Validate and extract x-tenant-id on every incoming request
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantHeader = request.headers['x-tenant-id'];

    if (!tenantHeader || typeof tenantHeader !== 'string') {
      return reply.code(400).send({ error: 'Missing or invalid x-tenant-id header' });
    }

    request.tenantId = tenantHeader;
  });

  // Provide transaction helper setting SET LOCAL app.current_tenant_id
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const tenantId = request.tenantId;

    request.withTenantTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // Scope tenant ID strictly to the current transaction block
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

        const result = await callback(client);

        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    };
  });
};

export default fp(rlsPlugin, { name: 'postgres-rls-plugin' });
