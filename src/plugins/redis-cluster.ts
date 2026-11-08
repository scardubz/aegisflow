import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { Cluster, ClusterOptions } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Cluster;
    getTenantVersion(tenantId: string): Promise<number>;
    bumpTenantVersion(tenantId: string): Promise<void>;
  }
}

export interface RedisClusterPluginOptions {
  startupNodes: { host: string; port: number }[];
  clusterOptions?: ClusterOptions;
}

const redisClusterPlugin: FastifyPluginAsync<RedisClusterPluginOptions> = async (fastify, options) => {
  const { startupNodes, clusterOptions } = options;

  const defaultClusterOptions: ClusterOptions = {
    scaleReads: 'slave', // Distribute read queries across replica nodes for HA performance
    maxRedirections: 16,
    
    // Exponential backoff retry strategy for node disconnects
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      fastify.log.warn(`[Redis Cluster] Reconnecting... attempt #${times}, waiting ${delay}ms`);
      return delay;
    },

    // Cluster topology refresh retry strategy
    clusterRetryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      fastify.log.error(`[Redis Cluster] Cluster topology refresh failed, retry #${times}`);
      return delay;
    },

    // Automatically reconnect if a replica throws READONLY during failover
    reconnectOnError(err) {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        fastify.log.warn('[Redis Cluster] Caught READONLY error during failover. Reconnecting...');
        return true;
      }
      return false;
    },

    ...clusterOptions,
  };

  const redisCluster = new Cluster(startupNodes, defaultClusterOptions);

  redisCluster.on('connect', () => {
    fastify.log.info('[Redis Cluster] Successfully connected to cluster startup nodes');
  });

  redisCluster.on('error', (err) => {
    fastify.log.error({ err }, '[Redis Cluster] Cluster node connection error');
  });

  fastify.decorate('redis', redisCluster);

  // CRITICAL CLUSTER RULE: Using Redis Hash Tags `{tenantId}` forces 
  // both keys to hash to the exact same cluster shard slot.
  fastify.decorate('getTenantVersion', async (tenantId: string): Promise<number> => {
    const versionKey = `tenant:{${tenantId}}:docs:version`;
    const version = await redisCluster.get(versionKey);
    if (!version) {
      await redisCluster.set(versionKey, '1');
      return 1;
    }
    return parseInt(version, 10);
  });

  fastify.decorate('bumpTenantVersion', async (tenantId: string): Promise<void> => {
    const versionKey = `tenant:{${tenantId}}:docs:version`;
    await redisCluster.incr(versionKey);
  });

  fastify.addHook('onClose', async (instance) => {
    await instance.redis.quit();
    fastify.log.info('[Redis Cluster connection gracefully closed]');
  });
};

export default fp(redisClusterPlugin, { name: 'redis-cluster-plugin' });
