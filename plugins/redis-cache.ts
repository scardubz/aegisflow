import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import Redis from 'ioredis';
import crypto from 'crypto';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    getTenantVersion(tenantId: string): Promise<number>;
    bumpTenantVersion(tenantId: string): Promise<void>;
  }
}

const redisCachePlugin: FastifyPluginAsync<{ redisUrl: string }> = async (fastify, options) => {
  const redis = new Redis(options.redisUrl);

  fastify.decorate('redis', redis);

  // Helper: Get current tenant data version (defaults to 1 if not set)
  fastify.decorate('getTenantVersion', async (tenantId: string): Promise<number> => {
    const versionKey = `tenant:${tenantId}:docs:version`;
    const version = await redis.get(versionKey);
    if (!version) {
      await redis.set(versionKey, 1);
      return 1;
    }
    return parseInt(version, 10);
  });

  // Helper: Instant O(1) invalidation by incrementing the tenant version counter
  fastify.decorate('bumpTenantVersion', async (tenantId: string): Promise<void> => {
    const versionKey = `tenant:${tenantId}:docs:version`;
    await redis.incr(versionKey);
  });

  fastify.addHook('onClose', async (instance) => {
    await instance.redis.quit();
  });
};

export default fp(redisCachePlugin, { name: 'redis-cache-plugin' });
